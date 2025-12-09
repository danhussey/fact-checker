"use client";

import { useState, useRef, useCallback } from "react";
import type { RecordingState } from "@/lib/types";

interface UseVoiceRecorderReturn {
  status: RecordingState;
  duration: number;
  error: string | null;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<Blob | null>;
}

function getMimeType(): string {
  const types = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/wav",
  ];

  if (typeof MediaRecorder === "undefined") {
    return "audio/webm";
  }

  return types.find((t) => MediaRecorder.isTypeSupported(t)) || "audio/webm";
}

export function useVoiceRecorder(): UseVoiceRecorderReturn {
  const [status, setStatus] = useState<RecordingState>("idle");
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const resolveRef = useRef<((blob: Blob | null) => void) | null>(null);

  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    mediaRecorderRef.current = null;
    chunksRef.current = [];
  }, []);

  const startRecording = useCallback(async () => {
    setError(null);
    setDuration(0);
    chunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 16000,
        },
      });

      streamRef.current = stream;
      const mimeType = getMimeType();

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType,
        audioBitsPerSecond: 128000,
      });

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType });
        if (resolveRef.current) {
          resolveRef.current(blob);
          resolveRef.current = null;
        }
        cleanup();
        setStatus("idle");
      };

      mediaRecorder.onerror = () => {
        setError("Recording failed. Please try again.");
        if (resolveRef.current) {
          resolveRef.current(null);
          resolveRef.current = null;
        }
        cleanup();
        setStatus("idle");
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start(1000); // Collect data every second
      setStatus("recording");

      // Start duration timer
      const startTime = Date.now();
      timerRef.current = setInterval(() => {
        setDuration(Math.floor((Date.now() - startTime) / 1000));
      }, 100);

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";

      if (errorMessage.includes("Permission denied") || errorMessage.includes("NotAllowedError")) {
        setError("Microphone access denied. Please allow microphone access and try again.");
      } else if (errorMessage.includes("NotFoundError")) {
        setError("No microphone found. Please connect a microphone and try again.");
      } else {
        setError(`Could not access microphone: ${errorMessage}`);
      }

      cleanup();
      setStatus("idle");
    }
  }, [cleanup]);

  const stopRecording = useCallback(async (): Promise<Blob | null> => {
    return new Promise((resolve) => {
      if (!mediaRecorderRef.current || status !== "recording") {
        resolve(null);
        return;
      }

      resolveRef.current = resolve;
      setStatus("processing");
      mediaRecorderRef.current.stop();
    });
  }, [status]);

  return {
    status,
    duration,
    error,
    startRecording,
    stopRecording,
  };
}
