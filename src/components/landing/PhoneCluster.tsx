import { useEffect, useRef } from "react";
import {
  Sparkles,
  Search,
  ClipboardList,
  Users,
  CheckCircle,
  type LucideIcon,
} from "lucide-react";
import ConnectedHIcon from "@/components/ConnectedHIcon";
import { getCategoryIcon } from "@/lib/categoryIcons";

/**
 * PhoneCluster — three iPhone-shaped mockups arranged in a fanned showcase.
 * Center phone is largest and faces forward; flanking phones are smaller
 * and tilted ±8°. Each shows a different Helpr app screen (Welcome /
 * Dashboard / How It Works) — abstracted UI only, no fabricated job
 * listings. Pure CSS — no image assets.
 */

type IconType = LucideIcon;

const PhoneFrame = ({
  width,
  rotate,
  children,
  className = "",
}: {
  width: number;
  rotate?: number;
  children: React.ReactNode;
  className?: string;
}) => (
  <div
    className={`relative rounded-[2rem] p-1 ${className}`}
    style={{
      width: `${width}px`,
      aspectRatio: "9 / 19",
      transform: rotate ? `rotate(${rotate}deg)` : undefined,
      background:
        "linear-gradient(180deg, hsl(var(--olivewood)) 0%, hsl(var(--bark)) 100%)",
      boxShadow:
        "0 0 0 1px hsla(0,0%,100%,0.3), 0 30px 60px -15px rgba(46,47,34,0.3), 0 60px 120px -30px rgba(46,47,34,0.22)",
    }}
  >
    <div
      className="w-full h-full rounded-[1.6rem] overflow-hidden flex flex-col relative"
      style={{ backgroundColor: "hsl(var(--parchment))" }}
    >
      {/* App-internal mesh wash */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(at 80% 10%, hsl(var(--burnt-sienna) / 0.08) 0%, transparent 50%), radial-gradient(at 30% 90%, hsl(var(--sage) / 0.1) 0%, transparent 60%)",
        }}
      />
      {children}
    </div>
  </div>
);

const StatusBar = ({ scale = 1 }: { scale?: number }) => (
  <div
    className="relative flex items-center justify-between"
    style={{
      paddingLeft: `${1.1 * scale}rem`,
      paddingRight: `${1.1 * scale}rem`,
      paddingTop: `${0.5 * scale}rem`,
      paddingBottom: `${0.2 * scale}rem`,
    }}
  >
    <span
      className="font-mono font-semibold"
      style={{ fontSize: `${0.55 * scale}rem`, color: "hsl(var(--ink-deep))" }}
    >
      9:41
    </span>
    <div
      className="rounded-full"
      style={{
        width: `${52 * scale}px`,
        height: `${14 * scale}px`,
        backgroundColor: "hsl(var(--olivewood))",
      }}
    />
    <span
      style={{ fontSize: `${0.5 * scale}rem`, color: "hsl(var(--ink-deep))" }}
    >
      ●●●
    </span>
  </div>
);

const HomeIndicator = ({ scale = 1 }: { scale?: number }) => (
  <div
    className="mx-auto rounded-full"
    style={{
      width: `${52 * scale}px`,
      height: `${3 * scale}px`,
      backgroundColor: "hsl(var(--olivewood))",
      opacity: 0.4,
      marginTop: `${0.4 * scale}rem`,
      marginBottom: `${0.3 * scale}rem`,
    }}
  />
);

