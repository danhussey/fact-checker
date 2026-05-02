import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import crypto from "crypto";
import { USAGE_LIMITS } from "@/lib/types";

const DEEPGRAM_TOKEN_TTL_SECONDS = 60;

interface DeepgramGrantResponse {
  access_token?: string;
  expires_in?: number;
}

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
  const apiKey = process.env.DEEPGRAM_API_KEY;

  if (!apiKey) {
    console.error("[api:deepgram-token] Missing DEEPGRAM_API_KEY");
    return NextResponse.json(
      { error: "Transcription service not configured" },
      { status: 500 }
    );
  }

  const grantResponse = await fetch("https://api.deepgram.com/v1/auth/grant", {
    method: "POST",
    headers: {
      Authorization: `Token ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ttl_seconds: DEEPGRAM_TOKEN_TTL_SECONDS }),
    cache: "no-store",
  });

  if (!grantResponse.ok) {
    console.error("[api:deepgram-token] Deepgram grant failed", {
      ip,
      status: grantResponse.status,
      requestId: grantResponse.headers.get("dg-request-id"),
      deepgramError: grantResponse.headers.get("dg-error"),
    });
    return NextResponse.json(
      { error: "Could not create transcription token" },
      { status: 502 }
    );
  }

  const grant = (await grantResponse.json()) as DeepgramGrantResponse;
  if (!grant.access_token || !grant.expires_in) {
    console.error("[api:deepgram-token] Deepgram grant response missing token", {
      ip,
      hasToken: Boolean(grant.access_token),
      expiresIn: grant.expires_in,
    });
    return NextResponse.json(
      { error: "Invalid transcription token response" },
      { status: 502 }
    );
  }

  console.log("[api:deepgram-token]", {
    ip,
    expiresIn: grant.expires_in,
    maxDurationMs: USAGE_LIMITS.maxSessionDurationMs,
  });

  return NextResponse.json(
    {
      token: grant.access_token,
      tokenType: "bearer",
      expiresIn: grant.expires_in,
      expiresAt: new Date(Date.now() + grant.expires_in * 1000).toISOString(),
      maxDurationMs: USAGE_LIMITS.maxSessionDurationMs,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}
