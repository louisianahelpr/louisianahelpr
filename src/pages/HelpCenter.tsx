import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Search,
  Mail,
  MapPin,
  ChevronRight,
  X,
} from "lucide-react";
import PageHeader from "@/components/PageHeader";
import PublicLayout from "@/components/marketing/PublicLayout";
import { usePageMeta } from "@/hooks/usePageMeta";
import {
  TOPICS,
  SECTION_ACCENTS,
  FAQ_SECTIONS,
  RESOURCES,
} from "./helpCenter/helpCenterContent";
import FaqAccordionItem from "./helpCenter/FaqAccordionItem";
import LouisianaOutline from "./helpCenter/LouisianaOutline";

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
      "Quick answers about posting jobs, earning as a Helpr, escrow, disputes, and more.",
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
              className="rounded-2xl p-6 text-center space-y-1 max-w-2xl"
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
            // Multi-column masonry-style layout: on desktop the FAQ topic
            // cards flow into 2–3 balanced columns instead of one tall stack,
            // using horizontal space and cutting page height roughly in half.
            <div className="[column-fill:balance] gap-4 columns-1 md:columns-2 xl:columns-3">
              {filteredSections.map((section) => {
                const accent = SECTION_ACCENTS[section.topic] ?? "hsl(var(--burnt-sienna))";
                return (
                <div
                  key={section.topic}
                  className="liquid-glass overflow-hidden mb-4 break-inside-avoid"
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

        {/* ── Resources + Contact: side-by-side split on desktop ── */}
        <div className="grid lg:grid-cols-2 gap-6 items-start">

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
            Browse these guides for the full picture, or reach our team.
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
            {RESOURCES.map((r) => (
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
          className="rounded-2xl p-5 lg:p-7 space-y-4 h-full"
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

      </div>
    </PublicLayout>
  );
};

export default HelpCenter;
