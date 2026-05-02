const SMALL_NUMBER_WORDS = new Map([
  ["zero", 0],
  ["one", 1],
  ["two", 2],
  ["three", 3],
  ["four", 4],
  ["five", 5],
  ["six", 6],
  ["seven", 7],
  ["eight", 8],
  ["nine", 9],
  ["ten", 10],
  ["eleven", 11],
  ["twelve", 12],
  ["thirteen", 13],
  ["fourteen", 14],
  ["fifteen", 15],
  ["sixteen", 16],
  ["seventeen", 17],
  ["eighteen", 18],
  ["nineteen", 19],
]);

const TENS_NUMBER_WORDS = new Map([
  ["twenty", 20],
  ["thirty", 30],
  ["forty", 40],
  ["fifty", 50],
  ["sixty", 60],
  ["seventy", 70],
  ["eighty", 80],
  ["ninety", 90],
]);

const UNIT_ALIASES = new Map([
  ["millimeter", "millimeter"],
  ["millimeters", "millimeter"],
  ["millimetre", "millimeter"],
  ["millimetres", "millimeter"],
  ["centimeter", "centimeter"],
  ["centimeters", "centimeter"],
  ["centimetre", "centimeter"],
  ["centimetres", "centimeter"],
  ["meter", "meter"],
  ["meters", "meter"],
  ["metre", "meter"],
  ["metres", "meter"],
  ["m", "meter"],
  ["kilometer", "kilometer"],
  ["kilometers", "kilometer"],
  ["kilometre", "kilometer"],
  ["kilometres", "kilometer"],
  ["km", "kilometer"],
  ["foot", "foot"],
  ["feet", "foot"],
  ["ft", "foot"],
  ["inch", "inch"],
  ["inches", "inch"],
  ["mile", "mile"],
  ["miles", "mile"],
  ["second", "second"],
  ["seconds", "second"],
  ["sec", "second"],
  ["minute", "minute"],
  ["minutes", "minute"],
  ["min", "minute"],
  ["mins", "minute"],
  ["hour", "hour"],
  ["hours", "hour"],
  ["day", "day"],
  ["days", "day"],
  ["percent", "percent"],
  ["percentage", "percent"],
  ["dollar", "currency"],
  ["dollars", "currency"],
  ["usd", "currency"],
  ["currency", "currency"],
]);

const LEADING_PROPER_NOUN_STOP_WORDS = new Set(["the", "a", "an"]);
const PROPER_NOUN_STOP_PHRASES = new Set([
  "he",
  "she",
  "it",
  "they",
  "this",
  "that",
  "these",
  "those",
  "we",
  "you",
  "i",
]);

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
}

