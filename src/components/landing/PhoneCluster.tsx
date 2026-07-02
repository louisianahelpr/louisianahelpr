import { useEffect, useRef } from "react";
import { PhoneFrame } from "./phoneCluster/PhoneChrome";
import { WelcomeScreen } from "./phoneCluster/WelcomeScreen";
import { DashboardScreen } from "./phoneCluster/DashboardScreen";
import { HowItWorksScreen } from "./phoneCluster/HowItWorksScreen";

/**
 * PhoneCluster — three iPhone-shaped mockups arranged in a fanned showcase.
 * Center phone is largest and faces forward; flanking phones are smaller
 * and tilted ±8°. Each shows a different Helpr app screen (Welcome /
 * Dashboard / How It Works) — abstracted UI only, no fabricated job
 * listings. Pure CSS — no image assets.
 */

const PhoneCluster = () => {
  const clusterRef = useRef<HTMLDivElement>(null);

  // Parallax hover — phones tilt slightly toward the cursor as it moves
  // across the cluster. CSS variables --tilt-x / --tilt-y are read by the
  // phone wrappers below. Reduced-motion users and mobile viewports get no
  // tilt (hover parallax is pointer-only and contributes to TBT on mobile).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduceMotion) return;
    if (window.innerWidth < 768) return;

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
  // gains depth (front phone moves least, side phones move more). Skipped
  // on mobile (<768 px) and prefers-reduced-motion to avoid the scroll
  // listener cost that inflates TBT in mobile Lighthouse audits.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) return;
    if (window.innerWidth < 768) return;

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
      // `overflow-x-clip` guards against the rotated phone bounding boxes
      // leaking past the cluster's right edge (the responsive audit's
      // "element overflows viewport" rule) WITHOUT clipping them
      // vertically — full vertical bleed lets the fanned phones show their
      // top notch and bottom home-indicator instead of being cropped.
      className="relative mx-auto md:mx-0 md:ml-auto h-[320px] md:h-[480px] md:overflow-x-clip md:px-2"
      style={{
        width: "100%",
        maxWidth: "500px",
        perspective: "1200px",
        ["--tilt-x" as string]: "0deg",
        ["--tilt-y" as string]: "0deg",
        ["--scroll-t" as string]: "0",
      }}
    >
      {/* Phone A — left, behind. Welcome screen. Drifts up slightly more
          than the center phone on scroll (parallax depth). Hidden on mobile
          (<md) to prevent clipping at narrow viewports. */}
      <div className="hidden md:block">
        <div
          className="absolute z-10"
          style={{
            left: "8%",
            top: "13%",
            transform:
              "translateY(calc(var(--scroll-t) * -28px)) rotateX(var(--tilt-x)) rotateY(calc(var(--tilt-y) + var(--scroll-t) * -1.5deg))",
            transformStyle: "preserve-3d",
            filter: "blur(0.6px)",
            transition: "transform 0.3s ease-out",
            willChange: "transform",
          }}
        >
          <div className="phone-float-a">
            <PhoneFrame width={146} rotate={-7}>
              <WelcomeScreen scale={0.78} />
            </PhoneFrame>
          </div>
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
          from Phone A so the cluster reads as fanning open on scroll.
          Hidden on mobile (<md) to prevent clipping at narrow viewports. */}
      <div className="hidden md:block">
        <div
          className="absolute z-10"
          style={{
            right: "8%",
            top: "13%",
            transform:
              "translateY(calc(var(--scroll-t) * -28px)) rotateX(var(--tilt-x)) rotateY(calc(var(--tilt-y) + var(--scroll-t) * 1.5deg))",
            transformStyle: "preserve-3d",
            filter: "blur(0.6px)",
            transition: "transform 0.3s ease-out",
            willChange: "transform",
          }}
        >
          <div className="phone-float-c">
            <PhoneFrame width={146} rotate={7}>
              <HowItWorksScreen scale={0.78} />
            </PhoneFrame>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PhoneCluster;
