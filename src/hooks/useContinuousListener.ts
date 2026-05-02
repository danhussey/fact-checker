"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { USAGE_LIMITS, type SessionUsageState } from "@/lib/types";
import {
  addPipelineBreadcrumb,
  capturePipelineError,
  transcriptDiagnosticData,
} from "@/lib/observability";

type ConnectionStatus = "idle" | "connecting" | "connected" | "error";

// Local storage key for daily usage tracking
const DAILY_USAGE_KEY = "fact-checker:daily-usage";

interface DailyUsage {
  date: string;
  totalMs: number;
  sessionCount: number;
}

interface DeepgramTokenResponse {
  token: string;
  sessionsRemaining: number;
  expiresAt?: string;
  maxDurationMs?: number;
}

interface CachedDeepgramToken {
  token: string;
  sessionsRemaining: number;
  expiresAt: number;
}

const DEEPGRAM_TOKEN_CACHE_MS = 55 * 60 * 1000;

function getTodayKey(): string {
  return new Date().toISOString().split("T")[0];
}

function getDailyUsage(): DailyUsage {
  if (typeof window === "undefined") {
    return { date: getTodayKey(), totalMs: 0, sessionCount: 0 };
  }
  try {
    const stored = localStorage.getItem(DAILY_USAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as DailyUsage;
      if (parsed.date === getTodayKey()) {
        return parsed;
      }
    }
  } catch {
    // Ignore localStorage errors
  }
  return { date: getTodayKey(), totalMs: 0, sessionCount: 0 };
}

function saveDailyUsage(usage: DailyUsage): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(DAILY_USAGE_KEY, JSON.stringify(usage));
  } catch {
    // Ignore localStorage errors
  }
}

// Map browser locales to Deepgram language codes
function getDeepgramLanguage(): string {
  if (typeof navigator === "undefined") return "en";

  const locale = navigator.language || "en";
  const lang = locale.toLowerCase();

  // English variants
  if (lang.startsWith("en-au")) return "en-AU";
  if (lang.startsWith("en-gb")) return "en-GB";
  if (lang.startsWith("en-nz")) return "en-NZ";
  if (lang.startsWith("en-in")) return "en-IN";
  if (lang.startsWith("en-ie")) return "en-IE";
  if (lang.startsWith("en-za")) return "en-ZA";
  if (lang.startsWith("en")) return "en-US";

  // Other languages Deepgram supports
  const langMap: Record<string, string> = {
    "zh": "zh",
    "nl": "nl",
    "fr": "fr",
    "de": "de",
    "hi": "hi",
    "id": "id",
    "it": "it",
    "ja": "ja",
    "ko": "ko",
    "pl": "pl",
    "pt": "pt",
    "ru": "ru",
    "es": "es",
    "sv": "sv",
    "tr": "tr",
    "uk": "uk",
  };

  const baseLang = lang.split("-")[0];
  return langMap[baseLang] || "en";
}

type StopReason = "user" | "session_limit" | "daily_limit" | "error";

interface UseContinuousListenerReturn {
  isListening: boolean;
  isStarting: boolean;
  transcript: string;
  interimText: string;
  error: string | null;
  connectionStatus: ConnectionStatus;
  startListening: () => void;
  stopListening: () => void;
  // Session usage tracking
  sessionUsage: SessionUsageState;
  stopReason: StopReason | null;
}

// Deepgram transcript response structure
interface DeepgramWord {
  word: string;
  start: number;
  end: number;
  confidence: number;
}

interface DeepgramAlternative {
  transcript: string;
  confidence: number;
  words: DeepgramWord[];
}

interface DeepgramChannel {
  alternatives: DeepgramAlternative[];
}

interface DeepgramTranscriptResponse {
  type: "Results";
  channel_index: number[];
  duration: number;
  start: number;
  is_final: boolean;
  speech_final: boolean;
  channel: DeepgramChannel;
}

interface ContinuousListenerOptions {
  includeTranscriptDiagnostics?: boolean;
}

