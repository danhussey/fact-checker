import { NextResponse } from "next/server";
import crypto from "crypto";

function getClientIP(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") || "unknown";
}

function hashIP(ip: string): string {
  return crypto.createHash("sha256").update(ip).digest("hex").slice(0, 12);
}

export async function POST(request: Request) {
  const ip = hashIP(getClientIP(request));

  if (!process.env.DEEPGRAM_API_KEY) {
    console.error("[api:deepgram-token] Missing DEEPGRAM_API_KEY");
    return NextResponse.json(
      { error: "Transcription service not configured" },
      { status: 500 }
    );
  }

  // Return the API key for WebSocket auth
  // Security: This endpoint is rate-limited (5 req/min) in middleware
  console.log("[api:deepgram-token]", { ip });

  return NextResponse.json({
    token: process.env.DEEPGRAM_API_KEY,
  });
}
