import { useNavigate } from "react-router-dom";
import {
  ClipboardList,
  Lock,
  Banknote,
  ShieldCheck,
  HeartHandshake,
  ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import PageHeader from "@/components/PageHeader";
import PublicLayout from "@/components/marketing/PublicLayout";
import { usePageMeta } from "@/hooks/usePageMeta";

// ─── Step data ─────────────────────────────────────────────────────────────────

const POSTER_STEPS = [
  {
    title: "Describe what you need",
    body: "Pick a category, write a quick description, and set your budget — or let Helpr suggest one based on local market data.",
  },
  {
    title: "Get applications fast",
    body: "Most jobs see applications within the first hour. Review Helpr profiles, ratings, and verifications before you choose.",
  },
  {
    title: "Choose and pay securely",
    body: "Pick your Helpr. Payment is held securely until you confirm the work is done — never released early.",
  },
  {
    title: "Rate the experience",
    body: "Your feedback builds the community and helps the best Helprs rise to the top for everyone.",
  },
];

const HELPER_STEPS = [
  {
    title: "Create your profile",
    body: "Add your skills, service area, and a brief intro. Takes two minutes. A strong profile gets noticed first.",
  },
  {
    title: "Apply to jobs nearby",
    body: "Browse open jobs in your parish. A quick ID check on your first application keeps the platform safe for everyone.",
  },
  {
    title: "Do great work",
    body: "Communicate through the app; payment releases when the poster confirms you're done.",
  },
  {
    title: "Get paid and grow",
    body: "Funds hit your account same day. Build your rating for higher-earning opportunities over time.",
  },
];

const TRUST_ITEMS = [
  {
    icon: Lock,
    label: "Protected payment",
    body: "Payment always protected. Funds release only after the poster confirms the work is done.",
    accent: "bark",
  },
  {
    icon: ShieldCheck,
    label: "ID-verified Helprs",
    body: "Every Helpr clears government-ID verification before their first job. Licensed trades are license-verified too.",
    accent: "burnt-sienna",
  },
  {
    icon: HeartHandshake,
    label: "Louisiana team",
    body: "Real people reviewing disputes and answering questions — not bots. We're based in Louisiana.",
    accent: "olivewood",
  },
];

// ─── Sub-components ─────────────────────────────────────────────────────────────

interface StepCardProps {
  step: number;
  title: string;
  body: string;
  /** Accent token (without the hsl(var()) wrapper) for the number badge. */
  accent: string;
}

const StepCard = ({ step, title, body, accent }: StepCardProps) => (
  <div className="flex gap-4 items-start">
    {/* Step-number column — a single soft-tinted badge is the only focal
        point per row, so the stepped rail reads calm rather than cluttered. */}
    <div className="flex flex-col items-center gap-2 shrink-0">
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center font-sans font-bold text-ds-13"
        style={{
          background: `hsl(var(--${accent}) / 0.12)`,
          color: `hsl(var(--${accent}))`,
        }}
      >
        {step}
      </div>
      {/* Connector line — hidden on last item */}
      <div
        className="step-connector w-px flex-1 min-h-[2rem]"
        style={{ background: "hsl(var(--olivewood) / 0.15)" }}
        aria-hidden
      />
    </div>

    {/* Content */}
    <div className="pb-6">
      <h3
        className="font-display font-bold text-ds-17 tracking-[-0.02em] leading-tight mb-1"
        style={{ color: "hsl(var(--ink-deep))" }}
      >
        {title}
      </h3>
      <p
        className="font-sans text-ds-13 leading-relaxed"
        style={{ color: "hsl(var(--olivewood))" }}
      >
        {body}
      </p>
    </div>
  </div>
);

// Per-step accent rotation — a deliberate mix of tokens so each rail reads
// varied rather than one flat color.
const STEP_ACCENTS = [
  "bark",
  "burnt-sienna",
  "olivewood",
  "gold-warm",
] as const;

// ─── HowItWorks ────────────────────────────────────────────────────────────────

const HowItWorks = () => {
  const navigate = useNavigate();

  usePageMeta({
    title: "How It Works — Louisiana Helpr",
    description:
      "Learn how Louisiana Helpr connects neighbors in two minutes — whether you need a job done or want to earn. Secure escrow, ID-verified Helprs, Louisiana team.",
    canonical: "https://www.louisianahelpr.com/how-it-works",
    ogTitle: "How Louisiana Helpr works — post a job or start earning today.",
    ogDescription:
      "Post a job in under two minutes or build income as a verified Helpr. Helpr Escrow keeps every transaction safe.",
  });

  return (
    <PublicLayout showCtaBand={false}>
      <PageHeader
        eyebrow="Simple from start to finish"
        title="How Louisiana Helpr works"
      />

      <div className="mx-auto max-w-5xl lg:max-w-6xl xl:max-w-7xl 2xl:max-w-[90rem] px-5 lg:px-8 xl:px-12 pb-16 space-y-10">

        {/* ── Hero subtext ── */}
        <div
          className="rounded-2xl p-6 lg:p-8 relative overflow-hidden w-full"
          style={{
            background:
              "linear-gradient(135deg, hsl(var(--parchment) / 0.55) 0%, hsl(var(--sage) / 0.18) 100%)",
            border: "1px solid hsl(var(--olivewood) / 0.18)",
          }}
        >
          <div
            aria-hidden
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                "radial-gradient(ellipse 80% 60% at 90% 10%, hsl(var(--burnt-sienna) / 0.07) 0%, transparent 70%)",
            }}
          />
          <div className="relative grid lg:grid-cols-[1.5fr_1fr] gap-6 lg:gap-10 items-center">
            <div className="space-y-3">
              <span className="text-display-eyebrow">
                Whether you post or earn
              </span>
              <h2
                className="font-display italic font-bold leading-[1.05] text-balance"
                style={{
                  fontSize: "clamp(1.9rem, 4.5vw + 0.5rem, 3rem)",
                  color: "hsl(var(--ink-deep))",
                  letterSpacing: "-0.03em",
                }}
              >
                Up and running in{" "}
                <span style={{ color: "hsl(var(--burnt-sienna))" }}>
                  two minutes
                </span>
                .
              </h2>
              <p className="subhead-serif text-foreground text-ds-17 lg:text-ds-20 leading-relaxed">
                One account, both sides. Post a job or earn as a Helpr — no
                separate modes, nothing to switch.
              </p>
            </div>

            {/* Right rail — fills the horizontal space the copy used to leave
                empty, and front-loads the three trust facts. */}
            <ul
              className="flex flex-col gap-3.5 lg:border-l lg:pl-8"
              style={{ borderColor: "hsl(var(--olivewood) / 0.18)" }}
            >
              {[
                { icon: ShieldCheck, label: "ID-verified Helprs" },
                { icon: Lock, label: "Escrow-protected pay" },
                { icon: Banknote, label: "Free to post a job" },
              ].map(({ icon: Icon, label }) => (
                <li key={label} className="flex items-center gap-3">
                  <div
                    className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                    style={{
                      background: "hsl(var(--bark) / 0.08)",
                      color: "hsl(var(--bark))",
                    }}
                  >
                    <Icon className="w-[18px] h-[18px]" strokeWidth={1.75} />
                  </div>
                  <span
                    className="font-sans font-semibold text-ds-15"
                    style={{ color: "hsl(var(--ink-deep))" }}
                  >
                    {label}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* ── Post a job / Earn as a helper — side-by-side rails ── */}
        <div className="grid lg:grid-cols-2 gap-5 items-start">
        {/* ── Post a job section ── */}
        <section
          id="post-a-job"
          className="liquid-glass rounded-2xl p-5 lg:p-7 space-y-5 scroll-mt-20 w-full h-full"
        >
          {/* Section header */}
          <div className="flex items-center gap-3">
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center shrink-0"
              style={{
                background: "hsl(var(--bark) / 0.06)",
                color: "hsl(var(--bark))",
                border: "1.5px solid hsl(var(--bark) / 0.5)",
              }}
            >
              <ClipboardList className="w-7 h-7" strokeWidth={1.75} />
            </div>
            <div>
              <span
                className="font-serif italic uppercase text-[0.6rem] tracking-widest inline-flex items-center"
                style={{ color: "hsl(var(--burnt-sienna) / 0.75)" }}
              >
                <span
                  className="inline-block w-1 h-4 rounded-full mr-2 align-middle"
                  style={{ background: "hsl(var(--burnt-sienna))" }}
                />
                For posters
              </span>
              <h2
                className="font-display italic font-bold text-ds-22 tracking-[-0.02em] leading-tight"
                style={{ color: "hsl(var(--ink-deep))" }}
              >
                Post a job
              </h2>
            </div>
          </div>

          {/* Steps */}
          <div>
            {POSTER_STEPS.map((s, i) => (
              <div key={s.title} className={i === POSTER_STEPS.length - 1 ? "[&_.step-connector]:hidden" : ""}>
                <StepCard
                  step={i + 1}
                  title={s.title}
                  body={s.body}
                  accent="burnt-sienna"
                />
              </div>
            ))}
          </div>

          <Button
            variant="bark"
            size="lg"
            className="group w-full rounded-ds-md font-sans font-semibold gap-2"
            onClick={() => navigate("/post-job")}
          >
            Post a job now
            <ArrowRight className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-1" strokeWidth={2} />
          </Button>
        </section>

        {/* ── Earn as a helper section ── */}
        <section
          id="earn-as-a-helper"
          className="liquid-glass rounded-2xl p-5 lg:p-7 space-y-5 scroll-mt-20 w-full h-full"
        >
          {/* Section header */}
          <div className="flex items-center gap-3">
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center shrink-0"
              style={{
                background: "hsl(var(--bark) / 0.06)",
                color: "hsl(var(--bark))",
                border: "1.5px solid hsl(var(--bark) / 0.5)",
              }}
            >
              <Banknote className="w-7 h-7" strokeWidth={1.75} />
            </div>
            <div>
              <span
                className="font-serif italic uppercase text-[0.6rem] tracking-widest inline-flex items-center"
                style={{ color: "hsl(var(--sage) / 0.85)" }}
              >
                <span
                  className="inline-block w-1 h-4 rounded-full mr-2 align-middle"
                  style={{ background: "hsl(var(--sage))" }}
                />
                For Helprs
              </span>
              <h2
                className="font-display italic font-bold text-ds-22 tracking-[-0.02em] leading-tight"
                style={{ color: "hsl(var(--ink-deep))" }}
              >
                Earn as a Helpr
              </h2>
            </div>
          </div>

          {/* Last step hides its connector line (no card follows it). */}
          <div>
            {HELPER_STEPS.map((s, i) => (
              <div key={s.title} className={i === HELPER_STEPS.length - 1 ? "[&_.step-connector]:hidden" : ""}>
                <StepCard
                  step={i + 1}
                  title={s.title}
                  body={s.body}
                  accent="burnt-sienna"
                />
              </div>
            ))}
          </div>

          <Button
            variant="bark"
            size="lg"
            className="w-full rounded-ds-md font-sans font-semibold gap-2"
            onClick={() => navigate("/jobs")}
          >
            Find work nearby
            <ArrowRight className="w-4 h-4" strokeWidth={2} />
          </Button>
        </section>
        </div>

        {/* ── Trust callout strip ── */}
        <section
          aria-label="Trust and safety"
          className="grid sm:grid-cols-3 gap-3"
        >
          {TRUST_ITEMS.map(({ icon: Icon, label, body, accent }) => (
            <div
              key={label}
              className="rounded-2xl p-4 space-y-2"
              style={{
                background:
                  "linear-gradient(135deg, hsl(var(--parchment) / 0.65) 0%, hsl(var(--sage) / 0.08) 100%)",
                border: "1px solid hsl(var(--olivewood) / 0.14)",
              }}
            >
              <div
                className="w-8 h-8 rounded-ds-sm flex items-center justify-center"
                style={{ background: `hsl(var(--${accent}) / 0.10)` }}
              >
                <Icon
                  className="w-4 h-4"
                  style={{ color: `hsl(var(--${accent}))` }}
                  strokeWidth={1.75}
                />
              </div>
              <p
                className="font-sans font-semibold text-ds-13"
                style={{ color: "hsl(var(--ink-deep))" }}
              >
                {label}
              </p>
              <p
                className="font-sans text-ds-12 leading-snug"
                style={{ color: "hsl(var(--olivewood))" }}
              >
                {body}
              </p>
            </div>
          ))}
        </section>

      </div>
    </PublicLayout>
  );
};

export default HowItWorks;
