import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Search,
  Rocket,
  ClipboardList,
  Briefcase,
  CreditCard,
  ShieldCheck,
  Settings,
  Mail,
  MapPin,
  ChevronDown,
  ChevronRight,
  BookOpen,
  Tag,
  Scale,
  X,
} from "lucide-react";
import PageHeader from "@/components/PageHeader";
import PublicLayout from "@/components/marketing/PublicLayout";
import { usePageMeta } from "@/hooks/usePageMeta";


// ─── Topic cards ──────────────────────────────────────────────────────────────

const TOPICS = [
  {
    icon: Rocket,
    label: "Getting Started",
    desc: "New to Helpr? Start here.",
    color: "hsl(var(--burnt-sienna))",
    bg: "hsl(var(--burnt-sienna) / 0.10)",
  },
  {
    icon: ClipboardList,
    label: "Posting a Job",
    desc: "Write a great post and get results.",
    color: "hsl(var(--bark))",
    bg: "hsl(var(--bark) / 0.10)",
  },
  {
    icon: Briefcase,
    label: "Finding Work",
    desc: "Apply, get hired, and grow your income.",
    color: "hsl(var(--success-ink))",
    bg: "hsl(var(--success-ink) / 0.12)",
  },
  {
    icon: CreditCard,
    label: "Payments & Escrow",
    desc: "How money is held, released, and paid.",
    color: "hsl(var(--gold-warm))",
    bg: "hsl(var(--gold-warm) / 0.15)",
  },
  {
    icon: ShieldCheck,
    label: "Trust & Safety",
    desc: "Verification, disputes, and reporting.",
    color: "hsl(var(--olivewood))",
    bg: "hsl(var(--olivewood) / 0.12)",
  },
  {
    icon: Settings,
    label: "Account & Settings",
    desc: "Email, password, deletion, Senior Mode.",
    color: "hsl(var(--olivewood))",
    bg: "hsl(var(--olivewood) / 0.10)",
  },
];

// Per-section accent tint so the FAQ topic labels read as a varied palette
// (bark / sienna / olivewood / gold / sage) rather than one flat color.
const SECTION_ACCENTS: Record<string, string> = {
  "Getting Started": "hsl(var(--burnt-sienna))",
  "Posting a Job": "hsl(var(--bark))",
  "Finding Work": "hsl(var(--success-ink))",
  "Payments & Escrow": "hsl(var(--gold-warm))",
  "Trust & Safety": "hsl(var(--olivewood))",
  "Account & Settings": "hsl(var(--burnt-sienna))",
};

// ─── FAQ data ─────────────────────────────────────────────────────────────────

interface FaqItem {
  q: string;
  a: string;
}

interface FaqSection {
  topic: string;
  items: FaqItem[];
}

