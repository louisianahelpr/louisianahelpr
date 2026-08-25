import {
  Heart,
  DollarSign,
  ShoppingBag,
  Clock,
  ExternalLink,
} from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { usePageTitle } from "@/hooks/usePageTitle";

interface BenefitItem {
  name: string;
  tagline: string;
  url: string;
  comingSoon?: boolean;
}

interface BenefitSection {
  icon: React.ReactNode;
  title: string;
  items: BenefitItem[];
}

const SECTIONS: BenefitSection[] = [
  {
    icon: <Heart className="w-5 h-5" />,
    title: "Health & Wellness",
    items: [
      {
        name: "Stride Health",
        tagline: "Find affordable health, dental & vision plans for independent workers.",
        url: "https://stridehealth.com",
      },
      {
        name: "Teladoc",
        tagline: "Virtual doctor visits 24/7 — no insurance required.",
        url: "https://teladoc.com",
      },
    ],
  },
  {
    icon: <DollarSign className="w-5 h-5" />,
    title: "Financial Tools",
    items: [
      {
        name: "Catch",
        tagline: "Automated tax withholding and benefits for freelancers.",
        url: "https://catch.co",
      },
      {
        name: "Dave",
        tagline: "Cash advances and budgeting tools between gigs.",
        url: "https://dave.com",
      },
    ],
  },
  {
    icon: <ShoppingBag className="w-5 h-5" />,
    title: "Supplies & Discounts",
    items: [
      {
        name: "Toolbarn",
        tagline: "Trade pricing on tools, equipment & safety gear.",
        url: "https://toolbarn.com",
      },
      {
        name: "Home Depot Pro Xtra",
        tagline: "Members-only pricing, job-site delivery & volume discounts.",
        url: "https://www.homedepot.com/c/pro_xtra",
      },
      {
        name: "Sam's Club",
        tagline: "Bulk supplies, cleaning products & food for Helprs.",
        url: "https://www.samsclub.com",
      },
    ],
  },
];

const COMING_SOON: string[] = [
  "Commercial auto insurance",
  "Equipment rental discounts",
  "Professional development courses",
  "Background check fee coverage",
];

// The shared SHEET surface — `.doc-card` from the document surface ladder in
// index.css, the same rung /work-record uses. It replaces a hand-rolled
// `parchment/0.70` fill that measured 2/255 away from the page canvas at the
// bottom of the page gradient: the card was, numerically, the page.
//
// Still a DELIBERATE deviation from the app's `rounded-2xl liquid-glass p-5`
// card convention — these sections are edge-to-edge containers whose header
// and rows own their own padding, so a blanket p-5 would double-pad them.
// `.doc-card` sets material only (fill, border, shadow) and leaves geometry
// to the page, which is what makes it adoptable here at all.
const CARD_CLASS = "doc-card rounded-ds-lg overflow-hidden";

export default function BenefitsPage() {
  usePageTitle("Benefits & Perks — Helpr");

  // Partner rows are real anchors, not buttons — see the render below. The
  // previous `window.open(url, "_blank", "noopener noreferrer")` silently
  // applied NEITHER flag: that third argument is a COMMA-delimited feature
  // list, so "noopener noreferrer" parsed as one unrecognised token and the
  // partner tab kept a live `window.opener` handle back to us
  // (reverse-tabnabbing). Anchors with rel="noopener noreferrer" also restore
  // middle-click / open-in-new-tab / hover-preview and make screen readers
  // announce these as links instead of buttons.

  return (
    <div className="min-h-screen bg-premium-page pb-safe-nav">
      {/* The intro copy that used to live in a saturated gradient hero now
          rides in the standard PageHeader eyebrow/meta slots — the same calm
          header treatment every other profile-linked page uses. */}
      <PageHeader
        title="Benefits & Perks"
        eyebrow="Built for Helprs, by Helprs"
        meta="Partner perks curated for Louisiana Helpr members — health coverage, financial tools, and supply discounts to help you earn more and keep more."
        backTo="/profile"
        // No `width` — the header takes its `default` geometry, which IS the
        // body class below, so title and content share one edge at every size.
      />

            {/* CANONICAL DOCUMENT-SCROLL SHELL — identical on every page that wears
          it: `min-h-screen bg-premium-page pb-safe-nav` > <PageHeader> (default
          width) > `page-measure mx-auto px-5 lg:px-8 xl:px-12 pt-4 pb-8`.
          The header's `default` width IS this body class, so the title and the
          content share one left edge at every breakpoint. Owner: these pages
          "should share layouts ... there should not be any off from the rest",
          so do not give this page its own max-width or gutter ladder. */}
      <div className="page-measure mx-auto px-5 lg:px-8 xl:px-12 pt-4 pb-8 space-y-6">
        {/* Sections */}
        {SECTIONS.map((section) => (
          <div key={section.title} className={CARD_CLASS}>
            {/* Section header. `.doc-band` gives it a fill one value step
                below the card plus a stronger bottom rule, so it reads as a
                HEADER rather than as one more partner row. Before, the band
                had no fill at all and was separated from the rows below it by
                the same 10%-olivewood hairline that separates the rows from
                each other — three identical layers, so the grouping this page
                is built around was invisible. */}
            <div className="doc-band flex items-center gap-2 px-5 py-3.5">
              <span style={{ color: "hsl(var(--bark))" }}>{section.icon}</span>
              <h2 className="font-sans font-semibold text-ds-15" style={{ color: "hsl(var(--ink-deep))" }}>
                {section.title}
              </h2>
            </div>

            {/* Items */}
            <div className="divide-y doc-rule">
              {section.items.map((item) => (
                <a
                  key={item.name}
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full text-left px-5 py-4 flex items-start justify-between gap-3 active:opacity-70 transition-opacity"
                >
                  <div>
                    <p
                      className="font-semibold text-ds-14"
                      style={{ color: "hsl(var(--ink-deep))" }}
                    >
                      {item.name}
                    </p>
                    <p
                      className="text-ds-12 mt-0.5 leading-relaxed"
                      style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                    >
                      {item.tagline}
                    </p>
                  </div>
                  <ExternalLink
                    className="w-4 h-4 shrink-0 mt-0.5"
                    style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                    aria-hidden="true"
                  />
                </a>
              ))}
            </div>
          </div>
        ))}

        {/* Coming soon */}
        <div className={`${CARD_CLASS} p-5`}>
          <div className="flex items-center gap-2 mb-3">
            <Clock className="w-4 h-4" style={{ color: "hsl(var(--bark))" }} />
            <h2 className="font-sans font-semibold text-ds-15" style={{ color: "hsl(var(--ink-deep))" }}>
              Coming soon
            </h2>
          </div>
          <ul className="space-y-1.5">
            {COMING_SOON.map((item) => (
              <li
                key={item}
                className="text-ds-13 flex items-center gap-2"
                style={{ color: "hsl(var(--olivewood) / 0.8)" }}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-current shrink-0" />
                {item}
              </li>
            ))}
          </ul>
        </div>

        {/* No footer "Back to dashboard" button: the page already has the
            standard back affordance in its PageHeader (chevron, top-left), so a
            second full-width back button at the bottom was redundant chrome. */}
      </div>
    </div>
  );
}
