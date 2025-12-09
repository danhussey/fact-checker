import { NextResponse } from "next/server";
import OpenAI, { toFile } from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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

    // Skip very small files (likely empty/silence)
    if (audioFile.size < 1000) {
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

    return NextResponse.json({
      text: transcription.text,
    });
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