const FAQ_SECTIONS: FaqSection[] = [
  {
    topic: "Getting Started",
    items: [
      {
        q: "Do I need an account to browse jobs?",
        a: "No, you can browse without signing up. You'll need an account to post or apply.",
      },
      {
        q: "Is Helpr available everywhere in Louisiana?",
        a: "We're active in 64 parishes and growing. If your area isn't busy yet, posting a job is the best way to attract local helprs.",
      },
      {
        q: "Can I both post jobs and work as a helper?",
        a: 'Yes — every account can do both. There\'s no separate "poster" or "helper" mode.',
      },
    ],
  },
  {
    topic: "Posting a Job",
    items: [
      {
        q: "What should I write in my job description?",
        a: "The more specific, the better. Include the exact task, how long you expect it to take, any equipment needed, and whether parking is available.",
      },
      {
        q: "How is the price determined?",
        a: "You can set your own price, accept bids from competing helprs, or use Helpr's Smart Price suggestion based on local market data.",
      },
      {
        q: "Can I cancel after someone applies?",
        a: "Yes, before accepting an applicant. Once you accept and payment is held securely, a cancellation fee applies.",
      },
    ],
  },
  {
    topic: "Finding Work",
    items: [
      {
        q: "How do I get my first application accepted?",
        a: "A complete profile (photo, bio, skills) helps posters trust you faster. Respond fast — posters notice quick turnaround.",
      },
      {
        q: "When do I get paid?",
        a: "Payment releases to your Helpr account after the poster confirms completion. Same-day transfer to your bank if your payout account is set up.",
      },
      {
        q: "What if a poster doesn't confirm completion?",
        a: "If a poster doesn't confirm within 48 hours of you marking work done, it auto-completes and payment releases.",
      },
    ],
  },
  {
    topic: "Payments & Escrow",
    items: [
      {
        q: "What is Helpr Escrow?",
        a: "When a poster accepts your application, their payment is held securely by Helpr (via Stripe). It releases to you only after completion is confirmed. Neither side can touch it mid-job.",
      },
      {
        q: "What fees does Helpr charge?",
        a: "Free account Helprs keep 88% (12% platform fee). Pro members keep 90%, Elite keeps 92%. Posters pay a small service fee at checkout.",
      },
      {
        q: "What if there's a dispute?",
        a: "Open a dispute from the job detail screen. Our team reviews both sides and can release the payment to either party.",
      },
    ],
  },
  {
    topic: "Trust & Safety",
    items: [
      {
        q: "How are helpers verified?",
        a: "Every helper submits a government-issued ID. Licensed trade work (electrical, plumbing) requires matching verified license.",
      },
      {
        q: "What is the cancellation rate?",
        a: "We show a helper's cancellation history on their profile once they've completed 5+ jobs. Low cancellation is a strong trust signal.",
      },
      {
        q: "Can I report a helper or poster?",
        a: 'Yes — the "Report" option is in every job detail and profile. Our team reviews all reports within 24 hours.',
      },
    ],
  },
  {
    topic: "Account & Settings",
    items: [
      {
        q: "How do I change my email or password?",
        a: "Go to Profile → Account Security.",
      },
      {
        q: "Can I delete my account?",
        a: "Yes. Profile → ··· menu → Delete account. We retain transaction records per Louisiana law but remove all personal data.",
      },
      {
        q: "What is Senior Mode?",
        a: "Senior Mode simplifies the interface and enables a trusted family member to monitor jobs on your behalf. Enable it in Profile → Settings.",
      },
    ],
  },
];

// ─── FaqAccordionItem ─────────────────────────────────────────────────────────

const FaqAccordionItem = ({ q, a, defaultOpen = false }: FaqItem & { defaultOpen?: boolean }) => {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div
      className="border-b last:border-0"
      style={{ borderColor: "hsl(var(--olivewood) / 0.12)" }}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-start justify-between gap-3 py-4 text-left transition-opacity hover:opacity-80"
      >
        <span
          className="font-sans font-semibold text-ds-14 leading-snug"
          style={{ color: "hsl(var(--ink-deep))" }}
        >
          {q}
        </span>
        <ChevronDown
          className="w-4 h-4 shrink-0 mt-0.5 transition-transform duration-200"
          style={{
            color: "hsl(var(--olivewood))",
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
          }}
          strokeWidth={2}
          aria-hidden
        />
      </button>
      {open && (
        <div className="pb-4">
          <p
            className="font-sans text-ds-13 leading-relaxed"
            style={{ color: "hsl(var(--olivewood))" }}
          >
            {a}
          </p>
        </div>
      )}
    </div>
  );
};

// ─── Louisiana outline icon (inline SVG) ─────────────────────────────────────

const LouisianaOutline = () => (
  <svg
    viewBox="0 0 80 100"
    className="w-7 h-7 shrink-0"
    aria-hidden
    fill="none"
  >
    <path
      d="M12,12 L68,12 L70,40 L66,64 L60,74 L56,86 Q52,92 48,90 Q42,93 38,88 Q32,84 32,80 L22,70 L16,64 L12,44 Z"
      fill="currentColor"
      fillOpacity="0.22"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
    />
  </svg>
);

// ─── HelpCenter ───────────────────────────────────────────────────────────────

