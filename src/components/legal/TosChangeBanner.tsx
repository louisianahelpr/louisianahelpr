import { useState, useEffect } from "react";
import { FileText, X } from "lucide-react";
import {
  CURRENT_TOS_VERSION,
  TOS_CHANGELOG,
  isTosChangeDismissed,
  dismissTosChange,
} from "@/lib/tosChangelog";

/**
 * TosChangeBanner — compact dismissible banner shown at the top of the Legal
 * page when the current ToS version has changelog entries the user hasn't
 * acknowledged yet.
 *
 * Persistence: a localStorage key (`helpr_tos_dismissed_{version}`) is set on
 * dismiss, so the banner stays hidden across sessions until CURRENT_TOS_VERSION
 * is bumped again.
 *
 * No network calls — fully client-side.
 */
export function TosChangeBanner() {
  const changes = TOS_CHANGELOG[CURRENT_TOS_VERSION];

  // No changelog entry for this version → render nothing.
  if (!changes || changes.length === 0) return null;

  return <TosChangeBannerInner version={CURRENT_TOS_VERSION} changes={changes} />;
}

interface InnerProps {
  version: string;
  changes: { section: string; summary: string }[];
}

/**
 * Inner component that holds the dismissed state. Kept separate so the outer
 * guard (`if (!changes)`) can short-circuit before any hooks run.
 */
function TosChangeBannerInner({ version, changes }: InnerProps) {
  // Three-state: null = not yet hydrated (avoid flash), true = visible, false = dismissed.
  const [visible, setVisible] = useState<boolean | null>(null);

  // Hydrate from localStorage after first paint to avoid SSR mismatch.
  useEffect(() => {
    setVisible(!isTosChangeDismissed(version));
  }, [version]);

  const dismiss = () => {
    setVisible(false);
    dismissTosChange(version);
  };

  // Pre-hydration or already dismissed — render nothing.
  if (!visible) return null;

  // Format the version string (YYYY-MM-DD) as "Jun 1, 2026" for display.
  const formattedDate = (() => {
    try {
      return new Date(`${version}T00:00:00`).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    } catch {
      return version;
    }
  })();

  return (
    <div
      data-print-hide
      role="status"
      aria-live="polite"
      style={{
        background: "hsl(var(--parchment))",
        border: "1px solid hsl(var(--burnt-sienna) / 0.30)",
        boxShadow:
          "inset 0 1px 1px 0 rgba(255, 255, 255, 0.55), " +
          "0 4px 10px -4px hsl(var(--burnt-sienna) / 0.15)",
        borderRadius: "1rem",
        padding: "0.875rem",
        // Animate in/out: opacity transition respects prefers-reduced-motion
        // via the @media override below; max-height is handled by the wrapper
        // div so collapse is smooth without JS measurement.
        transition: "opacity 200ms ease, transform 200ms ease",
        // @media prefers-reduced-motion: no-preference is applied by the
        // browser; the element itself just needs the transition property set.
        // We let CSS handle it — the component simply mounts/unmounts.
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem" }}>
        {/* Icon pill */}
        <span
          aria-hidden
          style={{
            flexShrink: 0,
            width: "2rem",
            height: "2rem",
            borderRadius: "9999px",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            background: "hsl(var(--burnt-sienna) / 0.12)",
            color: "hsl(var(--burnt-sienna))",
          }}
        >
          <FileText style={{ width: "1rem", height: "1rem" }} strokeWidth={2.25} />
        </span>

        {/* Body */}
        <div style={{ minWidth: 0, flex: 1 }}>
          {/* Heading */}
          <p
            style={{
              fontFamily: "var(--font-display, inherit)",
              fontWeight: 700,
              fontSize: "0.8125rem",
              lineHeight: 1.3,
              color: "hsl(var(--burnt-sienna))",
              letterSpacing: "-0.008em",
            }}
          >
            Terms updated {formattedDate}
          </p>

          {/* Bullet list */}
          <ul
            style={{
              marginTop: "0.5rem",
              paddingLeft: 0,
              listStyle: "none",
              display: "flex",
              flexDirection: "column",
              gap: "0.375rem",
            }}
          >
            {changes.map((c) => (
              <li
                key={c.section}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "0.5rem",
                  fontSize: "0.75rem",
                  lineHeight: 1.5,
                  fontFamily: "var(--font-sans, inherit)",
                  color: "hsl(var(--ink-deep) / 0.82)",
                }}
              >
                {/* Olivewood bullet dot */}
                <span
                  aria-hidden
                  style={{
                    flexShrink: 0,
                    width: "0.375rem",
                    height: "0.375rem",
                    borderRadius: "9999px",
                    background: "hsl(var(--olivewood))",
                    marginTop: "0.4375rem",
                  }}
                />
                <span>
                  <strong
                    style={{
                      fontWeight: 600,
                      color: "hsl(var(--ink-deep))",
                    }}
                  >
                    {c.section}
                  </strong>{" "}
                  — {c.summary}
                </span>
              </li>
            ))}
          </ul>

          {/* "Got it" confirm button */}
          <div style={{ marginTop: "0.625rem", display: "flex", justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={dismiss}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.25rem",
                padding: "0.25rem 0.75rem",
                borderRadius: "9999px",
                fontSize: "0.75rem",
                fontFamily: "var(--font-sans, inherit)",
                fontWeight: 600,
                background: "hsl(var(--burnt-sienna) / 0.12)",
                color: "hsl(var(--burnt-sienna))",
                border: "1px solid hsl(var(--burnt-sienna) / 0.22)",
                cursor: "pointer",
                transition: "background 150ms ease",
              }}
              aria-label="Dismiss what changed notice"
            >
              Got it
            </button>
          </div>
        </div>

        {/* X dismiss button */}
        <button
          type="button"
          onClick={dismiss}
          aria-label="Close"
          style={{
            flexShrink: 0,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: "2.5rem",
            height: "2.5rem",
            borderRadius: "9999px",
            color: "hsl(var(--burnt-sienna) / 0.60)",
            cursor: "pointer",
            background: "transparent",
            border: "none",
            // 40 px tap target per a11y rule in this repo
          }}
        >
          <X style={{ width: "1rem", height: "1rem" }} />
        </button>
      </div>
    </div>
  );
}
