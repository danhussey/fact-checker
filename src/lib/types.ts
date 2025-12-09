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
  | "misleading"
  | "unverified"
  | "false"
  | "contested"
  | "opinion";

// Structured fact-check response from API
export interface StructuredFactCheck {
  verdict: Verdict;
  confidence: 1 | 2 | 3 | 4;
  whatsTrue: string[];
  whatsMisleading: string[];
  missingContext: string[];
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
  true: { bg: "bg-green-500/20", text: "text-green-400", label: "TRUE" },
  misleading: { bg: "bg-yellow-500/20", text: "text-yellow-400", label: "MISLEADING" },
  unverified: { bg: "bg-orange-500/20", text: "text-orange-400", label: "UNVERIFIED" },
  false: { bg: "bg-red-500/20", text: "text-red-400", label: "FALSE" },
  contested: { bg: "bg-blue-500/20", text: "text-blue-400", label: "CONTESTED" },
  opinion: { bg: "bg-zinc-500/20", text: "text-zinc-400", label: "OPINION" },
};
