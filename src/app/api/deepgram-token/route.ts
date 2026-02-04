import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import crypto from "crypto";
import { USAGE_LIMITS } from "@/lib/types";

function getClientIP(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") || "unknown";
}

function hashIP(ip: string): string {
  return crypto.createHash("sha256").update(ip).digest("hex").slice(0, 12);
}

export async function POST(request: NextRequest) {
  const ip = hashIP(getClientIP(request));

  if (!process.env.DEEPGRAM_API_KEY) {
    console.error("[api:deepgram-token] Missing DEEPGRAM_API_KEY");
    return NextResponse.json(
      { error: "Transcription service not configured" },
      { status: 500 }
    );
  }

  // Get sessions remaining from middleware header (or default to max)
  const sessionsRemainingHeader = request.headers.get("X-Sessions-Remaining");
  const sessionsRemaining = sessionsRemainingHeader
    ? parseInt(sessionsRemainingHeader, 10)
    : USAGE_LIMITS.maxDailyTokenRequests;

  // Return the API key for WebSocket auth
  // Security: This endpoint is rate-limited (5 req/min) and daily-limited (4/day) in middleware
  console.log("[api:deepgram-token]", { ip, sessionsRemaining });

  return NextResponse.json({
    token: process.env.DEEPGRAM_API_KEY,
    sessionsRemaining,
    maxDurationMs: USAGE_LIMITS.maxSessionDurationMs,
  });
}
