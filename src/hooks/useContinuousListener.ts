"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { USAGE_LIMITS, type SessionUsageState } from "@/lib/types";
import {
  addPipelineBreadcrumb,
  capturePipelineError,
  transcriptDiagnosticData,
} from "@/lib/observability";
import {
  drainTranscriptionSocket,
  TranscriptSegmentTracker,
  type DeepgramTranscriptResult,
  type TranscriptSegmentMetadata,
} from "@/lib/transcriptSegments";

type ConnectionStatus = "idle" | "connecting" | "connected" | "error";

interface DeepgramTokenResponse {
  token: string;
  tokenType: "bearer";
  expiresAt?: string;
  expiresIn?: number;
  maxDurationMs?: number;
}

interface CachedDeepgramToken {
  token: string;
  expiresAt: number;
}

const DEEPGRAM_TOKEN_CACHE_BUFFER_MS = 5 * 1000;

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

type StopReason = "user" | "session_limit" | "error";

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

interface ContinuousListenerOptions {
  includeTranscriptDiagnostics?: boolean;
}

export function useContinuousListener(
  onTranscript: (text: string, metadata?: TranscriptSegmentMetadata) => void,
  options: ContinuousListenerOptions = {}
): UseContinuousListenerReturn {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interimText, setInterimText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("idle");
  const [stopReason, setStopReason] = useState<StopReason | null>(null);

  const [sessionUsage, setSessionUsage] = useState<SessionUsageState>(() => {
    return {
      sessionStartTime: null,
      elapsedMs: 0,
      isWarning: false,
      isLimitReached: false,
    };
  });

  const streamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const isStoppingRef = useRef(false);
  const interimTextRef = useRef("");
  const sessionGenerationRef = useRef(0);
  const stopDrainRef = useRef<Promise<void> | null>(null);
  const audioSendQueueRef = useRef<Promise<void>>(Promise.resolve());
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
    setSessionUsage({
      sessionStartTime: startTime,
      elapsedMs: 0,
      isWarning: false,
      isLimitReached: false,
    });

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

    sessionStartTimeRef.current = null;
    setSessionUsage((prev) => ({
      ...prev,
      sessionStartTime: null,
      elapsedMs: 0,
      isWarning: false,
      isLimitReached: false,
    }));
    setStopReason(reason);
  }, []);

  // Get short-lived Deepgram auth from our API, reusing it only while valid.
  const getDeepgramToken = async (): Promise<{ token: string }> => {
    try {
      const cachedToken = tokenCacheRef.current;
      if (
        cachedToken &&
        cachedToken.expiresAt - DEEPGRAM_TOKEN_CACHE_BUFFER_MS > Date.now()
      ) {
        addPipelineBreadcrumb("listener.deepgram_token_reused");
        return {
          token: cachedToken.token,
        };
      }

      const response = await fetch("/api/deepgram-token", {
        method: "POST",
      });

      if (!response.ok) {
        const data = await response.json();
        if (response.status === 429) {
          throw new Error("Too many start attempts. Please wait a minute and try again.");
        }
        throw new Error(data.error || "Failed to get token");
      }

      const data = (await response.json()) as DeepgramTokenResponse;
      const fallbackExpiresAt = Date.now() + (data.expiresIn ?? 30) * 1000;
      const expiresAt = data.expiresAt ? Date.parse(data.expiresAt) : fallbackExpiresAt;

      tokenCacheRef.current = {
        token: data.token,
        expiresAt: Number.isFinite(expiresAt)
          ? expiresAt
          : fallbackExpiresAt,
      };

      return {
        token: data.token,
      };
    } catch (err) {
      console.error("Token fetch error:", err);
      tokenCacheRef.current = null;
      capturePipelineError(err, { stage: "deepgram-token" });
      // The session-aware start handler owns UI errors. A cancelled start's
      // delayed token failure must not change a newer session's state.
      throw err;
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

  const emitTranscript = useCallback((text: string, metadata: TranscriptSegmentMetadata) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const timing: TranscriptSegmentMetadata = {
      segmentId: metadata.segmentId,
      speechEndAt: metadata.speechEndAt,
      receivedAt: metadata.receivedAt,
    };

    addPipelineBreadcrumb(
      "transcript.emitted",
      {
        ...transcriptDiagnosticData(trimmed, includeTranscriptDiagnosticsRef.current),
        ...timing,
        transcriptionLatencyMs: Math.max(0, metadata.receivedAt - metadata.speechEndAt),
      }
    );
    setTranscript((prev) => {
      const newTranscript = prev ? `${prev} ${trimmed}` : trimmed;
      return newTranscript;
    });
    onTranscriptRef.current(trimmed, timing);
  }, []);

  // Internal stop function that accepts a reason
  const stopListeningInternal = useCallback((reason: StopReason) => {
    if (isStoppingRef.current) return;
    isStoppingRef.current = true;
    isStartingRef.current = false;
    addPipelineBreadcrumb("listener.stop", { reason });
    stopUsageTimer(reason);

    const recorder = mediaRecorderRef.current;
    const socket = socketRef.current;
    // MediaRecorder's final dataavailable event precedes stop. Waiting for
    // onstop and our ordered conversion queue keeps that final audio chunk.
    const audioDrained = recorder && recorder.state !== "inactive"
      ? new Promise<void>((resolve) => {
          recorder.onstop = () => { void audioSendQueueRef.current.then(resolve); };
          recorder.stop();
        })
      : audioSendQueueRef.current;
    mediaRecorderRef.current = null;

    if (socket) {
      const drain = drainTranscriptionSocket(socket, audioDrained);
      stopDrainRef.current = drain;
      void drain.then(() => {
        if (stopDrainRef.current === drain) stopDrainRef.current = null;
        if (socketRef.current === socket) socketRef.current = null;
      });
    }

    // The microphone stops immediately; only already captured audio drains.
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    setIsListening(false);
    setConnectionStatus(reason === "error" ? "error" : "idle");
    setInterimText("");
    interimTextRef.current = "";
  }, [stopUsageTimer]);

  // Keep ref updated for use in interval
  useEffect(() => {
    stopListeningInternalRef.current = stopListeningInternal;
  }, [stopListeningInternal]);

  const startListening = useCallback(async () => {
    if (stopDrainRef.current) {
      const waitingGeneration = sessionGenerationRef.current;
      await stopDrainRef.current;
      // A restart queued during drain must not reopen the microphone after
      // unmount, or race another start that already began the new session.
      if (sessionGenerationRef.current !== waitingGeneration) return;
    }
    if (isStartingRef.current || isListening) return;

    isStartingRef.current = true;
    const generation = ++sessionGenerationRef.current;
    addPipelineBreadcrumb("listener.start_requested");
    setError(null);
    setTranscript("");
    setInterimText("");
    interimTextRef.current = "";
    audioSendQueueRef.current = Promise.resolve();
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

      if (isStoppingRef.current || sessionGenerationRef.current !== generation) {
        stream.getTracks().forEach((track) => track.stop());
        if (sessionGenerationRef.current === generation) {
          isStartingRef.current = false;
          setConnectionStatus("idle");
        }
        return;
      }

      streamRef.current = stream;
      addPipelineBreadcrumb("listener.microphone_ready");

      // Get temporary token
      const tokenResponse = await getDeepgramToken();
      if (isStoppingRef.current || sessionGenerationRef.current !== generation) {
        stream.getTracks().forEach((track) => track.stop());
        if (streamRef.current === stream) {
          streamRef.current = null;
        }
        if (sessionGenerationRef.current === generation) {
          isStartingRef.current = false;
          setConnectionStatus("idle");
        }
        return;
      }
      const { token } = tokenResponse;
      addPipelineBreadcrumb("listener.deepgram_token_received");

      // Build Deepgram WebSocket URL with options
      // Note: Don't specify encoding - let Deepgram auto-detect from the audio stream
      const detectedLanguage = getDeepgramLanguage();
      console.log("[transcription] Using language:", detectedLanguage);
      addPipelineBreadcrumb("deepgram.connecting", { language: detectedLanguage });

      const params = new URLSearchParams({
        model: "nova-3",
        language: detectedLanguage,
        smart_format: "true",
        // Avoid Smart Format's entity-completion wait (up to three seconds).
        // Final fragments are coalesced by the extraction scheduler.
        no_delay: "true",
        endpointing: "300",
        interim_results: "true",
        utterance_end_ms: "1000",
        vad_events: "true",
        punctuate: "true",
        filler_words: "false",
      });

      const wsUrl = `wss://api.deepgram.com/v1/listen?${params.toString()}`;

      // Open WebSocket connection
      const socket = new WebSocket(wsUrl, ["bearer", token]);
      socketRef.current = socket;
      let segmentTracker: TranscriptSegmentTracker | null = null;

      socket.onopen = () => {
        if (isStoppingRef.current || sessionGenerationRef.current !== generation) {
          socket.close();
          return;
        }

        try {
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

          mediaRecorder.ondataavailable = (event) => {
            if (event.data.size === 0 || socket.readyState !== WebSocket.OPEN ||
                sessionGenerationRef.current !== generation) return;
            // Blob conversion is asynchronous; preserve audio order even if a
            // later, smaller chunk converts before an earlier chunk.
            audioSendQueueRef.current = audioSendQueueRef.current.then(async () => {
              const arrayBuffer = await event.data.arrayBuffer();
              if (socket.readyState === WebSocket.OPEN &&
                  sessionGenerationRef.current === generation) socket.send(arrayBuffer);
            }).catch((err) => {
              capturePipelineError(err, { stage: "transcription-audio" });
              if (sessionGenerationRef.current === generation && !isStoppingRef.current) {
                setError("Could not stream microphone audio. Please try again.");
                stopListeningInternalRef.current("error");
              }
            });
          };

          // Relative provider timestamps start when microphone capture starts.
          const captureStartedAt = Date.now();
          segmentTracker = new TranscriptSegmentTracker(`${captureStartedAt}-${generation}`, captureStartedAt);
          mediaRecorder.start(100);
        } catch (err) {
          capturePipelineError(err, { stage: "transcription-recorder" });
          setError("Could not record microphone audio. Please try again.");
          stopListeningInternalRef.current("error");
        }
      };

      socket.onmessage = (event) => {
        if (sessionGenerationRef.current !== generation || socketRef.current !== socket) return;
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
            // This only reports a gap after speech. Interim wording may still
            // be revised, so only provider is_final Results become claims.
            return;
          }

          if (data.type === "Results") {
            const result = data as DeepgramTranscriptResult;
            const text = result.channel?.alternatives?.[0]?.transcript || "";
            if (!segmentTracker) return;
            if (isStoppingRef.current && !result.is_final) return;
            const segment = segmentTracker.consume(result, Date.now());
            if (segment) {
              addPipelineBreadcrumb("deepgram.final_result", {
                ...transcriptDiagnosticData(
                  text,
                  includeTranscriptDiagnosticsRef.current
                ),
                speechFinal: result.speech_final,
              });
              emitTranscript(segment.text, segment);
            }
            const preview = isStoppingRef.current ? "" : segmentTracker.interimText;
            interimTextRef.current = preview;
            setInterimText(preview);
          }
        } catch (err) {
          console.error("Error parsing Deepgram message:", err);
        }
      };

      socket.onerror = (event) => {
        if (sessionGenerationRef.current !== generation || isStoppingRef.current) return;
        console.error("WebSocket error:", event);
        isStartingRef.current = false;
        setConnectionStatus("error");
        setError("Connection error. Please try again.");
        capturePipelineError(new Error("Deepgram WebSocket error"), {
          stage: "deepgram-websocket",
        });
        stopListeningInternalRef.current("error");
      };

      socket.onclose = (event) => {
        if (sessionGenerationRef.current !== generation) return;
        isStartingRef.current = false;
        addPipelineBreadcrumb("deepgram.closed", {
          code: event.code,
          wasClean: event.wasClean,
        }, event.code === 1000 ? "info" : "warning");
        if (!isStoppingRef.current) {
          stopListeningInternalRef.current("error");
          setConnectionStatus("error");
          setError("Connection closed unexpectedly. Please try again.");
          capturePipelineError(new Error("Deepgram WebSocket closed unexpectedly"), {
            stage: "deepgram-websocket",
            code: event.code,
          });
        }
        setIsListening(false);
        setInterimText("");
        interimTextRef.current = "";
        if (socketRef.current === socket) socketRef.current = null;
      };

    } catch (err) {
      if (sessionGenerationRef.current !== generation) return;
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
      sessionGenerationRef.current += 1;
      if (usageTimerRef.current) {
        clearInterval(usageTimerRef.current);
      }
      if (mediaRecorderRef.current?.state === "recording") {
        mediaRecorderRef.current.stop();
      }
      if (socketRef.current && socketRef.current.readyState < WebSocket.CLOSING) {
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
