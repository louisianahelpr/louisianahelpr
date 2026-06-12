/**
 * /become-a-partner — public intake page for established service businesses
 * that want to join the Helpr partner network.
 *
 * No auth required. Submits to `partner_applications` table via a direct
 * anon insert (RLS allows public INSERT; only service_role can read/update).
 *
 * PGRST202 graceful fallback: if the migration hasn't been pushed yet, the
 * form shows an error toast instead of crashing.
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { usePageTitle } from "@/hooks/usePageTitle";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { hapticError } from "@/lib/haptics";
import { report } from "@/lib/errorLogger";
import {
  Briefcase,
  CheckCircle2,
  Star,
  Users,
  Zap,
  ShieldCheck,
} from "lucide-react";

const SERVICE_CATEGORIES = [
  "Cleaning",
  "Lawn & Yard",
  "Handyman",
  "Painting",
  "Moving",
  "Pest Control",
  "HVAC / Electrical / Plumbing",
  "Other",
];

const TEAM_SIZES = [
  "Just me",
  "2–5 people",
  "6–15 people",
  "15+ people",
];

const YEARS_OPTIONS = [
  "Less than 1 year",
  "1–3 years",
  "3–10 years",
  "10+ years",
];

interface FormState {
  business_name: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  service_category: string;
  service_area: string;
  team_size: string;
  years_in_business: string;
  has_insurance: boolean;
  has_license: boolean;
  referral_source: string;
}

const EMPTY_FORM: FormState = {
  business_name: "",
  contact_name: "",
  contact_email: "",
  contact_phone: "",
  service_category: "",
  service_area: "",
  team_size: "",
  years_in_business: "",
  has_insurance: false,
  has_license: false,
  referral_source: "",
};

const BENEFIT_CARDS = [
  {
    icon: Zap,
    title: "Jobs sent to you",
    body: "No bidding required. We match jobs to your category and area and send them directly to your account.",
    color: "var(--gold-warm)",
  },
  {
    icon: ShieldCheck,
    title: "Your brand, our trust",
    body: "Your business name appears alongside Helpr's Partner badge, escrow protection, and verified credential check.",
    color: "var(--bark)",
  },
  {
    icon: Users,
    title: "Team management",
    body: "Add crew members to your account. All activity rolls up under one business profile with unified payouts.",
    color: "var(--sage)",
  },
];

const inputClass =
  "w-full rounded-ds-md px-3 py-2.5 text-ds-14 text-foreground border focus:outline-none focus:ring-2 transition-all";
const inputStyle = {
  background: "hsl(var(--parchment))",
  borderColor: "hsl(var(--olivewood) / 0.20)",
};
const inputFocusRing = { "--tw-ring-color": "hsl(var(--bark) / 0.35)" } as React.CSSProperties;

const BecomeAPartner = () => {
  usePageTitle("Become a Helpr Partner — Grow Your Service Business");
  const navigate = useNavigate();

  const { data: platformStats } = useQuery({
    queryKey: ["platform_impact_stats"],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_platform_impact_stats");
      if (error) return null;
      return Array.isArray(data) ? data[0] : data;
    },
    staleTime: 10 * 60 * 1000,
  });

  const helperCount = platformStats?.total_helpers_active ?? null;
  const helperStat = helperCount !== null
    ? `${Math.max(helperCount, 1).toLocaleString()}+`
    : "500+";

  const responseMinutes = platformStats?.avg_response_minutes ?? null;
  const responseStat = responseMinutes !== null
    ? `${Math.round(Number(responseMinutes))} min`
    : "30 min";

  const socialProof = [
    { stat: helperStat, label: "active helpers in Louisiana" },
    { stat: "4.9★", label: "average rating" },
    { stat: responseStat, label: "median response time" },
  ];

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const set = (field: keyof FormState, value: string | boolean) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Basic validation
    if (!form.business_name.trim()) {
      toast.error("Business name is required");
      hapticError();
      return;
    }
    if (!form.contact_name.trim()) {
      toast.error("Contact name is required");
      hapticError();
      return;
    }
    if (!form.contact_email.trim()) {
      toast.error("Contact email is required");
      hapticError();
      return;
    }
    if (!form.service_category) {
      toast.error("Please select a service category");
      hapticError();
      return;
    }
    if (!form.service_area.trim()) {
      toast.error("Service area is required");
      hapticError();
      return;
    }
    if (!form.team_size) {
      toast.error("Please select your team size");
      hapticError();
      return;
    }
    if (!form.years_in_business) {
      toast.error("Please select years in business");
      hapticError();
      return;
    }

    setSubmitting(true);
    try {
      // Use `as any` cast — table is new and not yet in generated types
      const { error } = await (supabase as any)
        .from("partner_applications")
        .insert({
          business_name: form.business_name.trim(),
          contact_name: form.contact_name.trim(),
          contact_email: form.contact_email.trim(),
          contact_phone: form.contact_phone.trim() || null,
          service_category: form.service_category,
          service_area: form.service_area.trim(),
          team_size: form.team_size,
          years_in_business: form.years_in_business,
          has_insurance: form.has_insurance,
          has_license: form.has_license,
          referral_source: form.referral_source.trim() || null,
        });

      if (error) {
        if (error.code === "PGRST202") {
          // Migration not deployed yet — treat gracefully
          toast.info("Partner applications are coming online shortly. Please email us at partners@louisianahelpr.com.");
          return;
        }
        throw error;
      }

      setSubmitted(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      report(err, { tags: { area: "partner_applications.insert" } });
      toast.error("Couldn't submit your application — please try again.");
      hapticError();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-premium-page pb-safe-nav">
      <PageHeader
        title="Become a Helpr Partner"
        eyebrow="For service businesses"
        onBack={() => navigate(-1)}
      />

      <div className="mx-auto max-w-2xl px-4 pt-2 pb-16 space-y-10">

        {/* ── Hero ─────────────────────────────────────────────────────────── */}
        <section
          className="rounded-ds-xl px-5 py-7 text-center"
          style={{
            background:
              "linear-gradient(135deg, hsl(var(--bark) / 0.09), hsl(var(--gold-warm) / 0.07))",
            border: "1px solid hsl(var(--bark) / 0.14)",
          }}
        >
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3"
            style={{ background: "hsl(var(--bark) / 0.12)" }}
          >
            <Briefcase className="w-6 h-6" style={{ color: "hsl(var(--bark))" }} />
          </div>
          <h2
            className="font-display font-bold italic text-ds-24 leading-tight mb-2"
            style={{ color: "hsl(var(--ink-deep))" }}
          >
            Grow your business with Helpr
          </h2>
          <p className="text-ds-15 text-muted-foreground leading-relaxed max-w-md mx-auto">
            Join Louisiana's fastest-growing service marketplace. Bring your team, keep your brand.
          </p>

          {/* Two-column CTA hint */}
          <div className="grid grid-cols-2 gap-3 mt-5">
            <div
              className="rounded-ds-lg px-3 py-3 text-center"
              style={{
                background: "hsl(var(--bark) / 0.07)",
                border: "1px solid hsl(var(--bark) / 0.15)",
              }}
            >
              <p className="text-ds-12 font-semibold" style={{ color: "hsl(var(--bark))" }}>
                Just me
              </p>
              <p className="text-ds-11 text-muted-foreground mt-0.5">
                Sole proprietor applying as an individual business
              </p>
            </div>
            <div
              className="rounded-ds-lg px-3 py-3 text-center"
              style={{
                background: "hsl(var(--olivewood) / 0.07)",
                border: "1px solid hsl(var(--olivewood) / 0.15)",
              }}
            >
              <p className="text-ds-12 font-semibold" style={{ color: "hsl(var(--olivewood))" }}>
                I have a team
              </p>
              <p className="text-ds-11 text-muted-foreground mt-0.5">
                Business with crew members under one account
              </p>
            </div>
          </div>
        </section>

        {/* ── Benefit cards ───────────────────────────────────────────────── */}
        <section>
          <h3
            className="font-serif italic uppercase text-ds-9 mb-4"
            style={{ color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}
          >
            Why Helpr Partners
          </h3>
          <div className="space-y-3">
            {BENEFIT_CARDS.map(({ icon: Icon, title, body, color }) => (
              <div
                key={title}
                className="rounded-ds-lg px-4 py-4 flex items-start gap-3"
                style={{
                  background: `hsl(${color} / 0.06)`,
                  border: `1px solid hsl(${color} / 0.14)`,
                }}
              >
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 mt-0.5"
                  style={{ background: `hsl(${color} / 0.12)` }}
                >
                  <Icon className="w-4.5 h-4.5" style={{ color: `hsl(${color})` }} />
                </div>
                <div>
                  <p
                    className="text-ds-14 font-bold leading-tight"
                    style={{ color: "hsl(var(--ink-deep))" }}
                  >
                    {title}
                  </p>
                  <p className="text-ds-13 text-muted-foreground mt-1 leading-snug">
                    {body}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Application form / Success state ────────────────────────────── */}
        {submitted ? (
          <section
            className="rounded-ds-xl px-5 py-8 text-center"
            style={{
              background: "hsl(var(--sage) / 0.08)",
              border: "1px solid hsl(var(--sage) / 0.22)",
            }}
          >
            <CheckCircle2
              className="w-12 h-12 mx-auto mb-3"
              style={{ color: "hsl(var(--sage))" }}
            />
            <h2
              className="font-display font-bold italic text-ds-20 leading-tight mb-2"
              style={{ color: "hsl(var(--ink-deep))" }}
            >
              Application received!
            </h2>
            <p className="text-ds-14 text-muted-foreground leading-relaxed max-w-sm mx-auto">
              We'll review your application and be in touch within{" "}
              <strong className="text-foreground">2 business days</strong>. Keep an eye on{" "}
              <strong className="text-foreground">{form.contact_email}</strong>.
            </p>
            <Button
              variant="outline"
              className="mt-6"
              onClick={() => navigate("/")}
              style={{ borderColor: "hsl(var(--bark) / 0.30)", color: "hsl(var(--bark))" }}
            >
              Back to home
            </Button>
          </section>
        ) : (
          <section>
            <h3
              className="font-serif italic uppercase text-ds-9 mb-4"
              style={{ color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}
            >
              Partner application
            </h3>

            <form onSubmit={handleSubmit} className="space-y-5" noValidate>
              {/* Business name */}
              <div>
                <label
                  className="block text-ds-13 font-semibold text-foreground mb-1.5"
                  htmlFor="business_name"
                >
                  Business name <span style={{ color: "hsl(var(--burnt-sienna))" }}>*</span>
                </label>
                <input
                  id="business_name"
                  type="text"
                  placeholder="e.g. Bayou Clean Co."
                  className={inputClass}
                  style={{ ...inputStyle, ...inputFocusRing }}
                  value={form.business_name}
                  onChange={(e) => set("business_name", e.target.value)}
                  autoComplete="organization"
                />
              </div>

              {/* Contact name */}
              <div>
                <label
                  className="block text-ds-13 font-semibold text-foreground mb-1.5"
                  htmlFor="contact_name"
                >
                  Your name <span style={{ color: "hsl(var(--burnt-sienna))" }}>*</span>
                </label>
                <input
                  id="contact_name"
                  type="text"
                  placeholder="First and last name"
                  className={inputClass}
                  style={{ ...inputStyle, ...inputFocusRing }}
                  value={form.contact_name}
                  onChange={(e) => set("contact_name", e.target.value)}
                  autoComplete="name"
                />
              </div>

              {/* Contact email + phone */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label
                    className="block text-ds-13 font-semibold text-foreground mb-1.5"
                    htmlFor="contact_email"
                  >
                    Email <span style={{ color: "hsl(var(--burnt-sienna))" }}>*</span>
                  </label>
                  <input
                    id="contact_email"
                    type="email"
                    placeholder="you@business.com"
                    className={inputClass}
                    style={{ ...inputStyle, ...inputFocusRing }}
                    value={form.contact_email}
                    onChange={(e) => set("contact_email", e.target.value)}
                    autoComplete="email"
                  />
                </div>
                <div>
                  <label
                    className="block text-ds-13 font-semibold text-foreground mb-1.5"
                    htmlFor="contact_phone"
                  >
                    Phone{" "}
                    <span className="text-muted-foreground font-normal">(optional)</span>
                  </label>
                  <input
                    id="contact_phone"
                    type="tel"
                    placeholder="(504) 000-0000"
                    className={inputClass}
                    style={{ ...inputStyle, ...inputFocusRing }}
                    value={form.contact_phone}
                    onChange={(e) => set("contact_phone", e.target.value)}
                    autoComplete="tel"
                  />
                </div>
              </div>

              {/* Service category */}
              <div>
                <label
                  className="block text-ds-13 font-semibold text-foreground mb-1.5"
                  htmlFor="service_category"
                >
                  Service category <span style={{ color: "hsl(var(--burnt-sienna))" }}>*</span>
                </label>
                <select
                  id="service_category"
                  className={inputClass}
                  style={{ ...inputStyle, ...inputFocusRing }}
                  value={form.service_category}
                  onChange={(e) => set("service_category", e.target.value)}
                >
                  <option value="">Select a category…</option>
                  {SERVICE_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>

              {/* Service area */}
              <div>
                <label
                  className="block text-ds-13 font-semibold text-foreground mb-1.5"
                  htmlFor="service_area"
                >
                  Service area{" "}
                  <span style={{ color: "hsl(var(--burnt-sienna))" }}>*</span>
                </label>
                <input
                  id="service_area"
                  type="text"
                  placeholder="e.g. Orleans, Jefferson, St. Tammany parishes"
                  className={inputClass}
                  style={{ ...inputStyle, ...inputFocusRing }}
                  value={form.service_area}
                  onChange={(e) => set("service_area", e.target.value)}
                />
              </div>

              {/* Team size + years side by side */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label
                    className="block text-ds-13 font-semibold text-foreground mb-1.5"
                    htmlFor="team_size"
                  >
                    Team size <span style={{ color: "hsl(var(--burnt-sienna))" }}>*</span>
                  </label>
                  <select
                    id="team_size"
                    className={inputClass}
                    style={{ ...inputStyle, ...inputFocusRing }}
                    value={form.team_size}
                    onChange={(e) => set("team_size", e.target.value)}
                  >
                    <option value="">Select…</option>
                    {TEAM_SIZES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label
                    className="block text-ds-13 font-semibold text-foreground mb-1.5"
                    htmlFor="years_in_business"
                  >
                    Years in business{" "}
                    <span style={{ color: "hsl(var(--burnt-sienna))" }}>*</span>
                  </label>
                  <select
                    id="years_in_business"
                    className={inputClass}
                    style={{ ...inputStyle, ...inputFocusRing }}
                    value={form.years_in_business}
                    onChange={(e) => set("years_in_business", e.target.value)}
                  >
                    <option value="">Select…</option>
                    {YEARS_OPTIONS.map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Checkboxes */}
              <div
                className="rounded-ds-lg px-4 py-4 space-y-3"
                style={{
                  background: "hsl(var(--olivewood) / 0.04)",
                  border: "1px solid hsl(var(--olivewood) / 0.12)",
                }}
              >
                <p
                  className="text-ds-12 font-semibold"
                  style={{ color: "hsl(var(--ink-deep))" }}
                >
                  Credentials (check all that apply)
                </p>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    className="mt-0.5 w-4 h-4 rounded accent-bark shrink-0"
                    checked={form.has_insurance}
                    onChange={(e) => set("has_insurance", e.target.checked)}
                  />
                  <span className="text-ds-13 text-foreground leading-snug">
                    We carry general liability insurance
                  </span>
                </label>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    className="mt-0.5 w-4 h-4 rounded accent-bark shrink-0"
                    checked={form.has_license}
                    onChange={(e) => set("has_license", e.target.checked)}
                  />
                  <span className="text-ds-13 text-foreground leading-snug">
                    We hold applicable trade licenses
                  </span>
                </label>
              </div>

              {/* Referral source */}
              <div>
                <label
                  className="block text-ds-13 font-semibold text-foreground mb-1.5"
                  htmlFor="referral_source"
                >
                  How did you hear about us?{" "}
                  <span className="text-muted-foreground font-normal">(optional)</span>
                </label>
                <input
                  id="referral_source"
                  type="text"
                  placeholder="Google, a friend, community Facebook group…"
                  className={inputClass}
                  style={{ ...inputStyle, ...inputFocusRing }}
                  value={form.referral_source}
                  onChange={(e) => set("referral_source", e.target.value)}
                />
              </div>

              <Button
                type="submit"
                size="lg"
                className="w-full"
                disabled={submitting}
                style={{ background: "hsl(var(--bark))", color: "hsl(var(--parchment))" }}
              >
                {submitting ? "Submitting…" : "Apply to become a partner"}
              </Button>

              <p className="text-center text-ds-11 text-muted-foreground">
                We review every application personally and respond within 2 business days.
              </p>
            </form>
          </section>
        )}

        {/* ── Social proof strip ──────────────────────────────────────────── */}
        <section
          className="rounded-ds-xl px-4 py-5"
          style={{
            background:
              "linear-gradient(135deg, hsl(var(--bark) / 0.06), hsl(var(--gold-warm) / 0.05))",
            border: "1px solid hsl(var(--bark) / 0.12)",
          }}
        >
          <div className="flex items-center justify-around gap-2 flex-wrap">
            {socialProof.map(({ stat, label }) => (
              <div key={label} className="text-center px-2">
                <p
                  className="font-display font-bold italic text-ds-20"
                  style={{ color: "hsl(var(--bark))" }}
                >
                  {stat}
                </p>
                <p className="text-ds-11 text-muted-foreground mt-0.5">{label}</p>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-center gap-1.5 mt-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <Star
                key={i}
                className="w-3.5 h-3.5 fill-current"
                style={{ color: "hsl(var(--gold-warm))" }}
              />
            ))}
            <span className="text-ds-12 text-muted-foreground ml-1">
              Trusted by Louisiana service businesses
            </span>
          </div>
        </section>
      </div>
    </div>
  );
};

export default BecomeAPartner;
