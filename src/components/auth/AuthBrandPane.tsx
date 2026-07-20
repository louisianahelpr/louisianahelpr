import { Check, Clock, ShieldCheck } from "lucide-react";

/**
 * Desktop-only (lg+) brand + trust panel that fills the empty gutter on
 * auth pages when the form column would otherwise strand a narrow card
 * in a wide viewport. Passed to `<AuthShell desktopBrandPanel={...} />`
 * so mobile stays exactly as it was. Shared across every auth page so
 * users see one consistent editorial companion whether they're signing
 * in, signing up, or resetting their password.
 */
export function AuthBrandPane() {
  return (
    <div className="w-full space-y-6">
      <div className="inline-flex items-baseline gap-1">
        <span
          className="font-display italic font-bold leading-none"
          style={{ fontSize: "3rem", color: "hsl(var(--olivewood))", letterSpacing: "-0.02em" }}
        >
          Helpr
        </span>
        <span
          className="font-display italic font-bold leading-none"
          style={{ fontSize: "1.8rem", color: "hsl(var(--burnt-sienna))", letterSpacing: "0.22em", marginLeft: "0.12em" }}
        >
          · LA
        </span>
      </div>
      <p
        className="font-serif italic uppercase text-[0.72rem]"
        style={{ color: "hsl(var(--burnt-sienna) / 0.85)", letterSpacing: "0.22em" }}
      >
        Louisiana's Local Job Partner
      </p>
      <p
        className="font-display italic font-bold leading-tight"
        style={{ fontSize: "2.25rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.02em" }}
      >
        Everyday help, right in your parish.
      </p>
      <p
        className="font-serif text-[0.95rem] leading-relaxed"
        style={{ color: "hsl(var(--olivewood) / 0.85)" }}
      >
        Hire a Helpr or find local work — from yard work and moving help to
        errands and small fixes. Escrow-protected, verified neighbors, no
        middleman.
      </p>
      <div className="pt-2 space-y-2.5 text-[0.85rem]" style={{ color: "hsl(var(--olivewood))" }}>
        <div className="flex items-center gap-2.5">
          <ShieldCheck className="w-4 h-4 shrink-0" style={{ color: "hsl(var(--bark))" }} />
          <span>Every job is escrow-protected end to end.</span>
        </div>
        <div className="flex items-center gap-2.5">
          <Check className="w-4 h-4 shrink-0" style={{ color: "hsl(var(--bark))" }} />
          <span>ID-verified helpers, real reviews from neighbors.</span>
        </div>
        <div className="flex items-center gap-2.5">
          <Clock className="w-4 h-4 shrink-0" style={{ color: "hsl(var(--bark))" }} />
          <span>Post in under two minutes — get help the same day.</span>
        </div>
      </div>
    </div>
  );
}
