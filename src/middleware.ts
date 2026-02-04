import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Hash IP for privacy while maintaining pattern detection (Edge-compatible)
async function hashIP(ip: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(ip);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
  return hashHex.slice(0, 12);
}

// Rate limit configuration per endpoint (requests per minute)
const RATE_LIMITS: Record<string, number> = {
  "/api/transcribe": 10,       // Legacy Whisper (fallback)
  "/api/deepgram-token": 5,    // Token generation (one per session)
  "/api/extract-claims": 30,
  "/api/fact-check": 30,
};

const WINDOW_MS = 60 * 1000; // 1 minute window

// In-memory store: IP -> { endpoint -> { count, resetTime } }
const rateLimitStore = new Map<string, Map<string, { count: number; resetTime: number }>>();

// Daily token usage store: IP -> { count, date }
const dailyTokenStore = new Map<string, { count: number; date: string }>();
const MAX_DAILY_TOKENS = 4; // Max 4 sessions per day per IP

// Cleanup old entries every 5 minutes
let lastCleanup = Date.now();
const CLEANUP_INTERVAL = 5 * 60 * 1000;

function getTodayKey(): string {
  return new Date().toISOString().split("T")[0];
}

function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;

  lastCleanup = now;
  const today = getTodayKey();

  for (const [ip, endpoints] of rateLimitStore) {
    for (const [endpoint, data] of endpoints) {
      if (now > data.resetTime) {
        endpoints.delete(endpoint);
      }
    }
    if (endpoints.size === 0) {
      rateLimitStore.delete(ip);
    }
  }

  // Cleanup daily token store (remove entries from previous days)
  for (const [ip, data] of dailyTokenStore) {
    if (data.date !== today) {
      dailyTokenStore.delete(ip);
    }
  }
}

function checkDailyTokenLimit(ip: string): { allowed: boolean; remaining: number } {
  const today = getTodayKey();
  const data = dailyTokenStore.get(ip);

  if (!data || data.date !== today) {
    // First request of the day or new day
    dailyTokenStore.set(ip, { count: 1, date: today });
    return { allowed: true, remaining: MAX_DAILY_TOKENS - 1 };
  }

  if (data.count >= MAX_DAILY_TOKENS) {
    return { allowed: false, remaining: 0 };
  }

  data.count++;
  return { allowed: true, remaining: MAX_DAILY_TOKENS - data.count };
}


function getClientIP(request: NextRequest): string {
  // Vercel/Cloudflare headers
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  const realIP = request.headers.get("x-real-ip");
  if (realIP) {
    return realIP;
  }
  return "unknown";
}

function isRateLimited(ip: string, endpoint: string, limit: number): { limited: boolean; retryAfter: number } {
  const now = Date.now();

  // Get or create IP entry
  if (!rateLimitStore.has(ip)) {
    rateLimitStore.set(ip, new Map());
  }
  const ipStore = rateLimitStore.get(ip)!;

  // Get or create endpoint entry
  const endpointData = ipStore.get(endpoint);

  if (!endpointData || now > endpointData.resetTime) {
    // New window
    ipStore.set(endpoint, { count: 1, resetTime: now + WINDOW_MS });
    return { limited: false, retryAfter: 0 };
  }

  if (endpointData.count >= limit) {
    // Rate limited
    const retryAfter = Math.ceil((endpointData.resetTime - now) / 1000);
    return { limited: true, retryAfter };
  }

  // Increment count
  endpointData.count++;
  return { limited: false, retryAfter: 0 };
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Only rate limit API routes
  if (!pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  // Check if this endpoint has rate limiting
  const limit = RATE_LIMITS[pathname];
  if (!limit) {
    return NextResponse.next();
  }

  // Periodic cleanup
  cleanup();

  const ip = getClientIP(request);
  const hashedIP = await hashIP(ip);
  const { limited, retryAfter } = isRateLimited(hashedIP, pathname, limit);

  if (limited) {
    console.log("[rate-limit]", { ip: hashedIP, endpoint: pathname, retryAfter });
    return new NextResponse(
      JSON.stringify({ error: "Too many requests. Please slow down." }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(retryAfter),
        },
      }
    );
  }

  // Special handling for deepgram-token: enforce daily limit
  if (pathname === "/api/deepgram-token" && request.method === "POST") {
    const { allowed, remaining } = checkDailyTokenLimit(hashedIP);

    if (!allowed) {
      console.log("[daily-limit]", { ip: hashedIP, endpoint: pathname });
      return new NextResponse(
        JSON.stringify({
          error: "Daily session limit reached. Please try again tomorrow.",
          dailyLimitExceeded: true,
          sessionsRemaining: 0,
        }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
          },
        }
      );
    }

    // Pass sessions remaining to API route via header
    const response = NextResponse.next();
    response.headers.set("X-Sessions-Remaining", String(remaining));
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
