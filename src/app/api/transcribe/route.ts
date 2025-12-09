import { NextResponse } from "next/server";
import OpenAI, { toFile } from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Known Whisper hallucination patterns when transcribing silence/ambient noise
const HALLUCINATION_PATTERNS = [
  /share this video/i,
  /subscribe to/i,
  /like and subscribe/i,
  /bon appetit/i,
  /thank you for watching/i,
  /transcribed by/i,
  /please subscribe/i,
  /don't forget to/i,
  /チャンネル登録/,  // Japanese "subscribe"
  /ご視聴/,          // Japanese "watching"
  /動画をご覧/,       // Japanese video viewing
  /ありがとうございます/, // Japanese thanks
  /お願いします/,     // Japanese please
  /ごちそうさま/,     // Japanese after eating
  /😋|📢|🎵|🔔/,      // Emoji spam common in hallucinations
  /^\d+\.\s*\d+\.\s*\d+/,  // Number sequences "1. 2. 3."
  /^[\s.…,!?]+$/,    // Just punctuation/whitespace
];

function isLikelyHallucination(text: string): boolean {
  const trimmed = text.trim();

  // Very short text is suspicious
  if (trimmed.length < 5) return true;

  // Check against known patterns
  for (const pattern of HALLUCINATION_PATTERNS) {
    if (pattern.test(trimmed)) return true;
  }

  // High ratio of non-ASCII might be hallucination (unless user is speaking that language)
  // This catches Japanese/Korean text when we expect English
  const nonAsciiRatio = (trimmed.match(/[^\x00-\x7F]/g) || []).length / trimmed.length;
  if (nonAsciiRatio > 0.3 && trimmed.length < 50) return true;

  return false;
}

// Map browser MIME types to Whisper-supported extensions
function getWhisperFilename(mimeType: string, originalName: string): string {
  const type = mimeType.toLowerCase();

  // Whisper supported formats: flac, m4a, mp3, mp4, mpeg, mpga, oga, ogg, wav, webm
  if (type.includes("webm")) return "audio.webm";
  if (type.includes("mp4") || type.includes("m4a")) return "audio.m4a";
  if (type.includes("mp3") || type.includes("mpeg")) return "audio.mp3";
  if (type.includes("wav")) return "audio.wav";
  if (type.includes("ogg") || type.includes("oga")) return "audio.ogg";
  if (type.includes("flac")) return "audio.flac";

  // Try to get extension from original filename
  const ext = originalName.split(".").pop()?.toLowerCase();
  if (ext && ["webm", "m4a", "mp3", "mp4", "wav", "ogg", "flac"].includes(ext)) {
    return `audio.${ext}`;
  }

  // Default to webm (most common from MediaRecorder)
  return "audio.webm";
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const audioFile = formData.get("audio") as File | null;

    if (!audioFile) {
      return NextResponse.json(
        { error: "No audio file provided" },
        { status: 400 }
      );
    }

    // Check file size (Whisper limit is 25MB)
    if (audioFile.size > 25 * 1024 * 1024) {
      return NextResponse.json(
        { error: "Audio file too large. Maximum size is 25MB." },
        { status: 413 }
      );
    }

    // Skip small files (likely empty/silence) - increased threshold to reduce hallucinations
    if (audioFile.size < 8000) {
      return NextResponse.json({ text: "" });
    }

    // Get the correct filename for Whisper
    const filename = getWhisperFilename(audioFile.type, audioFile.name);

    // Convert to array buffer and create a proper file for OpenAI
    const arrayBuffer = await audioFile.arrayBuffer();
    const file = await toFile(arrayBuffer, filename, { type: audioFile.type });

    const transcription = await openai.audio.transcriptions.create({
      file: file,
      model: "whisper-1",
      response_format: "json",
    });

    // Filter out Whisper hallucinations (common when transcribing silence/ambient noise)
    const text = transcription.text?.trim() || "";
    if (isLikelyHallucination(text)) {
      return NextResponse.json({ text: "" });
    }

    return NextResponse.json({ text });
  } catch (error) {
    console.error("Transcription error:", error);

    if (error instanceof OpenAI.APIError) {
      if (error.status === 401) {
        return NextResponse.json(
          { error: "Invalid API key" },
          { status: 401 }
        );
      }

      // For format errors, return empty text instead of failing
      if (error.status === 400 && error.message?.includes("format")) {
        console.error("Invalid audio format, skipping chunk");
        return NextResponse.json({ text: "" });
      }

      return NextResponse.json(
        { error: "Transcription service error" },
        { status: error.status || 500 }
      );
    }

    return NextResponse.json(
      { error: "Failed to transcribe audio" },
      { status: 500 }
    );
  }
}
