"use client";

import { useState, useRef, useCallback, useEffect } from "react";

interface UseContinuousListenerReturn {
  isListening: boolean;
  transcript: string;
  error: string | null;
  startListening: () => void;
  stopListening: () => void;
}

export function useContinuousListener(
  onTranscript: (text: string) => void
): UseContinuousListenerReturn {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const isStoppingRef = useRef(false);
  const mimeTypeRef = useRef<string>("audio/mp4");
  const startNewRecordingRef = useRef<() => void>(() => {});
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const hadSpeechRef = useRef(false);

  const getMimeType = useCallback((): string => {
    if (typeof MediaRecorder === "undefined") return "audio/mp4";

    // Safari only supports audio/mp4, Chrome/Firefox prefer webm
    const types = [
      "audio/mp4",           // Safari (must be first for Safari compatibility)
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/wav",
    ];

    // Check if we're on Safari (Safari doesn't support webm)
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
    if (isSafari) {
      return "audio/mp4";
    }

    return types.find((t) => MediaRecorder.isTypeSupported(t)) || "audio/mp4";
  }, []);

  // Check if audio level indicates speech (not silence)
  const checkForSpeech = useCallback(() => {
    if (!analyserRef.current) return false;

    const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
    analyserRef.current.getByteFrequencyData(dataArray);

    // Calculate average volume level
    const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;

    // Low threshold - we want to catch speech, server filters hallucinations
    // Values typically: silence ~0-2, quiet speech ~3-10, normal speech ~10-50+
    return average > 2;
  }, []);

  // Send audio to server for transcription
  const sendForTranscription = useCallback(async (audioBlob: Blob, hadSpeech: boolean) => {
    // Skip if no speech was detected during this chunk
    if (!hadSpeech) {
      return;
    }

    if (audioBlob.size < 5000) {
      // Skip very small chunks (likely silence or too short)
      return;
    }

    try {
      // Determine file extension from MIME type
      const blobType = audioBlob.type || mimeTypeRef.current;
      let extension = "m4a"; // Default to m4a (Safari compatible, Whisper supported)
      if (blobType.includes("webm")) extension = "webm";
      else if (blobType.includes("mp4") || blobType.includes("m4a")) extension = "m4a";
      else if (blobType.includes("wav")) extension = "wav";
      else if (blobType.includes("ogg")) extension = "ogg";

      const formData = new FormData();
      formData.append("audio", audioBlob, `recording.${extension}`);

      const response = await fetch("/api/transcribe", {
        method: "POST",
        body: formData,
      });

      if (response.ok) {
        const { text } = await response.json();
        if (text && text.trim()) {
          setTranscript((prev) => {
            const newTranscript = prev ? `${prev} ${text.trim()}` : text.trim();
            return newTranscript;
          });
          onTranscript(text.trim());
        }
      }
    } catch (err) {
      console.error("Transcription error:", err);
    }
  }, [onTranscript]);

  // Create a new recorder and start recording
  const startNewRecording = useCallback(() => {
    if (!streamRef.current || isStoppingRef.current) return;

    chunksRef.current = [];
    hadSpeechRef.current = false;
    const mimeType = mimeTypeRef.current;

    const mediaRecorder = new MediaRecorder(streamRef.current, {
      mimeType,
      audioBitsPerSecond: 128000,
    });

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunksRef.current.push(event.data);
      }
      // Check for speech while recording
      if (checkForSpeech()) {
        hadSpeechRef.current = true;
      }
    };

    mediaRecorder.onstop = () => {
      // Combine chunks into a single blob with proper headers
      if (chunksRef.current.length > 0) {
        const audioBlob = new Blob(chunksRef.current, { type: mimeType });
        sendForTranscription(audioBlob, hadSpeechRef.current);
      }

      // Start a new recording if still listening (use ref to avoid stale closure)
      if (!isStoppingRef.current && streamRef.current) {
        startNewRecordingRef.current();
      }
    };

    mediaRecorder.onerror = () => {
      setError("Recording error occurred");
    };

    mediaRecorderRef.current = mediaRecorder;
    mediaRecorder.start(500); // Get data every 500ms to check speech more often
  }, [sendForTranscription, checkForSpeech]);

  // Keep ref in sync with latest callback
  useEffect(() => {
    startNewRecordingRef.current = startNewRecording;
  }, [startNewRecording]);

  // Stop current recording (which triggers onstop -> sends for transcription -> starts new recording)
  const cycleRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
  }, []);

  const startListening = useCallback(async () => {
    setError(null);
    setTranscript("");
    chunksRef.current = [];
    isStoppingRef.current = false;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 16000,
        },
      });

      streamRef.current = stream;
      mimeTypeRef.current = getMimeType();

      // Set up audio analyser for voice activity detection
      const audioContext = new AudioContext();
      const analyser = audioContext.createAnalyser();
      const source = audioContext.createMediaStreamSource(stream);
      analyser.fftSize = 256;
      source.connect(analyser);
      audioContextRef.current = audioContext;
      analyserRef.current = analyser;

      setIsListening(true);

      // Start the first recording
      startNewRecording();

      // Cycle recordings every 6 seconds
      intervalRef.current = setInterval(() => {
        cycleRecording();
      }, 6000);

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";

      if (errorMessage.includes("Permission denied") || errorMessage.includes("NotAllowedError")) {
        setError("Microphone access denied. Please allow microphone access.");
      } else if (errorMessage.includes("NotFoundError")) {
        setError("No microphone found.");
      } else {
        setError(`Could not access microphone: ${errorMessage}`);
      }
    }
  }, [getMimeType, startNewRecording, cycleRecording]);

  const stopListening = useCallback(() => {
    isStoppingRef.current = true;

    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    // Clean up audio context
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    analyserRef.current = null;

    mediaRecorderRef.current = null;
    setIsListening(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isStoppingRef.current = true;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      if (mediaRecorderRef.current?.state === "recording") {
        mediaRecorderRef.current.stop();
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, []);

  return {
    isListening,
    transcript,
    error,
    startListening,
    stopListening,
  };
}
