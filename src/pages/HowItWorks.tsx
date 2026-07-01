import { useNavigate } from "react-router-dom";
import {
  ClipboardList,
  Users,
  Lock,
  Star,
  UserCircle2,
  MapPin,
  CheckCircle2,
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
    icon: ClipboardList,
    title: "Describe what you need",
    body: "Pick a category, write a quick description, and set your budget — or let Helpr suggest one based on local market data.",
  },
  {
    icon: Users,
    title: "Get applications fast",
    body: "Most jobs see applications within the first hour. Review helper profiles, ratings, and verifications before you choose.",
  },
  {
    icon: Lock,
    title: "Choose and pay securely",
    body: "Pick your Helpr. Payment is held securely until you confirm the work is done — never released early.",
  },
  {
    icon: Star,
    title: "Rate the experience",
    body: "Your feedback builds the community and helps the best helprs rise to the top for everyone.",
  },
];

const HELPER_STEPS = [
  {
    icon: UserCircle2,
    title: "Create your profile",
    body: "Add your skills, service area, and a brief intro. Takes two minutes. A strong profile gets noticed first.",
  },
  {
    icon: MapPin,
    title: "Apply to jobs nearby",
    body: "Browse open jobs in your parish. A quick ID check on your first application keeps the platform safe for everyone.",
  },
  {
    icon: CheckCircle2,
    title: "Do great work",
    body: "Communicate through the app; payment releases when the poster confirms you're done.",
  },
  {
    icon: Banknote,
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
    label: "ID-verified helpers",
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
  icon: React.ElementType;
  title: string;
  body: string;
  /** Accent token (without the hsl(var()) wrapper) — varies per step so the
   *  numbered rail reads rich rather than monochrome. */
  accent: string;
}

const StepCard = ({ step, icon: Icon, title, body, accent }: StepCardProps) => (
  <div className="flex gap-4 items-start">
    {/* Step number + icon column */}
    <div className="flex flex-col items-center gap-2 shrink-0">
      <div
        className="w-10 h-10 rounded-full flex items-center justify-center font-sans font-bold text-ds-13"
        style={{
          background: `hsl(var(--${accent}))`,
          color: "hsl(var(--parchment))",
          boxShadow: `0 2px 8px hsl(var(--${accent}) / 0.30)`,
        }}
      >
        {step}
      </div>
      {/* Connector line — hidden on last item */}
      <div
        className="step-connector w-px flex-1 min-h-[2.5rem]"
        style={{ background: "hsl(var(--olivewood) / 0.15)" }}
        aria-hidden
      />
    </div>

    {/* Content */}
    <div className="pb-7">
      <div className="flex items-center gap-2 mb-1">
        <Icon
          className="w-4 h-4 shrink-0"
          style={{ color: `hsl(var(--${accent}))` }}
          strokeWidth={1.75}
        />
        <h3
          className="font-display italic font-bold text-ds-17 tracking-[-0.02em] leading-tight"
          style={{ color: "hsl(var(--ink-deep))" }}
        >
          {title}
        </h3>
      </div>
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
      "Learn how Louisiana Helpr connects neighbors in two minutes — whether you need a job done or want to earn. Secure escrow, ID-verified helpers, Louisiana team.",
    canonical: "https://www.louisianahelpr.com/how-it-works",
    ogTitle: "How Louisiana Helpr works — post a job or start earning today.",
    ogDescription:
      "Post a job in under two minutes or build income as a verified helper. Helpr Escrow keeps every transaction safe.",
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
          className="rounded-2xl p-6 lg:p-8 space-y-4 relative overflow-hidden max-w-3xl mx-auto w-full"
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
            Get started in about{" "}
            <span style={{ color: "hsl(var(--burnt-sienna))" }}>
              two minutes
            </span>
            .
          </h2>
          <p className="subhead-serif text-foreground text-ds-17 lg:text-ds-20 leading-relaxed max-w-xl">
            Every account can both post jobs and earn as a helper — no
            separate modes, no switching. Jump to whichever side fits your day.
          </p>
        </div>

        {/* ── Post a job section ── */}
        <section
          id="post-a-job"
          className="liquid-glass rounded-2xl p-5 lg:p-7 space-y-5 scroll-mt-20 max-w-3xl mx-auto w-full"
        >
          {/* Section header */}
          <div className="flex items-center gap-3">
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center shrink-0"
              style={{
                background: "hsl(var(--bark))",
                color: "hsl(var(--parchment))",
                boxShadow: "0 8px 20px -8px hsl(var(--bark) / 0.5)",
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
                  icon={s.icon}
                  title={s.title}
                  body={s.body}
                  accent={STEP_ACCENTS[i % STEP_ACCENTS.length]}
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
            Post a task now
            <ArrowRight className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-1" strokeWidth={2} />
          </Button>
        </section>

        {/* ── Divider ornament ── */}
        <div className="flex justify-center gap-1.5 py-2" aria-hidden>
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="rounded-full"
              style={{
                width: i === 1 ? "7px" : "4px",
                height: i === 1 ? "7px" : "4px",
                background: `hsl(var(--olivewood) / ${i === 1 ? 0.35 : 0.2})`,
              }}
            />
          ))}
        </div>

        {/* ── Earn as a helper section ── */}
        <section
          id="earn-as-a-helper"
          className="liquid-glass rounded-2xl p-5 lg:p-7 space-y-5 scroll-mt-20 max-w-3xl mx-auto w-full"
        >
          {/* Section header */}
          <div className="flex items-center gap-3">
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center shrink-0"
              style={{
                background: "hsl(var(--bark))",
                color: "hsl(var(--parchment))",
                boxShadow: "0 8px 20px -8px hsl(var(--bark) / 0.5)",
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
                For helpers
              </span>
              <h2
                className="font-display italic font-bold text-ds-22 tracking-[-0.02em] leading-tight"
                style={{ color: "hsl(var(--ink-deep))" }}
              >
                Earn as a helper
              </h2>
            </div>
          </div>

          {/* Steps — accent rotation offset from the poster rail so the two
              columns don't mirror each other's colors. */}
          <div>
            {HELPER_STEPS.map((s, i) => (
              <div key={s.title} className={i === HELPER_STEPS.length - 1 ? "[&_.step-connector]:hidden" : ""}>
                <StepCard
                  step={i + 1}
                  icon={s.icon}
                  title={s.title}
                  body={s.body}
                  accent={STEP_ACCENTS[(i + 2) % STEP_ACCENTS.length]}
                />
              </div>
            ))}
          </div>

          <Button
            variant="bark"
            size="lg"
            className="w-full rounded-ds-md font-sans font-semibold gap-2"
            onClick={() => navigate("/dashboard")}
          >
            Find work nearby
            <ArrowRight className="w-4 h-4" strokeWidth={2} />
          </Button>
        </section>

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

        {/* ── Closing CTA ── */}
        <section className="text-center space-y-5 py-6">
          {/* Ornament */}
          <div className="flex justify-center gap-1.5 mb-4" aria-hidden>
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="rounded-full"
                style={{
                  width: i === 1 ? "8px" : "5px",
                  height: i === 1 ? "8px" : "5px",
                  background: `hsl(var(--burnt-sienna) / ${i === 1 ? 0.7 : 0.4})`,
                }}
              />
            ))}
          </div>

          <h2
            className="font-display italic font-bold text-ds-26 tracking-[-0.025em] text-balance"
            style={{ color: "hsl(var(--ink-deep))" }}
          >
            Ready to{" "}
            <span style={{ color: "hsl(var(--burnt-sienna))" }}>start</span>?
          </h2>
          <p
            className="font-serif italic text-ds-15 leading-relaxed"
            style={{ color: "hsl(var(--olivewood) / 0.8)" }}
          >
            Join your Louisiana neighbors on the platform.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
            <Button
              onClick={() => navigate("/post-job")}
              size="lg"
              variant="bark"
              className="rounded-ds-md px-8 font-sans font-semibold gap-2 w-full sm:w-auto"
            >
              Post a task
              <ArrowRight className="w-4 h-4" strokeWidth={2} />
            </Button>
            <Button
              onClick={() => navigate("/dashboard")}
              size="lg"
              variant="outline"
              className="rounded-ds-md px-8 font-sans font-semibold w-full sm:w-auto"
              style={{
                borderColor: "hsl(var(--olivewood) / 0.3)",
                color: "hsl(var(--ink-deep))",
              }}
            >
              Find work
            </Button>
          </div>
        </section>

      </div>
    </PublicLayout>
  );
};

export default HowItWorks;
