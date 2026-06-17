#!/usr/bin/env node
import fs from "node:fs";
import process from "node:process";

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "has",
  "have",
  "in",
  "is",
  "it",
  "its",
  "not",
  "of",
  "on",
  "or",
  "over",
  "that",
  "the",
  "their",
  "there",
  "this",
  "to",
  "was",
  "were",
  "with",
]);

function parseArgs(argv) {
  const args = {
    labels: "evals/labels.jsonl",
    predictions: "evals/predictions.example.jsonl",
    threshold: 0.5,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--labels") args.labels = argv[++index];
    else if (arg === "--predictions") args.predictions = argv[++index];
    else if (arg === "--threshold") args.threshold = Number(argv[++index]);
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(args.threshold) || args.threshold <= 0 || args.threshold > 1) {
    throw new Error("--threshold must be in the range (0, 1]");
  }

  return args;
}

function printHelp() {
  console.log(`Usage: node evals/run_eval.mjs [--labels evals/labels.jsonl] [--predictions predictions.jsonl]\n\nMetrics:\n  claim_recall                 matched gold claims / total gold claims\n  duplicate_rate               near-duplicate predicted claims / total predicted claims\n  unsupported_verdict_rate     unsupported or unverified predictions / total predicted claims\n  mean_latency_ms              average latency_ms over predictions that report it\n`);
}

function readJsonl(path) {
  return fs
    .readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, lineIndex) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`${path}:${lineIndex + 1}: ${error.message}`);
      }
    });
}

function normalize(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(text) {
  return normalize(text)
    .split(" ")
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

function tokenSet(text) {
  return new Set(tokens(text));
}

function overlapScore(left, right) {
  const a = tokenSet(left);
  const b = tokenSet(right);
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;

  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection += 1;
  }

  const union = a.size + b.size - intersection;
  return intersection / union;
}

function unsupportedVerdict(claim) {
  const verdict = normalize(claim.verdict ?? claim.status ?? "");
  return verdict.includes("unsupported") || verdict.includes("unverified") || verdict.includes("unknown");
}

function countDuplicates(predictedClaims) {
  let duplicateCount = 0;
  const seen = [];

  for (const claim of predictedClaims) {
    const text = claim.text ?? claim.claim ?? "";
    if (seen.some((priorText) => overlapScore(priorText, text) >= 0.85)) {
      duplicateCount += 1;
    } else {
      seen.push(text);
    }
  }

  return duplicateCount;
}

function evaluate(labels, predictions, threshold) {
  const predictionsByTranscript = new Map(predictions.map((row) => [row.transcript_id, row]));
  const unmatched = [];
  const matched = [];
  const falsePositives = [];

  let totalGold = 0;
  let totalPredicted = 0;
  let duplicateCount = 0;
  let unsupportedCount = 0;
  let latencySum = 0;
  let latencyCount = 0;

  for (const labelRow of labels) {
    const goldClaims = labelRow.claims ?? [];
    const predictionRow = predictionsByTranscript.get(labelRow.transcript_id) ?? { claims: [] };
    const predictedClaims = predictionRow.claims ?? [];
    const usedPredictions = new Set();

    totalGold += goldClaims.length;
    totalPredicted += predictedClaims.length;
    duplicateCount += countDuplicates(predictedClaims);

    for (const claim of predictedClaims) {
      if (unsupportedVerdict(claim)) unsupportedCount += 1;
      if (Number.isFinite(Number(claim.latency_ms))) {
        latencySum += Number(claim.latency_ms);
        latencyCount += 1;
      }
    }

    for (const gold of goldClaims) {
      let bestIndex = -1;
      let bestScore = 0;

      predictedClaims.forEach((predicted, index) => {
        if (usedPredictions.has(index)) return;
        const score = overlapScore(gold.text, predicted.text ?? predicted.claim ?? "");
        if (score > bestScore) {
          bestScore = score;
          bestIndex = index;
        }
      });

      if (bestScore >= threshold) {
        usedPredictions.add(bestIndex);
        matched.push({ transcript_id: labelRow.transcript_id, gold_id: gold.id, score: bestScore });
      } else {
        unmatched.push({ transcript_id: labelRow.transcript_id, gold_id: gold.id, text: gold.text, best_score: bestScore });
      }
    }

    predictedClaims.forEach((predicted, index) => {
      if (!usedPredictions.has(index)) {
        falsePositives.push({ transcript_id: labelRow.transcript_id, text: predicted.text ?? predicted.claim ?? "" });
      }
    });
  }

  return {
    counts: {
      total_gold_claims: totalGold,
      total_predicted_claims: totalPredicted,
      matched_claims: matched.length,
      unmatched_claims: unmatched.length,
      false_positive_claims: falsePositives.length,
      duplicate_claims: duplicateCount,
      unsupported_or_unverified_claims: unsupportedCount,
      latency_claims: latencyCount,
    },
    metrics: {
      claim_recall: ratio(matched.length, totalGold),
      duplicate_rate: ratio(duplicateCount, totalPredicted),
      unsupported_verdict_rate: ratio(unsupportedCount, totalPredicted),
      mean_latency_ms: latencyCount === 0 ? null : latencySum / latencyCount,
    },
    unmatched,
    false_positives: falsePositives,
  };
}

function ratio(numerator, denominator) {
  return denominator === 0 ? 0 : numerator / denominator;
}

function formatPercent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function printReport(result) {
  console.log("# Claim Extraction Eval\n");
  console.log("| Metric | Value |");
  console.log("| --- | ---: |");
  console.log(`| Claim recall | ${formatPercent(result.metrics.claim_recall)} |`);
  console.log(`| Duplicate rate | ${formatPercent(result.metrics.duplicate_rate)} |`);
  console.log(`| Unsupported/unverified verdict rate | ${formatPercent(result.metrics.unsupported_verdict_rate)} |`);
  console.log(
    `| Mean latency | ${result.metrics.mean_latency_ms === null ? "n/a" : `${result.metrics.mean_latency_ms.toFixed(0)} ms`} |`,
  );
  console.log("\n## Counts\n");
  console.log("```json");
  console.log(JSON.stringify(result.counts, null, 2));
  console.log("```");

  if (result.unmatched.length > 0) {
    console.log("\n## Unmatched Gold Claims\n");
    for (const miss of result.unmatched) {
      console.log(`- ${miss.transcript_id}/${miss.gold_id}: ${miss.text} (best score ${miss.best_score.toFixed(2)})`);
    }
  }
}

try {
  const args = parseArgs(process.argv.slice(2));
  const labels = readJsonl(args.labels);
  const predictions = readJsonl(args.predictions);
  const result = evaluate(labels, predictions, args.threshold);

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printReport(result);
  }
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
