"use client";

import { useState, useRef, useCallback, useEffect } from "react";

type ConnectionStatus = "idle" | "connecting" | "connected" | "error";

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

interface UseContinuousListenerReturn {
  isListening: boolean;
  transcript: string;
  interimText: string;
  error: string | null;
  connectionStatus: ConnectionStatus;
  startListening: () => void;
  stopListening: () => void;
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

export function useContinuousListener(
  onTranscript: (text: string) => void
): UseContinuousListenerReturn {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interimText, setInterimText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("idle");

  const streamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const isStoppingRef = useRef(false);

  // Get temporary Deepgram token from our API
  const getDeepgramToken = async (): Promise<string | null> => {
    try {
      const response = await fetch("/api/deepgram-token", {
        method: "POST",
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to get token");
      }

      const { token } = await response.json();
      return token;
    } catch (err) {
      console.error("Token fetch error:", err);
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

  const startListening = useCallback(async () => {
    setError(null);
    setTranscript("");
    setInterimText("");
    setConnectionStatus("connecting");
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
      streamRef.current = stream;

      // Get temporary token
      const token = await getDeepgramToken();
      if (!token) {
        throw new Error("Failed to get transcription token");
      }

      // Build Deepgram WebSocket URL with options
      // Note: Don't specify encoding - let Deepgram auto-detect from the audio stream
      const detectedLanguage = getDeepgramLanguage();
      console.log("[transcription] Using language:", detectedLanguage);

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

        setConnectionStatus("connected");
        setIsListening(true);

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

          if (data.type === "Results") {
            const result = data as DeepgramTranscriptResponse;
            const text = result.channel?.alternatives?.[0]?.transcript || "";

            if (text.trim()) {
              if (result.is_final) {
                // Final result - add to transcript and trigger callback
                setTranscript((prev) => {
                  const newTranscript = prev ? `${prev} ${text.trim()}` : text.trim();
                  return newTranscript;
                });
                setInterimText("");
                onTranscript(text.trim());
              } else {
                // Interim result - show as faded text
                setInterimText(text.trim());
              }
            }
          }
        } catch (err) {
          console.error("Error parsing Deepgram message:", err);
        }
      };

      socket.onerror = (event) => {
        console.error("WebSocket error:", event);
        setConnectionStatus("error");
        setError("Connection error. Please try again.");
      };

      socket.onclose = (event) => {
        if (!isStoppingRef.current && event.code !== 1000) {
          setConnectionStatus("error");
          setError("Connection closed unexpectedly. Please try again.");
        } else {
          setConnectionStatus("idle");
        }
        setIsListening(false);
      };

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      setConnectionStatus("error");

      if (errorMessage.includes("Permission denied") || errorMessage.includes("NotAllowedError")) {
        setError("Microphone access denied. Please allow microphone access.");
      } else if (errorMessage.includes("NotFoundError")) {
        setError("No microphone found.");
      } else {
        setError(`Could not start listening: ${errorMessage}`);
      }
    }
  }, [getMimeType, onTranscript]);

  const stopListening = useCallback(() => {
    isStoppingRef.current = true;

    // Stop MediaRecorder
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    mediaRecorderRef.current = null;

    // Close WebSocket
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.close(1000);
    }
    socketRef.current = null;

    // Stop microphone stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    setIsListening(false);
    setInterimText("");
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isStoppingRef.current = true;
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
    transcript,
    interimText,
    error,
    connectionStatus,
    startListening,
    stopListening,
  };
}
