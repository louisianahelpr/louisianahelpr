import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Car,
  Home,
  UtensilsCrossed,
  ShieldCheck,
  Lock,
  Zap,
  Building2,
  Mail,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import PageHeader from "@/components/PageHeader";
import PublicLayout from "@/components/marketing/PublicLayout";
import { usePageMeta } from "@/hooks/usePageMeta";

type NeedChip =
  | "transport"
  | "home_setup"
  | "grocery"
  | "light_cleaning"
  | "multiple";

const NEED_CHIPS: { id: NeedChip; label: string }[] = [
  { id: "transport", label: "Transport" },
  { id: "home_setup", label: "Home setup" },
  { id: "grocery", label: "Grocery / errands" },
  { id: "light_cleaning", label: "Light cleaning" },
  { id: "multiple", label: "Multiple things" },
];

const needToTitle: Record<NeedChip, string> = {
  transport: "Hospital discharge transport",
  home_setup: "Home prep after hospital discharge",
  grocery: "Grocery and errands after hospital discharge",
  light_cleaning: "Light cleaning after hospital discharge",
  multiple: "Hospital discharge assistance",
};

const todayStr = () => {
  const d = new Date();
  return d.toISOString().split("T")[0];
};

const DischargeConcierge = () => {
  const navigate = useNavigate();
  const [selectedNeed, setSelectedNeed] = useState<NeedChip>("multiple");
  const [date, setDate] = useState(todayStr());
  const [address, setAddress] = useState("");

  usePageMeta({
    title: "Healthcare Discharge Concierge — Louisiana Helpr",
    description:
      "Coming home from the hospital? Find verified local helpers for transport, home prep, meals, and errands — same-day, Louisiana-wide.",
    canonical: "https://www.louisianahelpr.com/discharge",
    ogTitle: "Coming home from the hospital? Louisiana Helpr has you covered.",
    ogDescription:
      "Same-day transport, home prep, grocery runs, and more — verified Helprs ready when you leave the hospital.",
  });

  const handleFindHelpr = () => {
    const title = encodeURIComponent(needToTitle[selectedNeed]);
    navigate(
      `/post-job?category=errands&title=${title}&urgent=true`,
    );
  };

  return (
    <PublicLayout>
      <PageHeader
        eyebrow="Healthcare"
        title="Discharge Concierge"
      />

      <div className="mx-auto max-w-5xl lg:max-w-6xl xl:max-w-7xl 2xl:max-w-[90rem] px-5 lg:px-8 pb-12 space-y-8">

        {/* ── Hero ── */}
        <div
          className="rounded-2xl p-6 lg:p-8 space-y-3 relative overflow-hidden"
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
          <span
            className="font-serif italic uppercase text-[0.62rem] tracking-widest"
            style={{ color: "hsl(var(--burnt-sienna))" }}
          >
            Coming home from the hospital?
          </span>
          <h2
            className="font-display italic font-bold leading-[1.05] text-balance"
            style={{
              fontSize: "clamp(1.75rem, 4vw + 0.5rem, 2.75rem)",
              color: "hsl(var(--ink-deep))",
              letterSpacing: "-0.025em",
            }}
          >
            Get the help you need,{" "}
            <span style={{ color: "hsl(var(--burnt-sienna))" }}>
              right when you need it.
            </span>
          </h2>
          <p
            className="font-serif italic text-ds-16 leading-relaxed max-w-lg"
            style={{ color: "hsl(var(--olivewood))" }}
          >
            Leaving the hospital is stressful enough. Louisiana Helpr connects
            you with ID-verified local helpers for transport, home prep, meals,
            and everyday errands — often within the hour.
          </p>
        </div>

        {/* ── Common needs cards ── */}
        <section className="space-y-3">
          <h3
            className="font-display italic font-semibold text-ds-18"
            style={{ color: "hsl(var(--ink-deep))" }}
          >
            Common needs after discharge
          </h3>
          <div className="grid sm:grid-cols-3 gap-3">
            {[
              {
                icon: Car,
                title: "Transport",
                body: "Ride home from the hospital, pharmacy runs, follow-up appointment trips.",
              },
              {
                icon: Home,
                title: "Home Prep",
                body: "Light cleaning, furniture rearrangement, making sure things are ready before you arrive.",
              },
              {
                icon: UtensilsCrossed,
                title: "Daily Help",
                body: "Grocery shopping, meal prep, and household errands for your first week home.",
              },
            ].map(({ icon: Icon, title, body }) => (
              <div
                key={title}
                className="liquid-glass p-4 space-y-2 rounded-xl"
              >
                <div
                  className="w-9 h-9 rounded-ds-md flex items-center justify-center"
                  style={{ background: "hsl(var(--sage) / 0.18)" }}
                >
                  <Icon
                    className="w-4 h-4"
                    style={{ color: "hsl(var(--burnt-sienna))" }}
                    strokeWidth={1.75}
                  />
                </div>
                <p
                  className="font-sans font-semibold text-ds-14"
                  style={{ color: "hsl(var(--ink-deep))" }}
                >
                  {title}
                </p>
                <p
                  className="font-sans text-ds-12 leading-snug"
                  style={{ color: "hsl(var(--olivewood))" }}
                >
                  {body}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Get help now form ── */}
        <section
          className="liquid-glass rounded-2xl p-5 lg:p-6 space-y-5"
        >
          <h3
            className="font-display italic font-semibold text-ds-18"
            style={{ color: "hsl(var(--ink-deep))" }}
          >
            Get help now
          </h3>

          {/* Need chips */}
          <div className="space-y-2">
            <label
              className="font-sans text-ds-13 font-medium"
              style={{ color: "hsl(var(--ink-deep))" }}
            >
              What do you need?
            </label>
            <div className="flex flex-wrap gap-2">
              {NEED_CHIPS.map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setSelectedNeed(id)}
                  className="px-3 py-1.5 rounded-full text-ds-12 font-sans font-medium transition-all"
                  style={
                    selectedNeed === id
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

          {/* Date */}
          <div className="space-y-1.5">
            <label
              htmlFor="discharge-date"
              className="font-sans text-ds-13 font-medium"
              style={{ color: "hsl(var(--ink-deep))" }}
            >
              When are you going home?
            </label>
            <input
              id="discharge-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              min={todayStr()}
              className="w-full rounded-ds-md px-3 py-2.5 text-ds-14 font-sans outline-none focus:ring-2"
              style={{
                background: "hsl(var(--parchment) / 0.5)",
                border: "1px solid hsl(var(--olivewood) / 0.25)",
                color: "hsl(var(--ink-deep))",
              }}
            />
          </div>

          {/* Address */}
          <div className="space-y-1.5">
            <label
              htmlFor="discharge-address"
              className="font-sans text-ds-13 font-medium"
              style={{ color: "hsl(var(--ink-deep))" }}
            >
              Your address
            </label>
            <input
              id="discharge-address"
              type="text"
              placeholder="123 Main St, Baton Rouge, LA"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
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
            Find a Helpr
          </Button>
        </section>

        {/* ── Trust signals ── */}
        <section className="grid sm:grid-cols-3 gap-3">
          {[
            {
              icon: Lock,
              label: "Helpr Escrow",
              body: "Payment held until your job is done.",
            },
            {
              icon: ShieldCheck,
              label: "ID-verified helpers",
              body: "Every Helpr clears Stripe identity verification.",
            },
            {
              icon: Zap,
              label: "Fast response",
              body: "Most urgent requests matched within the hour.",
            },
          ].map(({ icon: Icon, label, body }) => (
            <div
              key={label}
              className="flex items-start gap-3 p-3 rounded-xl"
              style={{
                background: "hsl(var(--sage) / 0.08)",
                border: "1px solid hsl(var(--sage) / 0.18)",
              }}
            >
              <Icon
                className="w-4 h-4 mt-0.5 shrink-0"
                style={{ color: "hsl(var(--sage))" }}
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

        {/* ── For hospitals & care teams ── */}
        <section
          className="rounded-2xl p-5 lg:p-6 space-y-3"
          style={{
            background:
              "linear-gradient(135deg, hsl(var(--bark) / 0.06) 0%, hsl(var(--burnt-sienna) / 0.06) 100%)",
            border: "1px solid hsl(var(--bark) / 0.14)",
          }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-ds-md flex items-center justify-center shrink-0"
              style={{ background: "hsl(var(--bark) / 0.12)" }}
            >
              <Building2
                className="w-5 h-5"
                style={{ color: "hsl(var(--bark))" }}
                strokeWidth={1.75}
              />
            </div>
            <div>
              <p
                className="font-sans font-semibold text-ds-14"
                style={{ color: "hsl(var(--ink-deep))" }}
              >
                For hospitals &amp; care teams
              </p>
              <p
                className="font-sans text-ds-12 leading-snug"
                style={{ color: "hsl(var(--olivewood))" }}
              >
                Set up discharge-day referral programs for your patients.
              </p>
            </div>
          </div>
          <p
            className="font-serif italic text-ds-14 leading-relaxed"
            style={{ color: "hsl(var(--olivewood))" }}
          >
            We partner with Louisiana hospitals and social work teams to ensure
            patients have a verified Helpr waiting when they get home —
            reducing readmission risk and improving discharge outcomes.
          </p>
          <a
            href="mailto:admin@louisianahelpr.com?subject=Hospital+Discharge+Partnership"
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

export default DischargeConcierge;
