/**
 * /enterprise — B2B integration page for insurance companies, property
 * managers, healthcare networks, and retailers who want to dispatch
 * contractors automatically through Helpr.
 *
 * No auth required. Contact form uses a mailto: link (no DB needed).
 * Document-scroll layout (min-h-screen + PageHeader).
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { usePageTitle } from "@/hooks/usePageTitle";
import PageHeader from "@/components/PageHeader";
import PublicLayout from "@/components/marketing/PublicLayout";
import { Button } from "@/components/ui/button";
import {
  Building2,
  Stethoscope,
  Home,
  ShieldCheck,
  Webhook,
  Settings2,
  Radio,
  ChevronRight,
  CheckCircle2,
} from "lucide-react";

const USE_CASES = [
  {
    icon: Stethoscope,
    tag: "Healthcare",
    title: "Discharge-day home prep",
    body: "Auto-dispatch cleaning, transport, and setup help the moment a patient is released. Care coordinators set it once; Helpr handles the rest.",
    href: "/discharge",
    color: "var(--sage)",
  },
  {
    icon: ShieldCheck,
    tag: "Insurance",
    title: "Claim-to-contractor in minutes",
    body: "Policyholders get a verified contractor contact before the adjuster even calls back. Reduce cycle time, improve satisfaction.",
    href: "/insurance-claim",
    color: "var(--burnt-sienna)",
  },
  {
    icon: Home,
    tag: "Property Management",
    title: "Turns, maintenance, and tenant requests",
    body: "Unit turns, maintenance calls, and tenant requests all routed through one verified workforce. No vetting, no scheduling headaches.",
    href: undefined,
    color: "var(--bark)",
  },
];

const HOW_IT_WORKS = [
  {
    step: "01",
    icon: Webhook,
    title: "Connect via API or webhook",
    body: "We send your team credentials and endpoint documentation the same day you're approved. One API key handles all job types.",
  },
  {
    step: "02",
    icon: Settings2,
    title: "Define your triggers",
    body: "A claim opens, a discharge is scheduled, a work order is filed — configure exactly which events dispatch which job type.",
  },
  {
    step: "03",
    icon: Radio,
    title: "We dispatch and report",
    body: "A verified Helpr is on-site within your SLA window. Status updates post to your callback URL in real time.",
  },
];

const TRUST_ITEMS = [
  "SOC 2 preparation in progress",
  "Stripe escrow on every job",
  "Licensed trade verification",
  "Louisiana-based team + support",
];

const API_SNIPPET = `POST /api/v1/jobs/dispatch
Authorization: Bearer {your_api_key}

{
  "category": "handyman",
  "address": "123 Canal St, New Orleans, LA 70130",
  "description": "Post-discharge home setup, 2hr window",
  "urgency": "standard" | "urgent",
  "callback_url": "https://your-system.com/helpr-webhook"
}`;

const EnterprisePage = () => {
  usePageTitle("Enterprise & B2B Integrations — Louisiana Helpr");
  const navigate = useNavigate();

  const [companyName, setCompanyName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [useCase, setUseCase] = useState("");

  const buildMailto = () => {
    const subject = encodeURIComponent("Enterprise API Access Request");
    const body = encodeURIComponent(
      `Company: ${companyName}\nEmail: ${contactEmail}\n\nUse case:\n${useCase}`
    );
    return `mailto:enterprise@louisianahelpr.com?subject=${subject}&body=${body}`;
  };

  const inputClass =
    "w-full rounded-ds-md px-3 py-2.5 text-ds-14 text-foreground border focus:outline-none focus:ring-2 transition-all";
  const inputStyle = {
    background: "hsl(var(--parchment))",
    borderColor: "hsl(var(--olivewood) / 0.20)",
  };

  return (
    <PublicLayout showCtaBand={false}>
      <PageHeader
        title="Enterprise & B2B"
        eyebrow="For enterprise partners"
        onBack={() => navigate(-1)}
      />

      <div className="mx-auto max-w-2xl px-4 pt-2 pb-16 space-y-10">

        {/* ── Hero ─────────────────────────────────────────────────────────── */}
        <section
          className="rounded-ds-xl px-5 py-7 text-center"
          style={{
            background:
              "linear-gradient(135deg, hsl(var(--stormy-sky) / 0.08), hsl(var(--olivewood) / 0.06))",
            border: "1px solid hsl(var(--stormy-sky) / 0.14)",
          }}
        >
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3"
            style={{ background: "hsl(var(--stormy-sky) / 0.10)" }}
          >
            <Building2 className="w-6 h-6" style={{ color: "hsl(var(--stormy-sky))" }} />
          </div>
          <h2
            className="font-display font-bold italic text-ds-24 leading-tight mb-2"
            style={{ color: "hsl(var(--ink-deep))" }}
          >
            Automate your contractor dispatch
          </h2>
          <p className="text-ds-15 text-muted-foreground leading-relaxed max-w-md mx-auto">
            Connect Helpr to your workflows. When a claim opens, a patient is
            discharged, or a unit turns over — a verified contractor is already
            on their way.
          </p>
          <Button
            className="mt-5"
            style={{ background: "hsl(var(--stormy-sky))", color: "hsl(var(--parchment))" }}
            onClick={() => {
              document.getElementById("enterprise-contact")?.scrollIntoView({ behavior: "smooth" });
            }}
          >
            Request API access
          </Button>
        </section>

        {/* ── Use case cards ───────────────────────────────────────────────── */}
        <section>
          <h3
            className="font-serif italic uppercase text-ds-9 mb-4"
            style={{ color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}
          >
            Built for your industry
          </h3>
          <div className="space-y-3">
            {USE_CASES.map(({ icon: Icon, tag, title, body, href, color }) => (
              <div
                key={tag}
                className="rounded-ds-lg px-4 py-4"
                style={{
                  background: `hsl(${color} / 0.05)`,
                  border: `1px solid hsl(${color} / 0.14)`,
                }}
              >
                <div className="flex items-start gap-3">
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 mt-0.5"
                    style={{ background: `hsl(${color} / 0.11)` }}
                  >
                    <Icon className="w-4.5 h-4.5" style={{ color: `hsl(${color})` }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div
                      className="inline-block text-ds-9 font-bold uppercase px-1.5 py-0.5 rounded-full mb-1"
                      style={{
                        background: `hsl(${color} / 0.12)`,
                        color: `hsl(${color})`,
                        letterSpacing: "0.06em",
                      }}
                    >
                      {tag}
                    </div>
                    <p
                      className="text-ds-14 font-bold leading-tight"
                      style={{ color: "hsl(var(--ink-deep))" }}
                    >
                      {title}
                    </p>
                    <p className="text-ds-13 text-muted-foreground mt-1 leading-snug">
                      {body}
                    </p>
                    {href && (
                      <a
                        href={href}
                        className="inline-flex items-center gap-1 text-ds-12 font-semibold mt-2"
                        style={{ color: `hsl(${color})` }}
                      >
                        Learn more <ChevronRight className="w-3.5 h-3.5" />
                      </a>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── How it works ─────────────────────────────────────────────────── */}
        <section>
          <h3
            className="font-serif italic uppercase text-ds-9 mb-4"
            style={{ color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}
          >
            How it works
          </h3>
          <div className="space-y-3">
            {HOW_IT_WORKS.map(({ step, icon: Icon, title, body }) => (
              <div
                key={step}
                className="rounded-ds-lg px-4 py-4 flex items-start gap-4"
                style={{
                  background: "hsl(var(--olivewood) / 0.04)",
                  border: "1px solid hsl(var(--olivewood) / 0.12)",
                }}
              >
                <div className="shrink-0 flex flex-col items-center gap-1">
                  <span
                    className="font-display font-bold italic text-ds-18 leading-none"
                    style={{ color: "hsl(var(--stormy-sky) / 0.30)" }}
                  >
                    {step}
                  </span>
                  <Icon
                    className="w-4.5 h-4.5"
                    style={{ color: "hsl(var(--stormy-sky) / 0.60)" }}
                  />
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

        {/* ── API snippet callout ──────────────────────────────────────────── */}
        <section>
          <h3
            className="font-serif italic uppercase text-ds-9 mb-4"
            style={{ color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}
          >
            Integration specs
          </h3>
          <div
            className="rounded-ds-lg overflow-hidden"
            style={{
              background: "hsl(var(--ink-deep) / 0.94)",
              border: "1px solid hsl(var(--olivewood) / 0.10)",
            }}
          >
            {/* Code block header bar */}
            <div
              className="flex items-center gap-1.5 px-4 py-2.5"
              style={{
                background: "hsl(var(--ink-deep))",
                borderBottom: "1px solid hsl(var(--olivewood) / 0.10)",
              }}
            >
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: "hsl(var(--burnt-sienna) / 0.60)" }} />
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: "hsl(var(--gold-warm) / 0.50)" }} />
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: "hsl(var(--sage) / 0.50)" }} />
              <span
                className="ml-2 text-ds-10 font-mono"
                style={{ color: "hsl(var(--parchment) / 0.40)" }}
              >
                POST /api/v1/jobs/dispatch
              </span>
            </div>
            <pre
              className="px-4 py-4 text-ds-12 font-mono overflow-x-auto leading-relaxed whitespace-pre-wrap"
              style={{ color: "hsl(var(--parchment) / 0.85)" }}
            >
              {API_SNIPPET}
            </pre>
          </div>
          <p
            className="text-ds-12 text-muted-foreground mt-2 leading-snug"
            style={{ paddingLeft: "0.25rem" }}
          >
            Request API access below to receive your credentials and full documentation.
          </p>
        </section>

        {/* ── Contact form ─────────────────────────────────────────────────── */}
        <section id="enterprise-contact">
          <h3
            className="font-serif italic uppercase text-ds-9 mb-4"
            style={{ color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}
          >
            Request API access
          </h3>

          <div
            className="rounded-ds-xl px-5 py-6 space-y-4"
            style={{
              background: "hsl(var(--parchment) / 0.70)",
              border: "1px solid hsl(var(--olivewood) / 0.15)",
            }}
          >
            <div>
              <label
                className="block text-ds-13 font-semibold text-foreground mb-1.5"
                htmlFor="ent_company"
              >
                Company name
              </label>
              <input
                id="ent_company"
                type="text"
                placeholder="Acme Insurance Co."
                className={inputClass}
                style={inputStyle}
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                autoComplete="organization"
              />
            </div>

            <div>
              <label
                className="block text-ds-13 font-semibold text-foreground mb-1.5"
                htmlFor="ent_email"
              >
                Contact email
              </label>
              <input
                id="ent_email"
                type="email"
                placeholder="you@company.com"
                className={inputClass}
                style={inputStyle}
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                autoComplete="email"
              />
            </div>

            <div>
              <label
                className="block text-ds-13 font-semibold text-foreground mb-1.5"
                htmlFor="ent_usecase"
              >
                Describe your use case
              </label>
              <textarea
                id="ent_usecase"
                rows={4}
                placeholder="e.g. We handle ~200 homeowner claims/month and want to dispatch contractors automatically when a claim is opened…"
                className={inputClass}
                style={{ ...inputStyle, resize: "vertical" }}
                value={useCase}
                onChange={(e) => setUseCase(e.target.value)}
              />
            </div>

            <a
              href={buildMailto()}
              className="block"
            >
              <Button
                type="button"
                size="lg"
                className="w-full"
                style={{ background: "hsl(var(--stormy-sky))", color: "hsl(var(--parchment))" }}
              >
                Request API Access
              </Button>
            </a>
            <p className="text-center text-ds-11 text-muted-foreground">
              We'll respond within 1 business day with credentials and docs.
            </p>
          </div>
        </section>

        {/* ── Trust strip ──────────────────────────────────────────────────── */}
        <section
          className="rounded-ds-xl px-5 py-5"
          style={{
            background: "hsl(var(--olivewood) / 0.05)",
            border: "1px solid hsl(var(--olivewood) / 0.12)",
          }}
        >
          <p
            className="font-serif italic uppercase text-ds-9 text-center mb-4"
            style={{ color: "hsl(var(--olivewood) / 0.8)", letterSpacing: "0.18em" }}
          >
            Trust &amp; Compliance
          </p>
          <div className="grid grid-cols-2 gap-3">
            {TRUST_ITEMS.map((item) => (
              <div key={item} className="flex items-start gap-2">
                <CheckCircle2
                  className="w-4 h-4 shrink-0 mt-0.5"
                  style={{ color: "hsl(var(--sage))" }}
                />
                <span className="text-ds-12 text-muted-foreground leading-snug">{item}</span>
              </div>
            ))}
          </div>
        </section>

        {/* ── Bottom CTA ───────────────────────────────────────────────────── */}
        <div className="text-center space-y-3 pt-2">
          <p className="text-ds-13 text-muted-foreground">
            Looking to join as an individual or small business?
          </p>
          <a
            href="/become-a-partner"
            className="inline-flex items-center gap-1.5 text-ds-13 font-semibold"
            style={{ color: "hsl(var(--bark))" }}
          >
            Become a Helpr Partner <ChevronRight className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>
    </PublicLayout>
  );
};

export default EnterprisePage;
