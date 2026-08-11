import { useState } from "react";
import { Switch } from "@/components/ui/switch";
import PageHeader from "@/components/PageHeader";
import { usePageTitle } from "@/hooks/usePageTitle";
import { hapticLight } from "@/lib/haptics";
import { isSimpleMode, setSimpleMode } from "@/lib/simpleMode";
import { Type, Sparkles, PhoneCall } from "lucide-react";

/**
 * Accessibility settings.
 *
 * Currently one real control — Simple Mode — plus a pointer to phone support.
 * A page rather than a row buried in a settings list, because the people most
 * likely to need it are the least likely to go spelunking for it, and because
 * the toggle deserves an explanation of what it will actually do.
 *
 * Document-scroll page (plain min-h-screen wrapper, no AppShell) per the
 * layout rules in CLAUDE.md — it is short-form settings content with a
 * back-button header.
 */
const Accessibility = () => {
  usePageTitle("Accessibility — Helpr");
  // Read once on mount: the class is already applied by initSimpleMode() in
  // main.tsx, so this is only mirroring it into React state for the Switch.
  const [simple, setSimple] = useState<boolean>(() => isSimpleMode());

  const toggle = (next: boolean) => {
    void hapticLight();
    setSimpleMode(next);
    setSimple(next);
  };

  return (
    <div className="min-h-screen bg-premium-page pb-safe-nav">
      <PageHeader title="Accessibility" />
      <div className="px-4 max-w-2xl mx-auto space-y-5 pt-2">
        <section className="liquid-glass rounded-ds-md p-5">
          <div className="flex items-start gap-3">
            <span
              className="w-10 h-10 rounded-ds-md shrink-0 inline-flex items-center justify-center"
              style={{ background: "hsl(var(--bark) / 0.10)" }}
            >
              <Type className="w-5 h-5" style={{ color: "hsl(var(--bark))" }} strokeWidth={1.75} />
            </span>
            <div className="min-w-0 flex-1">
              <h2
                className="font-display italic font-bold text-ds-16"
                style={{ color: "hsl(var(--ink-deep))" }}
              >
                Simple Mode
              </h2>
              <p
                className="font-serif italic text-ds-13 leading-relaxed mt-1"
                style={{ color: "hsl(var(--olivewood) / 0.85)" }}
              >
                Larger text, stronger contrast, bigger buttons, and no
                animation — across the whole app. Nothing is hidden or removed;
                everything is just easier to see and tap.
              </p>
            </div>
          </div>

          <label
            htmlFor="simple-mode"
            className="mt-4 flex items-center justify-between gap-3 rounded-ds-md p-4 cursor-pointer min-h-[44px]"
            style={{ background: "hsl(var(--olivewood) / 0.05)", border: "0.5px solid hsl(var(--olivewood) / 0.14)" }}
          >
            <span className="text-ds-13 leading-snug" style={{ color: "hsl(var(--ink-deep))" }}>
              <span className="font-semibold block">Simple Mode</span>
              {/* States the CURRENT state rather than the action, matching the
                  reference: a switch already communicates "flip me", and a
                  label that says "Turn on" next to an on switch is a puzzle. */}
              <span className="text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.85)" }}>
                {simple ? "Turned on" : "Turned off"}
              </span>
            </span>
            <Switch id="simple-mode" checked={simple} onCheckedChange={toggle} />
          </label>
        </section>

        <section className="liquid-glass rounded-ds-md p-5">
          <div className="flex items-start gap-3">
            <span
              className="w-10 h-10 rounded-ds-md shrink-0 inline-flex items-center justify-center"
              style={{ background: "hsl(var(--burnt-sienna) / 0.10)" }}
            >
              <PhoneCall className="w-5 h-5" style={{ color: "hsl(var(--burnt-sienna))" }} strokeWidth={1.75} />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="font-display italic font-bold text-ds-16" style={{ color: "hsl(var(--ink-deep))" }}>
                Prefer to talk to someone?
              </h2>
              <p
                className="font-serif italic text-ds-13 leading-relaxed mt-1"
                style={{ color: "hsl(var(--olivewood) / 0.85)" }}
              >
                You don't have to do any of this on a screen. Reach our support
                team and a person will walk you through posting a job.
              </p>
              <a
                href="/support"
                className="inline-flex items-center gap-1.5 mt-3 text-ds-13 font-sans font-semibold"
                style={{ color: "hsl(var(--bark))" }}
              >
                <Sparkles className="w-4 h-4" strokeWidth={2} />
                Contact support
              </a>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

export default Accessibility;
