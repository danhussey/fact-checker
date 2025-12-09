import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import crypto from "crypto";

// Hash IP for privacy while maintaining pattern detection
function hashIP(ip: string): string {
  return crypto.createHash("sha256").update(ip).digest("hex").slice(0, 12);
}

// Rate limit configuration per endpoint (requests per minute)
const RATE_LIMITS: Record<string, number> = {
  "/api/transcribe": 10,      // Most expensive (Whisper)
  "/api/extract-claims": 30,
  "/api/fact-check": 30,
};

const WINDOW_MS = 60 * 1000; // 1 minute window

// In-memory store: IP -> { endpoint -> { count, resetTime } }
const rateLimitStore = new Map<string, Map<string, { count: number; resetTime: number }>>();

// Cleanup old entries every 5 minutes
let lastCleanup = Date.now();
const CLEANUP_INTERVAL = 5 * 60 * 1000;

function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;

  lastCleanup = now;
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

export function middleware(request: NextRequest) {
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
  const hashedIP = hashIP(ip);
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

  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