function tokenizeMeasurementText(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/(\d+(?:\.\d+)?)\s*%/g, "$1 percent")
    .replace(/[$£€]\s*(\d+(?:\.\d+)?)/g, "$1 currency")
    .replace(/[^a-z0-9.]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function readNumberAt(tokens: string[], start: number): { value: string; next: number } | null {
  const digitMatch = tokens[start]?.match(/^\d+(?:\.\d+)?$/);
  if (digitMatch) {
    return { value: digitMatch[0], next: start + 1 };
  }

  let total = 0;
  let current = 0;
  let found = false;
  let index = start;

  while (index < tokens.length) {
    const token = tokens[index];
    const small = SMALL_NUMBER_WORDS.get(token);
    const tens = TENS_NUMBER_WORDS.get(token);

    if (small !== undefined) {
      current += small;
      found = true;
      index += 1;
      continue;
    }

    if (tens !== undefined) {
      current += tens;
      found = true;
      index += 1;
      continue;
    }

    if (token === "hundred" && found) {
      current *= 100;
      index += 1;
      continue;
    }

    if (token === "thousand" && found) {
      total += current * 1000;
      current = 0;
      index += 1;
      continue;
    }

    if (token === "and" && found) {
      index += 1;
      continue;
    }

    break;
  }

  if (!found) return null;
  return { value: String(total + current), next: index };
}

function canonicalUnit(token: string): string | null {
  return UNIT_ALIASES.get(token) || null;
}

function extractQuotedValues(text: string): Set<string> {
  const quoted = new Set<string>();
  const matches = text.matchAll(/["'“‘]([^"'”’]{2,})["'”’]/g);

  for (const match of matches) {
    quoted.add(match[1].toLowerCase().replace(/\s+/g, " ").trim());
  }

  return quoted;
}

function normalizeProperNounPhrase(phrase: string): string {
  const tokens = phrase.toLowerCase().split(/\s+/).filter(Boolean);
  while (tokens.length > 0 && LEADING_PROPER_NOUN_STOP_WORDS.has(tokens[0])) {
    tokens.shift();
  }
  return tokens.join(" ");
}

function extractProperNounPhrases(text: string): Set<string> {
  const phrases = new Set<string>();
  const matches = text.matchAll(/\b[A-Z][A-Za-z0-9]*(?:\s+[A-Z][A-Za-z0-9]*)*\b/g);

  for (const match of matches) {
    const normalized = normalizeProperNounPhrase(match[0]);
    if (normalized.length > 1 && !PROPER_NOUN_STOP_PHRASES.has(normalized)) {
      phrases.add(normalized);
    }
  }

  return phrases;
}

export function extractMeasurements(text: string): Set<string> {
  const tokens = tokenizeMeasurementText(text);
  const measurements = new Set<string>();

  for (let i = 0; i < tokens.length; i += 1) {
    const number = readNumberAt(tokens, i);
    if (!number) continue;

    let unit = "number";
    for (let j = number.next; j < Math.min(tokens.length, number.next + 4); j += 1) {
      const candidate = canonicalUnit(tokens[j]);
      if (candidate) {
        unit = candidate;
        break;
      }
    }

    measurements.add(`${number.value}:${unit}`);
    i = number.next - 1;
  }

  return measurements;
}

export function extractQuantities(text: string): Set<string> {
  const tokens = tokenizeMeasurementText(text);
  const quantities = new Set<string>();

  for (let i = 0; i < tokens.length; i += 1) {
    const number = readNumberAt(tokens, i);
    if (!number) continue;
    quantities.add(number.value);
    i = number.next - 1;
  }

  return quantities;
}

export function extractClaimFacts(text: string): {
  measurements: Set<string>;
  quantities: Set<string>;
  quotedValues: Set<string>;
  properNouns: Set<string>;
} {
  return {
    measurements: extractMeasurements(text),
    quantities: extractQuantities(text),
    quotedValues: extractQuotedValues(text),
    properNouns: extractProperNounPhrases(text),
  };
}

export function measurementsDiffer(a: string, b: string): boolean {
  const aMeasurements = extractMeasurements(a);
  const bMeasurements = extractMeasurements(b);
  if (aMeasurements.size === 0 || bMeasurements.size === 0) return false;
  return !setsEqual(aMeasurements, bMeasurements);
}

export function claimFactsDiffer(a: string, b: string): boolean {
  const aFacts = extractClaimFacts(a);
  const bFacts = extractClaimFacts(b);

  if (aFacts.measurements.size > 0 && bFacts.measurements.size > 0) {
    if (!setsEqual(aFacts.measurements, bFacts.measurements)) return true;
  }

  if (aFacts.quantities.size > 0 && bFacts.quantities.size > 0) {
    if (!setsEqual(aFacts.quantities, bFacts.quantities)) return true;
  }

  if (aFacts.quotedValues.size > 0 && bFacts.quotedValues.size > 0) {
    if (!setsEqual(aFacts.quotedValues, bFacts.quotedValues)) return true;
  }

  if (aFacts.properNouns.size > 0 && bFacts.properNouns.size > 0) {
    if (!setsEqual(aFacts.properNouns, bFacts.properNouns)) return true;
  }

  return false;
}
