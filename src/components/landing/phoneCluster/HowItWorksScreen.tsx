import { Search, ClipboardList, Users, CheckCircle } from "lucide-react";
import { type IconType } from "./types";
import { StatusBar, HomeIndicator } from "./PhoneChrome";

/* ---------- Screen C: How It Works ---------- */
export const HowItWorksScreen = ({ scale = 1 }: { scale?: number }) => {
  const steps: { Icon: IconType; n: string; label: string }[] = [
    { Icon: ClipboardList, n: "01", label: "Post" },
    { Icon: Users, n: "02", label: "Pick" },
    { Icon: CheckCircle, n: "03", label: "Pay" },
  ];
  return (
    <div className="relative flex-1 flex flex-col">
      <StatusBar scale={scale} />
      <div
        className="relative flex-1 flex flex-col"
        style={{
          paddingLeft: `${0.7 * scale}rem`,
          paddingRight: `${0.7 * scale}rem`,
          paddingTop: `${0.5 * scale}rem`,
          paddingBottom: `${0.5 * scale}rem`,
        }}
      >
        <span
          className="text-display-eyebrow"
          style={{ fontSize: `${0.55 * scale}rem` }}
        >
          How it works
        </span>
        <p
          className="font-display font-bold italic leading-tight"
          style={{
            marginTop: `${0.25 * scale}rem`,
            fontSize: `${0.95 * scale}rem`,
            color: "hsl(var(--ink-deep))",
          }}
        >
          Three steps.
        </p>
        <div
          className="flex flex-col mt-auto mb-2"
          style={{ gap: `${0.4 * scale}rem` }}
        >
          {steps.map(({ Icon, n, label }) => (
            <div
              key={n}
              className="rounded-ds-sm flex items-center"
              style={{
                gap: `${0.4 * scale}rem`,
                padding: `${0.4 * scale}rem`,
                backgroundColor: "rgba(255, 255, 255, 0.5)",
                border: "0.5px solid rgba(255, 255, 255, 0.5)",
              }}
            >
              <div
                className="rounded-md flex items-center justify-center"
                style={{
                  width: `${20 * scale}px`,
                  height: `${20 * scale}px`,
                  backgroundColor: "hsl(var(--sage) / 0.18)",
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
              </div>
              <div className="flex-1">
                <span
                  className="font-mono"
                  style={{
                    fontSize: `${0.45 * scale}rem`,
                    color: "hsl(var(--burnt-sienna))",
                  }}
                >
                  {n}
                </span>
                <p
                  className="font-display font-semibold leading-none"
                  style={{
                    fontSize: `${0.65 * scale}rem`,
                    color: "hsl(var(--ink-deep))",
                  }}
                >
                  {label}
                </p>
              </div>
            </div>
          ))}
        </div>
        <div
          className="rounded-ds-sm flex items-center justify-center"
          style={{
            gap: `${0.3 * scale}rem`,
            height: `${28 * scale}px`,
            backgroundColor: "rgba(255, 255, 255, 0.55)",
            border: "0.5px solid rgba(255, 255, 255, 0.55)",
            color: "hsl(var(--ink-deep))",
          }}
        >
          <Search
            style={{ width: `${10 * scale}px`, height: `${10 * scale}px` }}
            strokeWidth={1.5}
          />
          <span
            className="font-sans font-semibold tracking-tight"
            style={{ fontSize: `${0.55 * scale}rem` }}
          >
            Browse Jobs
          </span>
        </div>
      </div>
      <HomeIndicator scale={scale} />
    </div>
  );
};
