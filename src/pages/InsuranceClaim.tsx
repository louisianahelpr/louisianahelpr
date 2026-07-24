import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Camera,
  FileText,
  CheckCircle2,
  ShieldCheck,
  Lock,
  ImageIcon,
  Building2,
  Mail,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import PageHeader from "@/components/PageHeader";
import PublicLayout from "@/components/marketing/PublicLayout";
import { isNativePlatform } from "@/lib/nativeInit";
import { usePageMeta } from "@/hooks/usePageMeta";

type DamageChip =
  | "roof"
  | "flooding"
  | "tree"
  | "structural"
  | "electrical"
  | "general";

const DAMAGE_CHIPS: { id: DamageChip; label: string }[] = [
  { id: "roof", label: "Roof damage" },
  { id: "flooding", label: "Flooding / water" },
  { id: "tree", label: "Tree / debris removal" },
  { id: "structural", label: "Structural" },
  { id: "electrical", label: "Electrical / HVAC" },
  { id: "general", label: "General storm prep" },
];

const damageToCategory: Record<DamageChip, string> = {
  roof: "handyman",
  flooding: "handyman",
  tree: "yard_work",
  structural: "handyman",
  electrical: "handyman",
  general: "storm_prep",
};

const damageToTitle: Record<DamageChip, string> = {
  roof: "Roof damage repair after storm",
  flooding: "Flooding and water damage cleanup",
  tree: "Tree and debris removal",
  structural: "Structural storm damage assessment",
  electrical: "Electrical and HVAC storm damage repair",
  general: "General storm prep and cleanup",
};

