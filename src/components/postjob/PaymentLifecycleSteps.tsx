import { Megaphone, Handshake, Hammer, Wallet } from "lucide-react";
// The visibility delay is DERIVED, never retyped — `public.early_access_cutoff()`
// is the enforcement point and `earlyAccess.ts` is the client mirror the parity
// test already pins it to. See the "Posted" caption below.
import { MAX_EARLY_ACCESS_DELAY_MINUTES } from "@/lib/earlyAccess";

/** Extracted from PaymentSuccess (component-size ratchet, 2026-10-05); unchanged markup. */
// Visual lifecycle preview — replaces the dense paragraph that used to
// sit in this same slot. Keeps the same content (4 stages from job-state
// machine: open → accepted → in_progress → completed) but presents it
// as scannable steps so customers know what to expect next.
const LIFECYCLE_STEPS = [
  // "Your job is live for nearby Helprs." was not true for most of the people
  // it was about. `public.early_access_cutoff()` holds a brand-new job back
  // from anyone without the early-access perk for
  // MAX_EARLY_ACCESS_DELAY_MINUTES — Elite sees it at once, Free waits the
  // full window — so the poster was told their job had reached an audience
  // that, for the largest tier by far, could not see it yet. That reads as a
  // dead feed rather than as a delay, and it is the reason a poster gets no
  // applicants for twenty minutes and assumes nobody wants the job. Saying so
  // costs one clause and turns a silent wait into an expected one.
  {
    icon: Megaphone,
    label: "Posted",
    caption: `Live now — nearby Helprs see it within ${MAX_EARLY_ACCESS_DELAY_MINUTES} min.`,
  },
  { icon: Handshake, label: "Accepted", caption: "You review applicants and pick one." },
  { icon: Hammer, label: "In progress", caption: "Helpr arrives and gets to work." },
  { icon: Wallet, label: "Released", caption: "Both confirm — payment goes out." },
];

/** The four-step "what happens next" list on the confirmed-payment screen. */
export function PaymentLifecycleSteps() {
  return (
    <ol className="space-y-2.5 mt-3">
      {LIFECYCLE_STEPS.map((step, i) => {
        const Icon = step.icon;
        const isFirst = i === 0;
        return (
          <li key={step.label} className="flex items-start gap-3">
            <div
              className="w-8 h-8 rounded-ds-md flex items-center justify-center shrink-0 mt-0.5"
              style={{
                background: isFirst ? "hsl(var(--bark) / 0.12)" : "hsl(var(--olivewood) / 0.08)",
                border: `1px solid ${isFirst ? "hsl(var(--bark) / 0.25)" : "hsl(var(--olivewood) / 0.15)"}`,
              }}
            >
              <Icon
                className="w-4 h-4"
                strokeWidth={1.75}
                style={{ color: isFirst ? "hsl(var(--bark))" : "hsl(var(--olivewood))" }}
              />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-ds-13 font-medium" style={{ color: "hsl(var(--ink-deep))" }}>
                {step.label}
                {isFirst && (
                  <span
                    className="ml-2 text-ds-10 uppercase tracking-wider font-sans"
                    style={{ color: "hsl(var(--bark))" }}
                  >
                    you are here
                  </span>
                )}
              </p>
              <p className="font-sans text-ds-11 mt-0.5" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                {step.caption}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
