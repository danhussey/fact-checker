/** Conservative, shared claim comparison. Similar topics are not duplicates. */
const SMALL_NUMBERS = new Map([
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
  "seventeen", "eighteen", "nineteen",
].map((word, value) => [word, value]));
const TENS = new Map([
  ["twenty", 20], ["thirty", 30], ["forty", 40], ["fifty", 50],
  ["sixty", 60], ["seventy", 70], ["eighty", 80], ["ninety", 90],
]);
const SCALES = new Map([
  ["hundred", 100], ["thousand", 1e3], ["million", 1e6],
  ["billion", 1e9], ["trillion", 1e12],
]);
const UNIT_ALIASES = new Map<string, string>();
for (const [unit, aliases] of Object.entries({
  millimeter: ["millimeters", "millimetre", "millimetres", "mm"],
  centimeter: ["centimeters", "centimetre", "centimetres", "cm"],
  meter: ["meters", "metre", "metres", "m"],
  kilometer: ["kilometers", "kilometre", "kilometres", "km"],
  foot: ["feet", "ft"], inch: ["inches"], mile: ["miles"],
  second: ["seconds", "sec"], minute: ["minutes", "min", "mins"],
  hour: ["hours"], day: ["days"], year: ["years"],
  percent: ["%"], dollar: ["dollars", "$"], pound: ["pounds", "£"],
  euro: ["euros", "€"], gigabyte: ["gigabytes", "gb"],
  megabyte: ["megabytes", "mb"], terabyte: ["terabytes", "tb"],
  kilobyte: ["kilobytes", "kb"], kilogram: ["kilograms", "kg"],
  gram: ["grams"], watt: ["watts"],
})) {
  for (const alias of [unit, ...aliases]) UNIT_ALIASES.set(alias, unit);
}