function normalizeTranscriptSegment(text: string): string {
  return text
    .toLowerCase()
    .replace(/[.,!?;:'"]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function useContinuousListener(
  onTranscript: (text: string) => void,
  options: ContinuousListenerOptions = {}
): UseContinuousListenerReturn {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interimText, setInterimText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("idle");
  const [stopReason, setStopReason] = useState<StopReason | null>(null);

  // Session usage tracking
  const [sessionUsage, setSessionUsage] = useState<SessionUsageState>(() => {
    const daily = getDailyUsage();
    return {
      sessionStartTime: null,
      elapsedMs: 0,
      isWarning: false,
      isLimitReached: false,
      dailyUsageMs: daily.totalMs,
      sessionsRemaining: Math.max(0, USAGE_LIMITS.maxDailyTokenRequests - daily.sessionCount),
    };
  });

  const streamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const isStoppingRef = useRef(false);
  const interimTextRef = useRef("");
  const lastEmittedTextRef = useRef("");
  const sessionStartTimeRef = useRef<number | null>(null);
  const usageTimerRef = useRef<NodeJS.Timeout | null>(null);
  const stopListeningInternalRef = useRef<(reason: StopReason) => void>(() => {});
  const isStartingRef = useRef(false);
  const tokenCacheRef = useRef<CachedDeepgramToken | null>(null);
  const onTranscriptRef = useRef(onTranscript);
  const includeTranscriptDiagnosticsRef = useRef(options.includeTranscriptDiagnostics);

  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);

  useEffect(() => {
    includeTranscriptDiagnosticsRef.current = options.includeTranscriptDiagnostics;
  }, [options.includeTranscriptDiagnostics]);

  // Update usage timer
  const startUsageTimer = useCallback(() => {
    if (usageTimerRef.current) {
      clearInterval(usageTimerRef.current);
    }

    const startTime = Date.now();
    sessionStartTimeRef.current = startTime;

    usageTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const remaining = USAGE_LIMITS.maxSessionDurationMs - elapsed;
      const isWarning = remaining <= USAGE_LIMITS.warningThresholdMs && remaining > 0;
      const isLimitReached = remaining <= 0;

      setSessionUsage((prev) => ({
        ...prev,
        sessionStartTime: startTime,
        elapsedMs: elapsed,
        isWarning,
        isLimitReached,
      }));

      // Auto-stop at limit
      if (isLimitReached) {
        stopListeningInternalRef.current("session_limit");
      }
    }, 1000);
  }, []);

  const stopUsageTimer = useCallback((reason: StopReason) => {
    if (usageTimerRef.current) {
      clearInterval(usageTimerRef.current);
      usageTimerRef.current = null;
    }

    // Save session duration to daily usage
    if (sessionStartTimeRef.current) {
      const sessionDuration = Date.now() - sessionStartTimeRef.current;
      const daily = getDailyUsage();
      daily.totalMs += sessionDuration;
      saveDailyUsage(daily);

      setSessionUsage((prev) => ({
        ...prev,
        sessionStartTime: null,
        elapsedMs: 0,
        isWarning: false,
        isLimitReached: false,
        dailyUsageMs: daily.totalMs,
      }));
    }

    sessionStartTimeRef.current = null;
    setStopReason(reason);
  }, []);

  // Get Deepgram auth from our API, reusing it across stop/start cycles.
  const getDeepgramToken = async (): Promise<{ token: string; sessionsRemaining: number } | null> => {
    try {
      const cachedToken = tokenCacheRef.current;
      if (cachedToken && cachedToken.expiresAt > Date.now()) {
        addPipelineBreadcrumb("listener.deepgram_token_reused", {
          sessionsRemaining: cachedToken.sessionsRemaining,
        });
        return {
          token: cachedToken.token,
          sessionsRemaining: cachedToken.sessionsRemaining,
        };
      }

      const response = await fetch("/api/deepgram-token", {
        method: "POST",
      });

      if (!response.ok) {
        const data = await response.json();
        if (response.status === 429 && data.dailyLimitExceeded) {
          throw new Error("Daily session limit reached. Please try again tomorrow.");
        }
        throw new Error(data.error || "Failed to get token");
      }

      const data = (await response.json()) as DeepgramTokenResponse;
      const expiresAt = data.expiresAt
        ? Date.parse(data.expiresAt)
        : Date.now() + DEEPGRAM_TOKEN_CACHE_MS;

      tokenCacheRef.current = {
        token: data.token,
        sessionsRemaining: data.sessionsRemaining,
        expiresAt: Number.isFinite(expiresAt)
          ? expiresAt
          : Date.now() + DEEPGRAM_TOKEN_CACHE_MS,
      };

      return {
        token: data.token,
        sessionsRemaining: data.sessionsRemaining,
      };
    } catch (err) {
      console.error("Token fetch error:", err);
      tokenCacheRef.current = null;
      capturePipelineError(err, { stage: "deepgram-token" });
      if (err instanceof Error) {
        setError(err.message);
      }
      return null;
    }
  };

  // Determine best audio MIME type for the browser
  const getMimeType = useCallback((): string => {
    if (typeof MediaRecorder === "undefined") return "audio/webm";

    // Safari only supports audio/mp4
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
    if (isSafari) {
      return "audio/mp4";
    }

    // Prefer webm with opus for Chrome/Firefox
    const types = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/mp4",
    ];

    return types.find((t) => MediaRecorder.isTypeSupported(t)) || "audio/webm";
  }, []);

  const emitTranscript = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    const normalized = normalizeTranscriptSegment(trimmed);
    if (normalized === lastEmittedTextRef.current) return;
    lastEmittedTextRef.current = normalized;

    addPipelineBreadcrumb(
      "transcript.emitted",
      transcriptDiagnosticData(trimmed, includeTranscriptDiagnosticsRef.current)
    );
    setTranscript((prev) => {
      const newTranscript = prev ? `${prev} ${trimmed}` : trimmed;
      return newTranscript;
    });
    setInterimText("");
    interimTextRef.current = "";
    onTranscriptRef.current(trimmed);
  }, []);

  // Internal stop function that accepts a reason
  const stopListeningInternal = useCallback((reason: StopReason) => {
    isStoppingRef.current = true;
    isStartingRef.current = false;
    addPipelineBreadcrumb("listener.stop", { reason });

    if (interimTextRef.current.trim()) {
      addPipelineBreadcrumb(
        "transcript.flush_on_stop",
        transcriptDiagnosticData(
          interimTextRef.current,
          includeTranscriptDiagnosticsRef.current
        )
      );
      emitTranscript(interimTextRef.current);
    }

    stopUsageTimer(reason);

    // Stop MediaRecorder
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    mediaRecorderRef.current = null;

    // Close WebSocket
    if (
      socketRef.current &&
      (socketRef.current.readyState === WebSocket.CONNECTING ||
        socketRef.current.readyState === WebSocket.OPEN)
    ) {
      socketRef.current.close(1000);
    }
    socketRef.current = null;

    // Stop microphone stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    setIsListening(false);
    setConnectionStatus("idle");
    setInterimText("");
    interimTextRef.current = "";
  }, [emitTranscript, stopUsageTimer]);

  // Keep ref updated for use in interval
  useEffect(() => {
    stopListeningInternalRef.current = stopListeningInternal;
  }, [stopListeningInternal]);

  const startListening = useCallback(async () => {
    if (isStartingRef.current || isListening) return;

    isStartingRef.current = true;
    addPipelineBreadcrumb("listener.start_requested");
    setError(null);
    setTranscript("");
    setInterimText("");
    interimTextRef.current = "";
    lastEmittedTextRef.current = "";
    setConnectionStatus("connecting");
    setStopReason(null);
    isStoppingRef.current = false;

    try {
      // Get microphone stream
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 16000,
        },
      });

      if (isStoppingRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        isStartingRef.current = false;
        setConnectionStatus("idle");
        return;
      }

      streamRef.current = stream;
      addPipelineBreadcrumb("listener.microphone_ready");

      // Get temporary token
      const tokenResponse = await getDeepgramToken();
      if (isStoppingRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        if (streamRef.current === stream) {
          streamRef.current = null;
        }
        isStartingRef.current = false;
        setConnectionStatus("idle");
        return;
      }
      if (!tokenResponse) {
        throw new Error("Failed to get transcription token");
      }
      const { token, sessionsRemaining } = tokenResponse;
      addPipelineBreadcrumb("listener.deepgram_token_received", { sessionsRemaining });

      // Update sessions remaining
      setSessionUsage((prev) => ({
        ...prev,
        sessionsRemaining,
      }));

      // Build Deepgram WebSocket URL with options
      // Note: Don't specify encoding - let Deepgram auto-detect from the audio stream
      const detectedLanguage = getDeepgramLanguage();
      console.log("[transcription] Using language:", detectedLanguage);
      addPipelineBreadcrumb("deepgram.connecting", { language: detectedLanguage });

      const params = new URLSearchParams({
        model: "nova-3",
        language: detectedLanguage,
        smart_format: "true",
        interim_results: "true",
        utterance_end_ms: "1500",
        vad_events: "true",
        punctuate: "true",
        filler_words: "false",
      });

      const wsUrl = `wss://api.deepgram.com/v1/listen?${params.toString()}`;

      // Open WebSocket connection
      const socket = new WebSocket(wsUrl, ["token", token]);
      socketRef.current = socket;

      socket.onopen = () => {
        if (isStoppingRef.current) {
          socket.close();
          return;
        }

        isStartingRef.current = false;
        setConnectionStatus("connected");
        setIsListening(true);
        addPipelineBreadcrumb("deepgram.connected");

        // Start usage tracking timer
        startUsageTimer();

        // Start MediaRecorder to capture audio
        const mimeType = getMimeType();
        const mediaRecorder = new MediaRecorder(stream, {
          mimeType,
          audioBitsPerSecond: 128000,
        });
        mediaRecorderRef.current = mediaRecorder;

        mediaRecorder.ondataavailable = async (event) => {
          if (event.data.size > 0 && socket.readyState === WebSocket.OPEN) {
            const arrayBuffer = await event.data.arrayBuffer();
            socket.send(arrayBuffer);
          }
        };

        // Capture audio every 250ms for smooth streaming
        mediaRecorder.start(250);
      };

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.type === "SpeechStarted") {
            addPipelineBreadcrumb("deepgram.speech_started");
            return;
          }

          if (data.type === "UtteranceEnd") {
            addPipelineBreadcrumb("deepgram.utterance_end", {
              hadInterimText: Boolean(interimTextRef.current.trim()),
            });
            if (interimTextRef.current.trim()) {
              emitTranscript(interimTextRef.current);
            }
            return;
          }

          if (data.type === "Results") {
            const result = data as DeepgramTranscriptResponse;
            const text = result.channel?.alternatives?.[0]?.transcript || "";

            if (text.trim()) {
              if (result.is_final) {
                addPipelineBreadcrumb("deepgram.final_result", {
                  ...transcriptDiagnosticData(
                    text,
                    includeTranscriptDiagnosticsRef.current
                  ),
                  speechFinal: result.speech_final,
                });
                emitTranscript(text.trim());
              } else {
                // Interim result - show as faded text
                const trimmed = text.trim();
                interimTextRef.current = trimmed;
                setInterimText(trimmed);
              }
            }
          }
        } catch (err) {
          console.error("Error parsing Deepgram message:", err);
        }
      };

      socket.onerror = (event) => {
        console.error("WebSocket error:", event);
        isStartingRef.current = false;
        setConnectionStatus("error");
        setError("Connection error. Please try again.");
        capturePipelineError(new Error("Deepgram WebSocket error"), {
          stage: "deepgram-websocket",
        });
      };

      socket.onclose = (event) => {
        isStartingRef.current = false;
        addPipelineBreadcrumb("deepgram.closed", {
          code: event.code,
          wasClean: event.wasClean,
        }, event.code === 1000 ? "info" : "warning");
        if (!isStoppingRef.current && event.code !== 1000) {
          setConnectionStatus("error");
          setError("Connection closed unexpectedly. Please try again.");
          capturePipelineError(new Error("Deepgram WebSocket closed unexpectedly"), {
            stage: "deepgram-websocket",
            code: event.code,
          });
        } else {
          setConnectionStatus("idle");
        }
        setIsListening(false);
      };

    } catch (err) {
      isStartingRef.current = false;
      if (socketRef.current) {
        if (
          socketRef.current.readyState === WebSocket.CONNECTING ||
          socketRef.current.readyState === WebSocket.OPEN
        ) {
          socketRef.current.close(1000);
        }
        socketRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      if (isStoppingRef.current) {
        setConnectionStatus("idle");
        return;
      }
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      setConnectionStatus("error");
      capturePipelineError(err, { stage: "listener-start" });

      if (errorMessage.includes("Permission denied") || errorMessage.includes("NotAllowedError")) {
        setError("Microphone access denied. Please allow microphone access.");
      } else if (errorMessage.includes("NotFoundError")) {
        setError("No microphone found.");
      } else {
        setError(`Could not start listening: ${errorMessage}`);
      }
    }
  }, [emitTranscript, getMimeType, isListening, startUsageTimer]);

  const stopListening = useCallback(() => {
    stopListeningInternal("user");
  }, [stopListeningInternal]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isStoppingRef.current = true;
      if (usageTimerRef.current) {
        clearInterval(usageTimerRef.current);
      }
      if (mediaRecorderRef.current?.state === "recording") {
        mediaRecorderRef.current.stop();
      }
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.close(1000);
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  return {
    isListening,
    isStarting: connectionStatus === "connecting",
    transcript,
    interimText,
    error,
    connectionStatus,
    startListening,
    stopListening,
    sessionUsage,
    stopReason,
  };
}
