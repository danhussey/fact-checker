"use client";

import type { RecordingState } from "@/lib/types";

interface RecordButtonProps {
  status: RecordingState;
  duration: number;
  onPress: () => void;
  disabled?: boolean;
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function RecordButton({
  status,
  duration,
  onPress,
  disabled = false,
}: RecordButtonProps) {
  const isRecording = status === "recording";
  const isProcessing = status === "processing";

  return (
    <div className="flex flex-col items-center gap-4">
      {/* Duration display */}
      <div
        className={`h-8 text-2xl font-mono tabular-nums transition-opacity ${
          isRecording ? "opacity-100" : "opacity-0"
        }`}
      >
        {formatDuration(duration)}
      </div>

      {/* Button container with pulse effect */}
      <div className="relative">
        {/* Pulse rings when recording */}
        {isRecording && (
          <>
            <div className="absolute inset-0 rounded-full bg-red-500/30 animate-pulse-ring" />
            <div
              className="absolute inset-0 rounded-full bg-red-500/20 animate-pulse-ring"
              style={{ animationDelay: "0.5s" }}
            />
          </>
        )}

        {/* Main button */}
        <button
          onClick={onPress}
          disabled={disabled || isProcessing}
          aria-label={isRecording ? "Stop recording" : "Start recording"}
          className={`
            relative z-10 flex h-24 w-24 items-center justify-center rounded-full
            transition-all duration-200 ease-out
            active:scale-95
            disabled:opacity-50 disabled:cursor-not-allowed
            ${
              isRecording
                ? "bg-red-500 hover:bg-red-600"
                : "bg-white hover:bg-zinc-100"
            }
          `}
        >
          {isProcessing ? (
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-zinc-300 border-t-zinc-600" />
          ) : isRecording ? (
            // Stop icon (square)
            <div className="h-8 w-8 rounded-sm bg-white" />
          ) : (
            // Microphone icon
            <svg
              className="h-10 w-10 text-zinc-900"
              fill="currentColor"
              viewBox="0 0 24 24"
            >
              <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
              <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
            </svg>
          )}
        </button>
      </div>

      {/* Status text */}
      <p className="h-6 text-sm text-zinc-400">
        {isProcessing
          ? "Processing..."
          : isRecording
          ? "Tap to stop"
          : "Tap to record"}
      </p>
    </div>
  );
}