/* ---------- Screen A: Welcome / Sign-in ---------- */
const WelcomeScreen = ({ scale = 1 }: { scale?: number }) => (
  <div className="relative flex-1 flex flex-col">
    <StatusBar scale={scale} />
    <div className="flex-1 flex flex-col items-center justify-center px-3 text-center gap-1.5">
      <div
        className="rounded-ds-md flex items-center justify-center"
        style={{
          width: `${44 * scale}px`,
          height: `${44 * scale}px`,
          backgroundColor: "rgba(255, 255, 255, 0.55)",
          border: "0.5px solid rgba(255, 255, 255, 0.6)",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.7)",
        }}
      >
        <ConnectedHIcon
          style={{
            width: `${22 * scale}px`,
            height: `${22 * scale}px`,
            color: "hsl(var(--ink-deep))",
          }}
        />
      </div>
      <p
        className="font-display font-bold italic tracking-tight"
        style={{
          fontSize: `${1.4 * scale}rem`,
          color: "hsl(var(--ink-deep))",
          marginTop: `${0.3 * scale}rem`,
        }}
      >
        Helpr
      </p>
      <p
        className="font-serif italic"
        style={{
          fontSize: `${0.55 * scale}rem`,
          color: "hsl(var(--stormy-sky))",
        }}
      >
        Made in Louisiana
      </p>
    </div>
    <div className="px-3 flex flex-col gap-1.5 pb-2">
      <div
        className="rounded-ds-sm flex items-center justify-center gap-1"
        style={{
          height: `${28 * scale}px`,
          // Sage on parchment is only ~3.6:1 — fails WCAG AA for normal
          // text. Use the darker `bark` token (also used by the real hero
          // primary CTA) so the in-phone mockup mirrors that contrast
          // pairing and clears the 4.5:1 threshold.
          backgroundColor: "hsl(var(--bark))",
          color: "hsl(var(--parchment))",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.2)",
        }}
      >
        <span
          className="font-sans font-semibold"
          style={{ fontSize: `${0.55 * scale}rem` }}
        >
          Get started
        </span>
      </div>
      <div
        className="rounded-ds-sm flex items-center justify-center"
        style={{
          height: `${24 * scale}px`,
          backgroundColor: "rgba(255, 255, 255, 0.5)",
          border: "0.5px solid rgba(255, 255, 255, 0.55)",
          color: "hsl(var(--ink-deep))",
        }}
      >
        <span
          className="font-sans font-medium"
          style={{ fontSize: `${0.5 * scale}rem` }}
        >
          Log in
        </span>
      </div>
    </div>
    <HomeIndicator scale={scale} />
  </div>
);

