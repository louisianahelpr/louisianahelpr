import { Sparkles } from "lucide-react";
import { getCategoryIcon } from "@/lib/categoryIcons";
import helprEmblem from "@/assets/helpr-logo-96.webp";
import { type IconType } from "./types";
import { StatusBar, HomeIndicator } from "./PhoneChrome";

/* ---------- Screen B: Dashboard (main, center phone) ---------- */
export const DashboardScreen = ({ scale = 1 }: { scale?: number }) => {
  // Sourced from the canonical `job_category` icon map so the marketing
  // mockup never drifts from in-app surfaces (JobCard / JobFilters /
  // PostJob picker).
  const cats: { Icon: IconType; label: string }[] = [
    { Icon: getCategoryIcon("yard_work"), label: "Yard" },
    { Icon: getCategoryIcon("cleaning"), label: "Cleaning" },
    { Icon: getCategoryIcon("moving"), label: "Moving" },
    { Icon: getCategoryIcon("handyman"), label: "Handyman" },
  ];
  return (
    <div className="relative flex-1 flex flex-col">
      <StatusBar scale={scale} />
      {/* App header */}
      <div
        className="relative flex items-center justify-between"
        style={{
          paddingLeft: `${0.85 * scale}rem`,
          paddingRight: `${0.85 * scale}rem`,
          paddingTop: `${0.6 * scale}rem`,
          paddingBottom: `${0.4 * scale}rem`,
        }}
      >
        <div className="flex items-center" style={{ gap: `${0.3 * scale}rem` }}>
          <span
            className="rounded-md flex items-center justify-center"
            style={{
              width: `${20 * scale}px`,
              height: `${20 * scale}px`,
              backgroundColor: "rgba(255, 255, 255, 0.55)",
              border: "0.5px solid rgba(255, 255, 255, 0.6)",
            }}
          >
            <img
              src={helprEmblem}
              alt="Helpr"
              draggable={false}
              className="select-none"
              style={{
                width: `${14 * scale}px`,
                height: `${14 * scale}px`,
                objectFit: "contain",
              }}
            />
          </span>
          <span
            className="font-display font-bold italic tracking-tight"
            style={{
              fontSize: `${0.85 * scale}rem`,
              color: "hsl(var(--ink-deep))",
            }}
          >
            Helpr
          </span>
        </div>
        <div
          className="rounded-full"
          style={{
            width: `${20 * scale}px`,
            height: `${20 * scale}px`,
            backgroundColor: "hsl(var(--sage))",
          }}
        />
      </div>
      {/* Body */}
      <div
        className="relative flex-1 flex flex-col"
        style={{
          paddingLeft: `${0.65 * scale}rem`,
          paddingRight: `${0.65 * scale}rem`,
          paddingBottom: `${0.5 * scale}rem`,
          gap: `${0.5 * scale}rem`,
        }}
      >
        <div style={{ paddingLeft: `${0.2 * scale}rem`, marginTop: `${0.2 * scale}rem` }}>
          <p
            className="font-display font-bold leading-tight"
            style={{
              fontSize: `${1 * scale}rem`,
              color: "hsl(var(--ink-deep))",
            }}
          >
            Good morning,{" "}
            <em
              style={{
                fontStyle: "italic",
                color: "hsl(var(--burnt-sienna))",
              }}
            >
              neighbor.
            </em>
          </p>
        </div>
        {/* Live banner */}
        <div
          className="rounded-ds-md flex items-center justify-between"
          style={{
            padding: `${0.5 * scale}rem`,
            backgroundColor: "rgba(255, 255, 255, 0.55)",
            border: "0.5px solid rgba(255, 255, 255, 0.5)",
          }}
        >
          <div>
            <div className="flex items-center" style={{ gap: `${0.3 * scale}rem` }}>
              <span
                className="rounded-full motion-safe:animate-pulse"
                style={{
                  width: `${4 * scale}px`,
                  height: `${4 * scale}px`,
                  backgroundColor: "hsl(var(--burnt-sienna))",
                }}
              />
              <span
                className="font-mono uppercase tracking-wider font-medium"
                style={{
                  fontSize: `${0.5 * scale}rem`,
                  color: "hsl(var(--burnt-sienna))",
                }}
              >
                Live
              </span>
            </div>
            <p
              className="font-display font-bold tabular-nums leading-none"
              style={{
                marginTop: `${0.2 * scale}rem`,
                fontSize: `${1.1 * scale}rem`,
                color: "hsl(var(--ink-deep))",
              }}
            >
              46 active
            </p>
          </div>
          <span
            className="font-serif italic"
            style={{
              fontSize: `${0.55 * scale}rem`,
              color: "hsl(var(--stormy-sky))",
            }}
          >
            neighbors
          </span>
        </div>
        {/* Category grid */}
        <div
          className="grid grid-cols-2"
          style={{ gap: `${0.3 * scale}rem` }}
        >
          {cats.map(({ Icon, label }) => (
            <div
              key={label}
              className="rounded-ds-sm flex flex-col justify-between"
              style={{
                padding: `${0.4 * scale}rem`,
                height: `${44 * scale}px`,
                backgroundColor: "rgba(255, 255, 255, 0.45)",
                border: "0.5px solid rgba(255, 255, 255, 0.5)",
              }}
            >
              <Icon
                style={{
                  width: `${10 * scale}px`,
                  height: `${10 * scale}px`,
                  color: "hsl(var(--bark))",
                }}
                strokeWidth={1.5}
              />
              <span
                className="font-display font-semibold leading-none"
                style={{
                  fontSize: `${0.55 * scale}rem`,
                  color: "hsl(var(--ink-deep))",
                }}
              >
                {label}
              </span>
            </div>
          ))}
        </div>
        {/* CTA — `bark` rather than `sage` so the parchment label clears
            WCAG AA (4.5:1). Sage/parchment is only ~3.6:1, which axe flags
            and fails contrast in the rendered marketing screenshot. */}
        <div
          className="mt-auto rounded-ds-sm flex items-center justify-center"
          style={{
            gap: `${0.3 * scale}rem`,
            height: `${30 * scale}px`,
            backgroundColor: "hsl(var(--bark))",
            color: "hsl(var(--parchment))",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.2)",
          }}
        >
          <Sparkles
            style={{ width: `${10 * scale}px`, height: `${10 * scale}px` }}
            strokeWidth={1.5}
          />
          <span
            className="font-sans font-semibold tracking-tight"
            style={{ fontSize: `${0.55 * scale}rem` }}
          >
            Post a Request
          </span>
        </div>
      </div>
      <HomeIndicator scale={scale} />
    </div>
  );
};
