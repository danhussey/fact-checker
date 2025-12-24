export interface TranscriptionResult {
  text: string;
  confidence?: number;
}

export interface Source {
  url: string;
  title?: string;
}

export type RecordingState = "idle" | "recording" | "processing";

// Toulmin argument model
export type Qualifier = "certain" | "probable" | "possible" | "uncertain";

export interface ToulminStructure {
  claim: string;           // Core assertion (restated clearly)
  grounds: string[];       // Evidence/data supporting the claim
  warrant: string;         // The logical principle connecting grounds to claim
  backing?: string;        // Support for the warrant's validity
  qualifier: Qualifier;    // Degree of certainty
  rebuttals?: string[];    // Conditions that would undermine the argument
}

export interface VoiceRecorderState {
  status: RecordingState;
  duration: number;
  error?: string;
}

// Verdict types for visual display
export type Verdict =
  | "true"
  | "mostly true"
  | "half true"
  | "mostly false"
  | "false"
  | "unverified";

// Structured fact-check response from API
export interface StructuredFactCheck {
  verdict: Verdict;
  confidence: 1 | 2 | 3 | 4;
  whatsTrue: string[];
  whatsWrong: string[];
  context: string[];
  sources: { name: string; url?: string }[];
  argument?: ToulminStructure;
}

// For continuous listening mode - now with structured data
export interface FactCheck {
  id: string;
  claim: string;
  result: StructuredFactCheck | null;
  isLoading: boolean;
  error?: string;
  timestamp: Date;
}

// Verdict display configuration - uses CSS variables for theme support
export const verdictConfig: Record<Verdict, { bg: string; text: string; label: string }> = {
  "true": { bg: "bg-success-bg", text: "text-success", label: "True" },
  "mostly true": { bg: "bg-success-bg", text: "text-success", label: "Mostly True" },
  "half true": { bg: "bg-warning-bg", text: "text-warning", label: "Half True" },
  "mostly false": { bg: "bg-warning-bg", text: "text-warning", label: "Mostly False" },
  "false": { bg: "bg-error-bg", text: "text-error", label: "False" },
  "unverified": { bg: "bg-border", text: "text-text-muted", label: "Unverified" },
};