/* ---------- Screen B: Dashboard (main, center phone) ---------- */
const DashboardScreen = ({ scale = 1 }: { scale?: number }) => {
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
            <ConnectedHIcon
              style={{
                width: `${12 * scale}px`,
                height: `${12 * scale}px`,
                color: "hsl(var(--ink-deep))",
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
                className="rounded-full animate-pulse"
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

/* ---------- Screen C: How It Works ---------- */
const HowItWorksScreen = ({ scale = 1 }: { scale?: number }) => {
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

const PhoneCluster = () => {
  const clusterRef = useRef<HTMLDivElement>(null);

  // Parallax hover — phones tilt slightly toward the cursor as it moves
  // across the cluster. CSS variables --tilt-x / --tilt-y are read by the
  // phone wrappers below. Reduced-motion users get no tilt.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduceMotion) return;

    const el = clusterRef.current;
    if (!el) return;

    let raf = 0;
    const onMove = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      const px = (e.clientX - rect.left) / rect.width - 0.5;
      const py = (e.clientY - rect.top) / rect.height - 0.5;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        el.style.setProperty("--tilt-x", `${(-py * 4).toFixed(2)}deg`);
        el.style.setProperty("--tilt-y", `${(px * 6).toFixed(2)}deg`);
      });
    };
    const onLeave = () => {
      cancelAnimationFrame(raf);
      el.style.setProperty("--tilt-x", "0deg");
      el.style.setProperty("--tilt-y", "0deg");
    };

    el.addEventListener("mousemove", onMove);
    el.addEventListener("mouseleave", onLeave);
    return () => {
      el.removeEventListener("mousemove", onMove);
      el.removeEventListener("mouseleave", onLeave);
      cancelAnimationFrame(raf);
    };
  }, []);

  // Scroll-driven parallax — as the user scrolls past the hero, each
  // phone shifts up/rotates at a slightly different rate so the cluster
  // gains depth (front phone moves least, side phones move more). One
  // restrained effect, honors prefers-reduced-motion.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) return;

    const el = clusterRef.current;
    if (!el) return;

    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const rect = el.getBoundingClientRect();
        // 0 when cluster top reaches viewport top; 1 when scrolled an
        // entire viewport past it. Clamped, so values outside [0, 1.2]
        // are pinned (no surprise transforms when far above/below).
        const vh = window.innerHeight || 1;
        const raw = (vh * 0.6 - rect.top) / vh;
        const t = Math.max(-0.2, Math.min(1.2, raw));
        el.style.setProperty("--scroll-t", t.toFixed(3));
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div
      ref={clusterRef}
      // `overflow-hidden` clips the rotated phone bounding boxes so they
      // can't leak past the cluster's right edge at narrow viewports
      // (320 px iPhone-SE-1) and trigger the responsive audit's
      // "element overflows viewport" rule. The rotation transforms are
      // purely decorative — clipping a sub-pixel of the side phones'
      // shadow doesn't change the visual.
      className="relative mx-auto md:mx-0 md:ml-auto overflow-hidden"
      style={{
        width: "100%",
        maxWidth: "440px",
        height: "440px",
        perspective: "1200px",
        ["--tilt-x" as string]: "0deg",
        ["--tilt-y" as string]: "0deg",
        ["--scroll-t" as string]: "0",
      }}
    >
      {/* Phone A — left, behind. Welcome screen. Drifts up slightly more
          than the center phone on scroll (parallax depth). */}
      <div
        className="absolute z-10"
        style={{
          left: "0%",
          top: "12%",
          transform:
            "translateY(calc(var(--scroll-t) * -28px)) rotateX(var(--tilt-x)) rotateY(calc(var(--tilt-y) + var(--scroll-t) * -1.5deg))",
          transformStyle: "preserve-3d",
          filter: "blur(0.6px)",
          transition: "transform 0.3s ease-out",
          willChange: "transform",
        }}
      >
        <div className="phone-float-a">
          <PhoneFrame width={150} rotate={-3}>
            <WelcomeScreen scale={0.78} />
          </PhoneFrame>
        </div>
      </div>

      {/* Phone B — center, in front. Anchors the cluster — moves least
          on scroll so it stays the visual focal point. */}
      <div
        className="absolute z-20"
        style={{
          left: "50%",
          top: "0%",
          transform:
            "translateX(-50%) translateY(calc(var(--scroll-t) * -10px)) rotateX(var(--tilt-x)) rotateY(var(--tilt-y))",
          transformStyle: "preserve-3d",
          transition: "transform 0.3s ease-out",
          willChange: "transform",
        }}
      >
        <div className="phone-float-b">
          <PhoneFrame width={200} rotate={6}>
            <DashboardScreen scale={1} />
          </PhoneFrame>
        </div>
      </div>

      {/* Phone C — right, behind. Drifts up + tilts the opposite way
          from Phone A so the cluster reads as fanning open on scroll. */}
      <div
        className="absolute z-10"
        style={{
          right: "0%",
          top: "12%",
          transform:
            "translateY(calc(var(--scroll-t) * -28px)) rotateX(var(--tilt-x)) rotateY(calc(var(--tilt-y) + var(--scroll-t) * 1.5deg))",
          transformStyle: "preserve-3d",
          filter: "blur(0.6px)",
          transition: "transform 0.3s ease-out",
          willChange: "transform",
        }}
      >
        <div className="phone-float-c">
          <PhoneFrame width={150} rotate={13}>
            <HowItWorksScreen scale={0.78} />
          </PhoneFrame>
        </div>
      </div>
    </div>
  );
};

export default PhoneCluster;
