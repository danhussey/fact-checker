# Claim Extraction Evals

This folder is a small offline benchmark scaffold for the part of the app that matters most: extracting checkable claims from noisy, streaming speech.

The starter set covers five failure modes:

- sarcasm,
- self-correction,
- debate interruptions,
- ambiguous pronouns,
- hallucinated or weak citations.

Run the example evaluation:

```bash
npm run eval:claims
```

The command compares `labels.jsonl` with `predictions.example.jsonl` and reports claim recall, duplicate rate, unsupported/unverified verdict rate, and mean reported latency. Replace the example predictions with outputs from two prompts or two models to turn this into a comparison table.

## Files

- `transcripts/*.txt` - short adversarial transcript snippets.
- `labels.jsonl` - expected checkable claims for each transcript.
- `predictions.example.jsonl` - intentionally small example model output.
- `run_eval.mjs` - dependency-free metric runner.

## Prediction Format

Each JSONL row should look like:

```json
{"transcript_id":"self_correction","claims":[{"text":"The trial enrolled 480 patients.","verdict":"unverified","latency_ms":1260}]}
```

The runner uses token-overlap matching, so wording can vary. It is deliberately simple; the useful next step is to export real pipeline outputs and compare prompts or model versions on the same transcript set.