const HelpCenter = () => {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");

  // Client-side KB search: the whole knowledge base is the static
  // FAQ_SECTIONS array, so we filter in-memory rather than round-trip a
  // backend. A topic-name match surfaces the entire section (so clicking a
  // topic card reads as "show me everything about X"); otherwise we match
  // individual question/answer text.
  const q = query.trim().toLowerCase();
  const filteredSections = q
    ? FAQ_SECTIONS.map((section) => {
        const topicMatch = section.topic.toLowerCase().includes(q);
        const items = topicMatch
          ? section.items
          : section.items.filter(
              (i) => i.q.toLowerCase().includes(q) || i.a.toLowerCase().includes(q),
            );
        return { ...section, items };
      }).filter((section) => section.items.length > 0)
    : FAQ_SECTIONS;
  const searching = q.length > 0;
  const noResults = searching && filteredSections.length === 0;

  usePageMeta({
    title: "Help Center — Louisiana Helpr",
    description:
      "Find answers to common questions about posting jobs, finding work, Helpr Escrow, payments, and account settings.",
    canonical: "https://www.louisianahelpr.com/help",
    ogTitle: "Louisiana Helpr Help Center",
    ogDescription:
      "Quick answers about posting jobs, earning as a helper, escrow, disputes, and more.",
  });

  return (
    <PublicLayout>
      <PageHeader
        eyebrow="Support"
        title="Help Center"
        onBack={() => navigate("/")}
      />

      <div className="mx-auto max-w-5xl lg:max-w-6xl xl:max-w-7xl 2xl:max-w-[90rem] px-5 lg:px-8 xl:px-12 pb-2 space-y-10">

        {/* ── Decorative search header ── */}
        <div
          className="rounded-2xl p-6 lg:p-8 space-y-4 relative overflow-hidden"
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

          <span className="text-display-eyebrow">Support</span>

          <h2
            className="font-display italic font-bold leading-[1.05] text-balance"
            style={{
              fontSize: "clamp(1.9rem, 4.5vw + 0.5rem, 3rem)",
              color: "hsl(var(--ink-deep))",
              letterSpacing: "-0.03em",
            }}
          >
            How can we{" "}
            <span style={{ color: "hsl(var(--burnt-sienna))" }}>help?</span>
          </h2>

          <p className="subhead-serif text-foreground text-ds-17 lg:text-ds-20 leading-relaxed max-w-xl">
            Search answers about posting jobs, finding work, escrow, and your
            account — or browse the topics below.
          </p>

          {/* Functional KB search — filters FAQ_SECTIONS as you type */}
          <div
            className="flex items-center gap-3 rounded-ds-md px-4 py-3"
            style={{
              background: "hsl(var(--parchment) / 0.80)",
              border: "1px solid hsl(var(--olivewood) / 0.22)",
            }}
          >
            <Search
              className="w-4 h-4 shrink-0"
              style={{ color: "hsl(var(--olivewood) / 0.8)" }}
              strokeWidth={1.75}
              aria-hidden
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search help articles..."
              aria-label="Search help articles"
              className="flex-1 min-w-0 bg-transparent border-0 outline-none font-sans text-ds-14 placeholder:text-[hsl(var(--olivewood)/0.8)]"
              style={{ color: "hsl(var(--ink-deep))" }}
            />
            {searching && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="shrink-0 transition-opacity hover:opacity-70"
              >
                <X
                  className="w-4 h-4"
                  style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                  strokeWidth={1.75}
                />
              </button>
            )}
          </div>

          <p
            className="font-sans text-ds-12"
            style={{ color: "hsl(var(--olivewood) / 0.8)" }}
          >
            {searching
              ? noResults
                ? "No matching articles — try different words or email us below."
                : "Showing matching articles."
              : "Browse by topic below or scroll to popular questions."}
          </p>
        </div>

        {/* ── Topic cards grid (hidden while searching) ── */}
        {!searching && (
          <section aria-labelledby="topics-heading">
            <h2
              id="topics-heading"
              className="font-display italic font-semibold text-ds-18 mb-4 flex items-center"
              style={{ color: "hsl(var(--ink-deep))" }}
            >
              <span
                className="inline-block w-1 h-4 rounded-full mr-2 align-middle"
                style={{ background: "hsl(var(--burnt-sienna))" }}
              />
              Browse by topic
            </h2>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {TOPICS.map(({ icon: Icon, label, desc, color, bg }) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => setQuery(label)}
                  aria-label={`Show ${label} articles`}
                  className="text-left rounded-2xl p-4 space-y-2 transition-transform active:scale-[0.98] hover:opacity-90"
                  style={{
                    background:
                      "linear-gradient(135deg, hsl(var(--parchment) / 0.70) 0%, hsl(var(--parchment) / 0.40) 100%)",
                    border: "1px solid hsl(var(--olivewood) / 0.12)",
                    boxShadow:
                      "inset 0 1px 0 hsl(255 100% 100% / 0.35), 0 1px 4px -1px hsl(var(--olivewood) / 0.08)",
                  }}
                >
                  <div
                    className="w-9 h-9 rounded-ds-sm flex items-center justify-center"
                    style={{ background: bg }}
                  >
                    <Icon
                      className="w-4 h-4"
                      style={{ color }}
                      strokeWidth={1.75}
                    />
                  </div>
                  <p
                    className="font-sans font-semibold text-ds-13 leading-tight"
                    style={{ color: "hsl(var(--ink-deep))" }}
                  >
                    {label}
                  </p>
                  <p
                    className="font-sans text-ds-11 leading-snug"
                    style={{ color: "hsl(var(--olivewood))" }}
                  >
                    {desc}
                  </p>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* ── Popular questions accordion ── */}
        <section aria-labelledby="faq-heading" className="max-w-3xl">
          <h2
            id="faq-heading"
            className="font-display italic font-semibold text-ds-18 mb-5 flex items-center"
            style={{ color: "hsl(var(--ink-deep))" }}
          >
            <span
              className="inline-block w-1 h-4 rounded-full mr-2 align-middle"
              style={{ background: "hsl(var(--burnt-sienna))" }}
            />
            {searching ? "Matching articles" : "Popular questions"}
          </h2>

          {noResults ? (
            <div
              className="rounded-2xl p-6 text-center space-y-1"
              style={{
                background: "hsl(var(--parchment) / 0.5)",
                border: "1px solid hsl(var(--olivewood) / 0.14)",
              }}
            >
              <p
                className="font-sans font-semibold text-ds-14"
                style={{ color: "hsl(var(--ink-deep))" }}
              >
                No results for &ldquo;{query.trim()}&rdquo;
              </p>
              <p
                className="font-sans text-ds-12"
                style={{ color: "hsl(var(--olivewood))" }}
              >
                Try a different word, or email{" "}
                <a
                  href="mailto:admin@louisianahelpr.com"
                  className="font-semibold underline"
                  style={{ color: "hsl(var(--burnt-sienna))" }}
                >
                  admin@louisianahelpr.com
                </a>
                .
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {filteredSections.map((section) => {
                const accent = SECTION_ACCENTS[section.topic] ?? "hsl(var(--burnt-sienna))";
                return (
                <div
                  key={section.topic}
                  className="liquid-glass overflow-hidden"
                >
                  {/* Topic header */}
                  <div
                    className="px-5 py-3"
                    style={{
                      background:
                        "linear-gradient(90deg, hsl(var(--parchment) / 0.55) 0%, transparent 100%)",
                      borderBottom: "1px solid hsl(var(--olivewood) / 0.10)",
                    }}
                  >
                    <p
                      className="font-sans font-semibold uppercase text-[0.65rem] tracking-widest flex items-center"
                      style={{ color: accent }}
                    >
                      <span
                        className="inline-block w-1 h-3.5 rounded-full mr-2 align-middle"
                        style={{ background: accent }}
                      />
                      {section.topic}
                    </p>
                  </div>

                  {/* Items — auto-expand while searching so hits are visible */}
                  <div className="px-5">
                    {section.items.map((item) => (
                      <FaqAccordionItem
                        key={`${item.q}-${q}`}
                        q={item.q}
                        a={item.a}
                        defaultOpen={searching}
                      />
                    ))}
                  </div>
                </div>
                );
              })}
            </div>
          )}
        </section>

        {/* ── More resources ── */}
        <section aria-labelledby="resources-heading" className="space-y-4">
          <h2
            id="resources-heading"
            className="font-display italic font-bold text-ds-20 lg:text-ds-24 tracking-[-0.02em] flex items-center"
            style={{ color: "hsl(var(--ink-deep))" }}
          >
            <span
              className="inline-block w-1 h-4 rounded-full mr-2 align-middle"
              style={{ background: "hsl(var(--burnt-sienna))" }}
            />
            Still have a{" "}
            <span style={{ color: "hsl(var(--burnt-sienna))" }}>&nbsp;question?&nbsp;</span>
          </h2>
          <p
            className="font-sans text-ds-13 -mt-2"
            style={{ color: "hsl(var(--olivewood))" }}
          >
            Browse these guides for the full picture, or reach our team below.
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
            {[
              {
                icon: BookOpen,
                label: "How Helpr works",
                desc: "Post, hire, and get paid — end to end.",
                to: "/how-it-works",
                accent: "hsl(var(--bark))",
                accentBg: "hsl(var(--bark) / 0.1)",
              },
              {
                icon: Tag,
                label: "Pricing guide",
                desc: "Fair-price ranges for common Louisiana jobs.",
                to: "/local-guide",
                accent: "hsl(var(--gold-warm))",
                accentBg: "hsl(var(--gold-warm) / 0.14)",
              },
              {
                icon: Scale,
                label: "Rules & safety",
                desc: "Community rules, disputes, and protections.",
                to: "/legal?tab=community",
                accent: "hsl(var(--burnt-sienna))",
                accentBg: "hsl(var(--burnt-sienna) / 0.1)",
              },
              {
                icon: Briefcase,
                label: "Browse jobs",
                desc: "See what neighbors need help with right now.",
                to: "/jobs",
                accent: "hsl(var(--success-ink))",
                accentBg: "hsl(var(--success-ink) / 0.12)",
              },
            ].map((r) => (
              <Link
                key={r.label}
                to={r.to}
                className="liquid-glass group flex items-center gap-3 px-4 py-3 transition-transform active:scale-[0.98] hover:opacity-95"
              >
                <div
                  className="w-9 h-9 rounded-ds-md flex items-center justify-center shrink-0"
                  style={{ background: r.accentBg }}
                >
                  <r.icon
                    className="w-4 h-4"
                    style={{ color: r.accent }}
                    strokeWidth={1.75}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p
                    className="font-sans font-semibold text-ds-13 leading-snug"
                    style={{ color: "hsl(var(--ink-deep))" }}
                  >
                    {r.label}
                  </p>
                  <p
                    className="font-sans text-ds-11 leading-snug"
                    style={{ color: "hsl(var(--olivewood))" }}
                  >
                    {r.desc}
                  </p>
                </div>
                <ChevronRight
                  className="w-4 h-4 shrink-0 transition-transform group-hover:translate-x-0.5"
                  style={{ color: "hsl(var(--olivewood) / 0.6)" }}
                  strokeWidth={2}
                />
              </Link>
            ))}
          </div>
        </section>

        {/* ── Contact section ── */}
        <section
          aria-labelledby="contact-heading"
          className="rounded-2xl p-5 lg:p-7 space-y-4"
          style={{
            background:
              "linear-gradient(135deg, hsl(var(--bark) / 0.06) 0%, hsl(var(--burnt-sienna) / 0.06) 100%)",
            border: "1px solid hsl(var(--bark) / 0.14)",
          }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center shrink-0"
              style={{
                background: "hsl(var(--bark))",
                color: "hsl(var(--parchment))",
                boxShadow: "0 8px 20px -8px hsl(var(--bark) / 0.5)",
              }}
            >
              <LouisianaOutline />
            </div>
            <div>
              <h2
                id="contact-heading"
                className="font-sans font-semibold text-ds-15"
                style={{ color: "hsl(var(--ink-deep))" }}
              >
                Still need help? Reach a real person.
              </h2>
              <p
                className="font-sans text-ds-12"
                style={{ color: "hsl(var(--olivewood))" }}
              >
                Louisiana Helpr support team
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Mail
                className="w-4 h-4 shrink-0"
                style={{ color: "hsl(var(--burnt-sienna))" }}
                strokeWidth={1.75}
              />
              <a
                href="mailto:admin@louisianahelpr.com"
                className="font-sans font-semibold text-ds-13 transition-opacity hover:opacity-75"
                style={{ color: "hsl(var(--burnt-sienna))" }}
              >
                admin@louisianahelpr.com
              </a>
            </div>
            <div className="flex items-center gap-2">
              <MapPin
                className="w-4 h-4 shrink-0"
                style={{ color: "hsl(var(--olivewood))" }}
                strokeWidth={1.75}
              />
              <p
                className="font-sans text-ds-13"
                style={{ color: "hsl(var(--olivewood))" }}
              >
                Mon–Fri, 8am–6pm CST
              </p>
            </div>
          </div>

          <p
            className="font-serif italic text-ds-13 leading-relaxed"
            style={{ color: "hsl(var(--olivewood) / 0.8)" }}
          >
            We review every message and aim to respond within one business day.
            For urgent safety or dispute concerns, flag it in the subject line.
          </p>
        </section>

      </div>
    </PublicLayout>
  );
};

export default HelpCenter;