function tokensFor(text: string): string[] {
  return text.normalize("NFKC").toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/\bwon't\b/g, "will not")
    .replace(/\bcan't\b/g, "can not")
    .replace(/\bcannot\b/g, "can not")
    .replace(/n't\b/g, " not")
    .replace(/\bper\s+cent\b/g, "percent")
    // Grouping commas disappear, decimal points and signed values survive.
    .replace(/(?<=\d),(?=\d{3}(?:\D|$))/g, "")
    .match(/[+-]?(?:\d+(?:\.\d+)?|\.\d+)|[\p{L}]+(?:'[\p{L}]+)?|[%$£€]|[<>]=?|=/gu) || [];
}

function canonicalDigits(value: string): string {
  const negative = value.startsWith("-");
  const [integer, decimal = ""] = value.replace(/^[+-]/, "").split(".");
  const whole = integer.replace(/^0+(?=\d)/, "") || "0";
  const fraction = decimal.replace(/0+$/, "");
  const magnitude = `${whole}${fraction ? `.${fraction}` : ""}`;
  return negative && magnitude !== "0" ? `-${magnitude}` : magnitude;
}

function readNumberAt(tokens: string[], start: number): { value: string; next: number } | null {
  if (/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(tokens[start] || "")) {
    let next = start + 1;
    let shift = 0;
    while (SCALES.has(tokens[next])) { shift += Math.log10(SCALES.get(tokens[next])!); next += 1; }
    const initial = canonicalDigits(tokens[start]);
    const sign = initial.startsWith("-") ? "-" : "";
    const [whole, fraction = ""] = initial.replace(/^-/, "").split(".");
    const digits = whole + fraction + "0".repeat(Math.max(0, shift - fraction.length));
    const decimalAt = whole.length + shift;
    return { value: canonicalDigits(`${sign}${digits.slice(0, decimalAt)}${digits.length > decimalAt ? `.${digits.slice(decimalAt)}` : ""}`), next };
  }
  let index = start;
  let current = 0;
  let total = 0;
  let found = false;
  let lastWasSmall = false;
  let lastLargeScale = Infinity;
  while (index < tokens.length) {
    const token = tokens[index];
    const digit = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(token) ? Number(token) : undefined;
    const small = SMALL_NUMBERS.get(token);
    const tens = TENS.get(token);
    if (digit !== undefined || small !== undefined || tens !== undefined) {
      // Do not merge separate values ("2024 2025", "five six").
      if (found && (digit !== undefined || lastWasSmall)) break;
      current += digit ?? small ?? tens!;
      lastWasSmall = digit !== undefined || small !== undefined;
      found = true;
      index += 1;
      continue;
    }
    const scale = SCALES.get(token);
    if (scale && found) {
      if (scale === 100) current *= scale;
      else { total += current * scale; current = 0; lastLargeScale = scale; }
      lastWasSmall = false;
      index += 1;
      continue;
    }
    if (token === "point" && found && /^\d$/.test(String(SMALL_NUMBERS.get(tokens[index + 1])))) {
      let fraction = "";
      index += 1;
      while (SMALL_NUMBERS.has(tokens[index]) && SMALL_NUMBERS.get(tokens[index])! < 10) {
        fraction += SMALL_NUMBERS.get(tokens[index]);
        index += 1;
      }
      current += Number(`0.${fraction}`);
      continue;
    }
    // "one hundred and five", but never consume "five and six" as eleven.
    if (token === "and" && found && !lastWasSmall &&
      (SMALL_NUMBERS.has(tokens[index + 1]) || TENS.has(tokens[index + 1]))) {
      const followingScale = tokens.slice(index + 1, index + 5).map((word) => SCALES.get(word)).find((scale) => scale && scale >= lastLargeScale);
      if (followingScale) break;
      index += 1;
      continue;
    }
    break;
  }
  return found ? { value: String(total + current), next: index } : null;
}

function canonicalTokens(text: string): string[] {
  const tokens = tokensFor(text);
  const result: string[] = [];
  for (let index = 0; index < tokens.length;) {
    const number = readNumberAt(tokens, index);
    if (number) { result.push(number.value); index = number.next; }
    else { result.push(UNIT_ALIASES.get(tokens[index]) || tokens[index]); index += 1; }
  }
  // Currency placement is formatting; keep the actual currency identity.
  for (let index = 0; index < result.length - 1; index += 1) {
    if (["dollar", "pound", "euro"].includes(result[index]) && /^[+-]?\d/.test(result[index + 1])) {
      [result[index], result[index + 1]] = [result[index + 1], result[index]];
    }
  }
  return result;
}

export function normalizeClaimText(text: string): string {
  return canonicalTokens(text).join(" ");
}

/** Only lossless formatting/number/unit changes are deterministic duplicates. */
export function areClaimsEquivalent(a: string, b: string): boolean {
  const normalized = normalizeClaimText(a);
  return normalized.length > 0 && normalized === normalizeClaimText(b);
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  return a.size === b.size && [...a].every((value) => b.has(value));
}

export function extractMeasurements(text: string): Set<string> {
  const tokens = canonicalTokens(text);
  const measurements = new Set<string>();
  for (let index = 0; index < tokens.length; index += 1) {
    if (!/^[+-]?\d+(?:\.\d+)?$/.test(tokens[index])) continue;
    // A unit must immediately follow its quantity; do not borrow one from a later fact.
    const unit = UNIT_ALIASES.get(tokens[index + 1]) || "number";
    measurements.add(`${tokens[index]}:${unit}`);
  }
  return measurements;
}

export function extractQuantities(text: string): Set<string> {
  return new Set(canonicalTokens(text).filter((token) => /^[+-]?\d+(?:\.\d+)?$/.test(token)));
}

function quotedValues(text: string): Set<string> {
  return new Set([...text.matchAll(/"([^"\n]+)"|“([^”\n]+)”|(?<![\p{L}])'([^'\n]+)'(?![\p{L}])/gu)]
    .map((match) => normalizeClaimText(match[1] || match[2] || match[3])));
}

function properNouns(text: string): Set<string> {
  return new Set([...text.matchAll(/\b[A-Z][A-Za-z0-9]*(?:\s+[A-Z][A-Za-z0-9]*)*\b/g)]
    .map((match) => match[0].toLowerCase().replace(/^(?:the|a|an)\s+/, ""))
    .filter((phrase) => !/^(?:the|a|an|he|she|it|they|this|that|we|you|i)$/.test(phrase)));
}

export function extractClaimFacts(text: string) {
  return {
    measurements: extractMeasurements(text), quantities: extractQuantities(text),
    quotedValues: quotedValues(text), properNouns: properNouns(text),
  };
}

export function measurementsDiffer(a: string, b: string): boolean {
  return !setsEqual(extractMeasurements(a), extractMeasurements(b));
}

const NEGATIONS = new Set(["not", "no", "never", "none", "neither", "without"]);
const SCOPES = new Set([
  "all", "every", "each", "some", "most", "few", "only", "always", "sometimes",
  "usually", "often", "rarely", "ever", "before", "after", "since", "until",
  "currently", "formerly", "average", "median", "total", "capita", "annual", "monthly",
  "daily", "weekly", "worldwide", "nationally", "locally", "approximately", "exactly",
  "about", "nearly", "almost", "least", "over", "under", "more", "less", "than",
  "can", "could", "may", "might", "will", "would", "must", "should", "was", "were",
]);
const DIRECTIONS = new Map([
  ...["increase", "increases", "increased", "increasing", "rise", "rises", "rose", "higher", "greater", "bigger", "larger", "above", "exceeds"].map((word) => [word, "up"] as const),
  ...["decrease", "decreases", "decreased", "decreasing", "drop", "drops", "dropped", "lower", "smaller", "below", "decline", "declines"].map((word) => [word, "down"] as const),
]);
const GRAMMAR_WORDS = new Set([
  "the", "a", "an", "is", "are", "be", "been", "being", "have", "has", "had", "do",
  "does", "did", "to", "of", "in", "for", "on", "with", "at", "by", "from", "as",
  "and", "but", "or", "that", "which", "this", "these", "those", "it", "its",
]);
const PROPERTY_ALIASES = new Map([
  ["jobs", "employment"], ["job", "employment"], ["employed", "employment"],
  ["salaries", "wages"], ["salary", "wages"], ["wage", "wages"],
  ["funds", "funding"], ["funded", "funding"], ["fund", "funding"],
  ["receives", "receive"], ["received", "receive"], ["receiving", "receive"],
  ["tall", "height"], ["weighs", "weight"], ["weigh", "weight"], ["weighed", "weight"],
  ["wide", "width"], ["long", "length"], ["deep", "depth"],
]);
const MEASUREMENT_PROPERTIES = new Set(["height", "weight", "width", "length", "depth"]);

/**
 * Factual veto for model-labelled repeats, not a semantic equivalence test.
 * Unknown paraphrases still require the extractor's explicit relationship; no
 * word-overlap score is sufficient to suppress or revise a claim.
 */
export function claimFactsDiffer(a: string, b: string): boolean {
  if (areClaimsEquivalent(a, b)) return false;
  const aFacts = extractClaimFacts(a);
  const bFacts = extractClaimFacts(b);
  if (!setsEqual(aFacts.measurements, bFacts.measurements) ||
      !setsEqual(aFacts.quantities, bFacts.quantities) ||
      !setsEqual(aFacts.quotedValues, bFacts.quotedValues)) return true;

  const aTokens = canonicalTokens(a);
  const bTokens = canonicalTokens(b);
  const signature = (tokens: string[], set: Set<string>) => tokens.filter((token) => set.has(token)).join(" ");
  if (signature(aTokens, NEGATIONS) !== signature(bTokens, NEGATIONS) ||
      signature(aTokens, SCOPES) !== signature(bTokens, SCOPES)) return true;
  const aDirections = aTokens.map((token) => DIRECTIONS.get(token)).filter(Boolean).join(" ");
  const bDirections = bTokens.map((token) => DIRECTIONS.get(token)).filter(Boolean).join(" ");
  if (aDirections && bDirections && aDirections !== bDirections) return true;

  // Ignore capitalization differences. A named entity absent from the other
  // assertion is a factual change; names can move for active/passive phrasing.
  const missingEntity = (names: Set<string>, tokens: string[]) => [...names].some((name) =>
    name.split(" ").some((word) => !tokens.includes(word)));
  if (aFacts.properNouns.size && bFacts.properNouns.size &&
      (missingEntity(aFacts.properNouns, bTokens) || missingEntity(bFacts.properNouns, aTokens))) return true;

  const content = (tokens: string[]) => tokens.filter((token) => !GRAMMAR_WORDS.has(token))
    .map((token) => PROPERTY_ALIASES.get(token) || DIRECTIONS.get(token) || token);
  const aContent = content(aTokens);
  const bContent = content(bTokens);
  const aSet = new Set(aContent);
  const bSet = new Set(bContent);
  // Swapping subject/object or attaching the same quantities to other entities
  // is not a repeat. This intentionally errs toward checking ambiguous wording.
  const roleOrder = (tokens: string[]) => tokens.filter((token) => !MEASUREMENT_PROPERTIES.has(token)).join(" ");
  // Attribute placement changes in "25 meters tall" / "height of 25 meters"
  // without swapping who/what the measurement describes.
  if (setsEqual(aSet, bSet) && roleOrder(aContent) !== roleOrder(bContent)) return true;
  const aOnly = [...aSet].filter((token) => !bSet.has(token));
  const bOnly = [...bSet].filter((token) => !aSet.has(token));
  const common = [...aSet].filter((token) => bSet.has(token)).length;
  // A small changed property in otherwise identical wording (wages/jobs,
  // harmful/beneficial, exports/imports, China/Japan) must not be swallowed.
  if (common >= 1 && common / Math.max(aSet.size, bSet.size) >= 0.5 &&
      ((aOnly.length === 1 && bOnly.length === 1) ||
       (aOnly.length === 0 && bOnly.length > 0) ||
       (bOnly.length === 0 && aOnly.length > 0))) return true;
  return false;
}
