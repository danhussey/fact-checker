export interface TranscriptionResult {
  text: string;
  confidence?: number;
}

export interface Source {
  url: string;
  title?: string;
}

export type RecordingState = "idle" | "recording" | "processing";

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

// Verdict display configuration
export const verdictConfig: Record<Verdict, { bg: string; text: string; label: string }> = {
  "true": { bg: "bg-green-500/20", text: "text-green-400", label: "TRUE" },
  "mostly true": { bg: "bg-green-500/20", text: "text-green-300", label: "MOSTLY TRUE" },
  "half true": { bg: "bg-yellow-500/20", text: "text-yellow-400", label: "HALF TRUE" },
  "mostly false": { bg: "bg-orange-500/20", text: "text-orange-400", label: "MOSTLY FALSE" },
  "false": { bg: "bg-red-500/20", text: "text-red-400", label: "FALSE" },
  "unverified": { bg: "bg-zinc-500/20", text: "text-zinc-400", label: "UNVERIFIED" },
};
