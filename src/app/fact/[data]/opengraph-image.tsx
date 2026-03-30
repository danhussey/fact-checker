import { ImageResponse } from "next/og";
import { decodeShareData } from "@/lib/shareEncoding";
import type { Verdict } from "@/lib/types";

export const runtime = "edge";
export const alt = "Fact Check Result";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const verdictColors: Record<Verdict, { bg: string; text: string; accent: string }> = {
  true: { bg: "#f0fdf4", text: "#166534", accent: "#22c55e" },
  "mostly true": { bg: "#f0fdf4", text: "#166534", accent: "#22c55e" },
  "half true": { bg: "#fffbeb", text: "#92400e", accent: "#f59e0b" },
  "mostly false": { bg: "#fffbeb", text: "#92400e", accent: "#f59e0b" },
  false: { bg: "#fef2f2", text: "#991b1b", accent: "#ef4444" },
  unverified: { bg: "#f3f4f6", text: "#4b5563", accent: "#9ca3af" },
};

const verdictLabels: Record<Verdict, string> = {
  true: "TRUE",
  "mostly true": "MOSTLY TRUE",
  "half true": "HALF TRUE",
  "mostly false": "MOSTLY FALSE",
  false: "FALSE",
  unverified: "UNVERIFIED",
};

const confidenceLabels: Record<number, string> = {
  1: "Weak confidence",
  2: "Limited confidence",
  3: "Good confidence",
  4: "Strong confidence",
};

export default async function OGImage({
  params,
}: {
  params: Promise<{ data: string }>;
}) {
  const { data } = await params;
  const shareData = decodeShareData(data);

  if (!shareData) {
    return new ImageResponse(
      (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "100%",
            height: "100%",
            backgroundColor: "#fafafa",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          <span style={{ fontSize: 32, color: "#6b7280" }}>
            Fact Check Not Found
          </span>
        </div>
      ),
      { ...size },
    );
  }

  const colors = verdictColors[shareData.verdict];
  const verdictLabel = verdictLabels[shareData.verdict];
  const confLabel = confidenceLabels[shareData.confidence] || "";

  // Truncate claim for display
  const claimText =
    shareData.claim.length > 120
      ? shareData.claim.slice(0, 117) + "..."
      : shareData.claim;

  // Pick the first detail to show
  const detail =
    shareData.whatsTrue[0] ||
    shareData.whatsWrong[0] ||
    shareData.context[0] ||
    "";
  const detailText = detail.length > 100 ? detail.slice(0, 97) + "..." : detail;

  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: "100%",
          height: "100%",
          backgroundColor: "#fafafa",
          fontFamily: "system-ui, sans-serif",
          padding: 0,
        }}
      >
        {/* Accent bar at top */}
        <div
          style={{
            display: "flex",
            width: "100%",
            height: 8,
            backgroundColor: colors.accent,
          }}
        />

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            padding: "48px 60px 40px",
            justifyContent: "space-between",
          }}
        >
          {/* Top section */}
          <div style={{ display: "flex", flexDirection: "column" }}>
            {/* Verdict badge */}
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 32 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "12px 24px",
                  borderRadius: 999,
                  backgroundColor: colors.bg,
                  border: `2px solid ${colors.accent}`,
                }}
              >
                <span
                  style={{
                    fontSize: 24,
                    fontWeight: 700,
                    color: colors.text,
                    letterSpacing: "0.05em",
                  }}
                >
                  {verdictLabel}
                </span>
              </div>
              <span
                style={{
                  fontSize: 18,
                  color: "#6b7280",
                }}
              >
                {confLabel}
              </span>
            </div>

            {/* Claim text */}
            <div
              style={{
                display: "flex",
                fontSize: 36,
                fontWeight: 600,
                color: "#1f2937",
                lineHeight: 1.3,
                marginBottom: 24,
              }}
            >
              &ldquo;{claimText}&rdquo;
            </div>

            {/* Detail snippet */}
            {detailText && (
              <div
                style={{
                  display: "flex",
                  fontSize: 20,
                  color: "#6b7280",
                  lineHeight: 1.5,
                }}
              >
                {detailText}
              </div>
            )}
          </div>

          {/* Footer */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              <div
                style={{
                  display: "flex",
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  backgroundColor: colors.accent,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <span style={{ fontSize: 18, color: "#fff", fontWeight: 700 }}>
                  F
                </span>
              </div>
              <span
                style={{
                  fontSize: 20,
                  fontWeight: 600,
                  color: "#374151",
                }}
              >
                Fact Check
              </span>
            </div>

            {shareData.sourceNames.length > 0 && (
              <span
                style={{
                  fontSize: 16,
                  color: "#9ca3af",
                }}
              >
                Sources: {shareData.sourceNames.slice(0, 3).join(", ")}
              </span>
            )}
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
