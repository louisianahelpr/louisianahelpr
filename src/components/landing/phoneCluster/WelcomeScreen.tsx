import helprEmblem from "@/assets/helpr-logo-96.webp";
import { StatusBar, HomeIndicator } from "./PhoneChrome";

/* ---------- Screen A: Welcome / Sign-in ---------- */
export const WelcomeScreen = ({ scale = 1 }: { scale?: number }) => (
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
        <img
          src={helprEmblem}
          alt="Helpr"
          draggable={false}
          className="select-none"
          style={{
            width: `${26 * scale}px`,
            height: `${26 * scale}px`,
            objectFit: "contain",
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
