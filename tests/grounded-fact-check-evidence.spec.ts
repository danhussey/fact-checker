import { test, expect } from "@playwright/test";
import { collectEvidence, groundAssessment, groundedAssessmentSchema, type ResearchResponse } from "../src/lib/groundedEvidence";
import { withResearchDeadline } from "../src/lib/researchDeadline";

const sourceUrl = "https://www.nasa.gov/earth/facts/";
const citation = { type: "url_citation", title: "NASA", url: sourceUrl };
type Annotation = { type: string; url?: string; title?: string; start_index?: number; end_index?: number };
const research = (text: string, annotations: Annotation[] = [citation]): ResearchResponse => ({
  status: "completed",
  output: [{ type: "message", status: "completed", content: [{ type: "output_text", text, annotations }] }],
});
const supported = () => collectEvidence(research(`Earth orbits the Sun once per year. [[1]](${sourceUrl})`));
const assessment = () => groundedAssessmentSchema.parse({
  verdict: "true", confidence: 4, sourceIds: ["S1"],
  whatsTrue: [{ text: "Earth orbits the Sun annually", sourceId: "S1" }],
  whatsWrong: [], context: [], argument: {
    claim: "Earth orbits the Sun", grounds: [{ text: "A year measures one Earth orbit", sourceId: "S1" }],
    warrant: "An orbital period establishes the frequency", backing: null, qualifier: "certain", rebuttals: [],
  },
});

test.describe("Grounded evidence", () => {
  test("requires provider citation metadata and a supporting passage, not free-text URLs", () => {
    expect(collectEvidence(research("Earth orbits the Sun once per year."))).toEqual([]);
    expect(collectEvidence(research("Earth orbits the Sun. [1](https://invented.example/proof)"))).toEqual([]);
    expect(collectEvidence(research(`Earth orbits the Sun. [1](${sourceUrl})`, []))).toEqual([]);
    expect(supported()).toEqual([{ id: "S1", name: "NASA", url: sourceUrl, excerpt: "Earth orbits the Sun once per year." }]);
  });

  test("uses positional citations and excludes uncited surrounding paragraphs", () => {
    const text = "Unsupported claim about Mars.\nEarth orbits the Sun once per year.\nUnsupported claims about Venus.";
    const result = collectEvidence(research(text, [{ ...citation, start_index: 29, end_index: 63 }]));
    expect(result[0].excerpt).toBe("Earth orbits the Sun once per year.");
  });

  test("deduplicates sources and rejects unsafe URLs", () => {
    const text = `Earth orbits the Sun once per year. [[1]](${sourceUrl})`;
    expect(collectEvidence(research(text, [citation, citation]))).toHaveLength(1);
    expect(collectEvidence(research(text, [{ ...citation, url: "javascript:alert(1)" }]))).toEqual([]);
    expect(collectEvidence(research(text, [{ ...citation, url: "https://user:password@example.com" }]))).toEqual([]);
  });

  test("uses readable source names for xAI's actual numeric citation titles", () => {
    const result = collectEvidence(research(`Earth orbits the Sun once per year. [[1]](${sourceUrl})`, [{ ...citation, title: "1" }]));
    expect(result[0].name).toBe("www.nasa.gov");
    expect(groundAssessment(assessment(), result).whatsTrue[0]).toContain("(www.nasa.gov)");
  });

  test("only renders selected real sources while preserving argument structure", () => {
    const result = groundAssessment(assessment(), supported());
    expect(result.verdict).toBe("true");
    expect(result.whatsTrue).toEqual(["Earth orbits the Sun annually (NASA)"]);
    expect(result.sources).toEqual([{ name: "NASA", url: sourceUrl }]);
    expect(result.argument?.grounds).toEqual(["A year measures one Earth orbit (NASA)"]);
    expect(result.argument?.backing).toBeUndefined();
  });

  test("invalid, unselected, or absent evidence cannot retain a confident verdict", () => {
    const invalid = assessment();
    invalid.whatsTrue[0].sourceId = "made-up";
    expect(groundAssessment(invalid, supported()).verdict).toBe("unverified");
    const unselected = assessment();
    unselected.sourceIds = [];
    expect(groundAssessment(unselected, supported()).confidence).toBe(1);
    const missing = assessment();
    missing.whatsTrue = [];
    expect(groundAssessment(missing, supported()).sources).toEqual([]);
  });

  test("model-authored URLs cannot leak into evidence text or argument", () => {
    const value = assessment();
    value.whatsTrue[0].text = "Earth orbits the Sun [proof](https://invented.example/proof)";
    value.argument!.warrant = "See https://invented.example/claim";
    expect(JSON.stringify(groundAssessment(value, supported()))).not.toContain("invented.example");
  });
});

test.describe("Research deadline", () => {
  test("propagates client cancellation and prevents later phases", async () => {
    const request = new AbortController();
    let signal: AbortSignal | undefined;
    let startedNextPhase = false;
    const result = withResearchDeadline(request.signal, async (activeSignal) => {
      signal = activeSignal;
      await new Promise<void>((resolve) => activeSignal.addEventListener("abort", () => resolve(), { once: true }));
      activeSignal.throwIfAborted();
      startedNextPhase = true;
    });
    request.abort();
    await expect(result).rejects.toMatchObject({ code: "cancelled" });
    expect(signal?.aborted).toBe(true);
    expect(startedNextPhase).toBe(false);
  });

  test("enforces a shared deadline even when a provider ignores cancellation", async () => {
    let signal: AbortSignal | undefined;
    await expect(withResearchDeadline(new AbortController().signal, async (activeSignal) => {
      signal = activeSignal;
      return await new Promise<never>(() => {});
    }, 10)).rejects.toMatchObject({ code: "timeout" });
    expect(signal?.aborted).toBe(true);
  });

  test("does not start an already-cancelled request and cleans up after success", async () => {
    const request = new AbortController();
    request.abort();
    let called = false;
    await expect(withResearchDeadline(request.signal, async () => { called = true; })).rejects.toMatchObject({ code: "cancelled" });
    expect(called).toBe(false);
    const nextRequest = new AbortController();
    let signal: AbortSignal | undefined;
    await expect(withResearchDeadline(nextRequest.signal, async (activeSignal) => { signal = activeSignal; return 1; })).resolves.toBe(1);
    nextRequest.abort();
    expect(signal?.aborted).toBe(false);
  });
});