const InsuranceClaim = () => {
  const navigate = useNavigate();
  const [selectedDamage, setSelectedDamage] = useState<DamageChip>("roof");
  const [city, setCity] = useState("");

  usePageMeta({
    title: "Insurance Claim Concierge — Louisiana Helpr",
    description:
      "Storm damage in Louisiana? We connect you with verified contractors while you file your insurance claim. Roof, flooding, debris, and more.",
    canonical: "https://www.louisianahelpr.com/insurance-claim",
    ogTitle: "Storm damage? Louisiana Helpr handles the contractor side.",
    ogDescription:
      "Find verified local contractors for storm damage while you file your insurance claim — roofing, flooding, debris removal, and more.",
  });

  const handleFindHelpr = () => {
    const category = damageToCategory[selectedDamage];
    const title = encodeURIComponent(damageToTitle[selectedDamage]);
    navigate(
      `/post-job?category=${category}&title=${title}&urgent=true`,
    );
  };

  return (
    <PublicLayout>
      {/* PageHeader is the in-app top bar (brand + BACK + right slot). On web it
          stacks under PublicLayout's marketing nav AND its "Back to home" link,
          producing two back buttons 35px apart at 375px. Native-only, with an
          inline title on web — the pattern DataRights.tsx:113 already
          established for exactly this bug. */}
      {isNativePlatform ? (
        <PageHeader
          eyebrow="Insurance"
          title="Claim Concierge"
        />
      ) : (
        <div className="max-w-5xl lg:max-w-6xl xl:max-w-7xl 2xl:max-w-[90rem] mx-auto px-5 lg:px-8 xl:px-12 pt-8">
          <span
            className="font-serif italic uppercase"
            style={{ fontSize: "0.62rem", color: "hsl(var(--burnt-sienna))", letterSpacing: "0.18em" }}
          >
            Insurance
          </span>
          <h1 className="text-page-title leading-tight mt-1">Claim Concierge</h1>
        </div>
      )}

      <div className="mx-auto max-w-5xl lg:max-w-6xl xl:max-w-7xl 2xl:max-w-[90rem] px-5 lg:px-8 pb-12 space-y-8">

        {/* ── Hero ── */}
        <div
          className="rounded-2xl p-6 lg:p-8 space-y-3 relative overflow-hidden"
          style={{
            background:
              "linear-gradient(135deg, hsl(var(--burnt-sienna) / 0.10) 0%, hsl(var(--stormy-sky) / 0.12) 100%)",
            border: "1px solid hsl(var(--burnt-sienna) / 0.20)",
          }}
        >
          <div
            aria-hidden
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                "radial-gradient(ellipse 70% 50% at 95% 0%, hsl(var(--stormy-sky) / 0.18) 0%, transparent 70%)",
            }}
          />
          <span className="text-display-eyebrow">
            Storm damage?
          </span>
          <h2
            className="font-display italic font-bold leading-[1.05] text-balance"
            style={{
              fontSize: "clamp(1.75rem, 4vw + 0.5rem, 2.75rem)",
              color: "hsl(var(--ink-deep))",
              letterSpacing: "-0.025em",
            }}
          >
            We handle{" "}
            <span style={{ color: "hsl(var(--burnt-sienna))" }}>
              the contractor side.
            </span>
          </h2>
          <p
            className="font-serif italic text-ds-16 leading-relaxed max-w-lg"
            style={{ color: "hsl(var(--olivewood))" }}
          >
            After storm or flood damage, filing your insurance claim and finding
            a reliable contractor happen at the same time. Louisiana Helpr
            connects you with verified local pros while you work through the
            claims process.
          </p>
        </div>

        {/* ── 3-step explainer ── */}
        <section className="space-y-3">
          <h3
            className="font-display italic font-semibold text-ds-18"
            style={{ color: "hsl(var(--ink-deep))" }}
          >
            How it works
          </h3>
          <div className="space-y-3">
            {[
              {
                step: "1",
                icon: Camera,
                title: "Document your damage",
                bullets: [
                  "Take photos now — before any cleanup begins.",
                  "Use Helpr's scope video feature so a contractor can assess remotely.",
                  "Keep a written log of what was damaged and when.",
                ],
                accent: "burnt-sienna",
              },
              {
                step: "2",
                icon: FileText,
                title: "File your claim",
                bullets: [
                  "Contact your insurer — we don't process claims, but we make the contractor side easier.",
                  "Your adjuster will ask for contractor estimates; we help you find verified ones fast.",
                  "Don't wait on a contractor before filing — the two can happen in parallel.",
                ],
                accent: "stormy-sky",
              },
              {
                step: "3",
                icon: CheckCircle2,
                title: "Book a verified Helpr",
                bullets: [
                  "Browse ID-verified contractors with the right credential tier for your job.",
                  "Helpr Escrow means payment is held until the work is done right.",
                  "Photo and video documentation built in for your claim file.",
                ],
                accent: "sage",
              },
            ].map(({ step, icon: Icon, title, bullets, accent }) => (
              <div
                key={step}
                className="liquid-glass rounded-xl p-4 lg:p-5"
              >
                <div className="flex items-start gap-4">
                  <div className="flex flex-col items-center gap-1.5 shrink-0">
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center font-display font-bold text-ds-13"
                      style={{
                        background: `hsl(var(--${accent}) / 0.15)`,
                        color: `hsl(var(--${accent}))`,
                      }}
                    >
                      {step}
                    </div>
                  </div>
                  <div className="space-y-2 flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Icon
                        className="w-4 h-4 shrink-0"
                        style={{ color: `hsl(var(--${accent}))` }}
                        strokeWidth={1.75}
                      />
                      <p
                        className="font-sans font-semibold text-ds-14"
                        style={{ color: "hsl(var(--ink-deep))" }}
                      >
                        {title}
                      </p>
                    </div>
                    <ul className="space-y-1">
                      {bullets.map((b, i) => (
                        <li
                          key={i}
                          className="flex items-start gap-2 font-sans text-ds-12 leading-snug"
                          style={{ color: "hsl(var(--olivewood))" }}
                        >
                          <span
                            className="mt-1.5 w-1 h-1 rounded-full shrink-0"
                            style={{
                              background: `hsl(var(--${accent}) / 0.6)`,
                            }}
                          />
                          {b}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Start here form ── */}
        <section className="liquid-glass rounded-2xl p-5 lg:p-6 space-y-5">
          <h3
            className="font-display italic font-semibold text-ds-18"
            style={{ color: "hsl(var(--ink-deep))" }}
          >
            Start here
          </h3>

          {/* Damage chips */}
          <div className="space-y-2">
            <label
              className="font-sans text-ds-13 font-medium"
              style={{ color: "hsl(var(--ink-deep))" }}
            >
              What type of damage?
            </label>
            <div className="flex flex-wrap gap-2">
              {DAMAGE_CHIPS.map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setSelectedDamage(id)}
                  className="px-3 py-1.5 rounded-full text-ds-12 font-sans font-medium transition-all"
                  style={
                    selectedDamage === id
                      ? {
                          background: "hsl(var(--burnt-sienna))",
                          color: "hsl(var(--parchment))",
                          boxShadow:
                            "0 2px 8px hsl(var(--burnt-sienna) / 0.35)",
                        }
                      : {
                          background: "hsl(var(--parchment) / 0.6)",
                          color: "hsl(var(--olivewood))",
                          border: "1px solid hsl(var(--olivewood) / 0.2)",
                        }
                  }
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* City */}
          <div className="space-y-1.5">
            <label
              htmlFor="claim-city"
              className="font-sans text-ds-13 font-medium"
              style={{ color: "hsl(var(--ink-deep))" }}
            >
              Approximate city / area
            </label>
            <input
              id="claim-city"
              type="text"
              placeholder="e.g. Baton Rouge, New Orleans, Lafayette…"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="w-full rounded-ds-md px-3 py-2.5 text-ds-14 font-sans outline-none focus:ring-2"
              style={{
                background: "hsl(var(--parchment) / 0.5)",
                border: "1px solid hsl(var(--olivewood) / 0.25)",
                color: "hsl(var(--ink-deep))",
              }}
            />
          </div>

          <Button
            variant="bark"
            size="xl"
            className="w-full rounded-ds-md"
            onClick={handleFindHelpr}
          >
            Find a Verified Helpr
          </Button>
        </section>

        {/* ── Trust signals ── */}
        <section className="grid sm:grid-cols-3 gap-3">
          {[
            {
              icon: ShieldCheck,
              label: "Licensed trades verified",
              body: "Credential tier displayed on every contractor profile.",
            },
            {
              icon: Lock,
              label: "Helpr Escrow",
              body: "Payment released only after the work is approved.",
            },
            {
              icon: ImageIcon,
              label: "Photo documentation",
              body: "Built-in job photos help support your insurance claim.",
            },
          ].map(({ icon: Icon, label, body }) => (
            <div
              key={label}
              className="flex items-start gap-3 p-3 rounded-xl"
              style={{
                background: "hsl(var(--burnt-sienna) / 0.06)",
                border: "1px solid hsl(var(--burnt-sienna) / 0.14)",
              }}
            >
              <Icon
                className="w-4 h-4 mt-0.5 shrink-0"
                style={{ color: "hsl(var(--burnt-sienna))" }}
                strokeWidth={1.75}
              />
              <div>
                <p
                  className="font-sans font-semibold text-ds-12"
                  style={{ color: "hsl(var(--ink-deep))" }}
                >
                  {label}
                </p>
                <p
                  className="font-sans text-ds-11 leading-snug mt-0.5"
                  style={{ color: "hsl(var(--olivewood))" }}
                >
                  {body}
                </p>
              </div>
            </div>
          ))}
        </section>

        {/* ── Insurance adjuster / carrier section ── */}
        <section
          className="rounded-2xl p-5 lg:p-6 space-y-3"
          style={{
            background:
              "linear-gradient(135deg, hsl(var(--stormy-sky) / 0.08) 0%, hsl(var(--burnt-sienna) / 0.06) 100%)",
            border: "1px solid hsl(var(--stormy-sky) / 0.18)",
          }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-ds-md flex items-center justify-center shrink-0"
              style={{ background: "hsl(var(--stormy-sky) / 0.12)" }}
            >
              <Building2
                className="w-5 h-5"
                style={{ color: "hsl(var(--stormy-sky))" }}
                strokeWidth={1.75}
              />
            </div>
            <div>
              <p
                className="font-sans font-semibold text-ds-14"
                style={{ color: "hsl(var(--ink-deep))" }}
              >
                Are you an insurance adjuster or carrier?
              </p>
              <p
                className="font-sans text-ds-12 leading-snug"
                style={{ color: "hsl(var(--olivewood))" }}
              >
                Partner with Louisiana Helpr to refer policyholders directly.
              </p>
            </div>
          </div>
          <p
            className="font-serif italic text-ds-14 leading-relaxed"
            style={{ color: "hsl(var(--olivewood))" }}
          >
            We work with Louisiana carriers and independent adjusters to give
            policyholders immediate access to verified contractors — speeding
            up estimates and reducing claim cycle time.
          </p>
          <a
            href="mailto:admin@louisianahelpr.com?subject=Insurance+Carrier+Partnership"
            className="inline-flex items-center gap-2 font-sans font-semibold text-ds-13 transition-opacity hover:opacity-75"
            style={{ color: "hsl(var(--burnt-sienna))" }}
          >
            <Mail className="w-4 h-4" strokeWidth={1.75} />
            admin@louisianahelpr.com
          </a>
        </section>

      </div>
    </PublicLayout>
  );
};

export default InsuranceClaim;
