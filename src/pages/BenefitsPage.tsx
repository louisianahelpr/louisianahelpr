import {
  Heart,
  DollarSign,
  ShoppingBag,
  ExternalLink,
} from "lucide-react";
import AppPage from "@/components/AppPage";
import { usePageTitle } from "@/hooks/usePageTitle";
import { openExternalUrl } from "@/lib/openExternalUrl";
import { isNativePlatform } from "@/lib/nativeInit";

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
        tagline: "Tax withholding and benefits built for self-employed workers.",
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
        tagline: "Trade account with volume pricing on tools, equipment & safety gear.",
        url: "https://toolbarn.com",
      },
      {
        name: "Home Depot Pro Xtra",
        tagline: "Free Pro program — bulk pricing, job-site delivery & purchase tracking.",
        url: "https://www.homedepot.com/c/pro_xtra",
      },
      {
        name: "Sam's Club",
        tagline: "Warehouse club for bulk supplies, cleaning products & food.",
        url: "https://www.samsclub.com",
      },
    ],
  },
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
    <AppPage title="Benefits & Perks" backTo="/profile">
      <div className="space-y-6">
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
                  // The anchor + rel reasoning above is right for the WEB and
                  // is kept. It does not cover NATIVE: /benefits is an in-app
                  // screen (mobileNavHelpers `authPages`) and the shell serves
                  // the app from `capacitor://localhost`, so a plain anchor to
                  // an https origin is the exact hand-off `openExternalUrl`
                  // exists for — every other off-app navigation in the app
                  // (14 call sites) routes through it. Worse here than
                  // elsewhere: tapping a partner row changes NO state, so a
                  // hand-off that does nothing is indistinguishable from one
                  // that worked. Web keeps the anchor's default behaviour;
                  // native gets the in-app browser sheet.
                  onClick={(e) => {
                    // `isNativePlatform` is a const boolean here, not a
                    // function — the sibling helper in @/lib/nativePlatform IS
                    // a function, and calling the wrong one silently throws
                    // inside an event handler.
                    if (!isNativePlatform) return;
                    e.preventDefault();
                    void openExternalUrl(item.url);
                  }}
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

        {/* DISCLOSURE — this page has no partner agreements behind it.
            Every row is a plain link to a public third-party site: there is no
            partners table, no perk code, no affiliate link, no eligibility
            check, and no Helpr-negotiated rate. The taglines used to imply
            otherwise ("Members-only pricing", "Bulk supplies … for Helprs"),
            which put a claim on the screen that nothing in the product could
            honour — the same defect class as a badge nothing checks. They now
            describe each program truthfully, and this line says plainly whose
            terms apply. If real partnerships are ever signed, drive these rows
            off a `partners` row with a perk code and delete this note; do not
            re-add negotiated-rate language ahead of a negotiated rate. */}
        <p
          className="px-1 text-ds-11 leading-relaxed"
          style={{ color: "hsl(var(--olivewood) / 0.75)" }}
        >
          These are independent services we think are useful for self-employed
          Helprs — not Helpr partners. Pricing, eligibility and terms are set by
          each company, and Helpr earns nothing from your signing up.
        </p>

        {/* "Coming soon" card removed (owner, 2026-08-30). It listed four
            unshipped perks with no date attached — a promise the page could
            not keep, closing a screen whose whole job is perks you can use
            today. */}

        {/* No footer "Back to dashboard" button: the page already has the
            standard back affordance in its PageHeader (chevron, top-left), so a
            second full-width back button at the bottom was redundant chrome. */}
      </div>
    </AppPage>
  );
}
