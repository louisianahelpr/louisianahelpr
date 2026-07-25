import {
  Heart,
  DollarSign,
  ShoppingBag,
  Clock,
  ExternalLink,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import PageHeader from "@/components/PageHeader";
import NotificationPanel from "@/components/NotificationPanel";
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
        tagline: "Bulk supplies, cleaning products & food for helpers.",
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

// Calm parchment card — matches HomeHistory / WorkRecord / StrSettings so
// /benefits reads like the rest of the profile-linked surface (no saturated
// hero, no cream fills). One shared style keeps the sections cohesive.
const cardStyle: React.CSSProperties = {
  background: "hsl(var(--parchment) / 0.70)",
  border: "1px solid hsl(var(--olivewood) / 0.10)",
  boxShadow:
    "0 1px 3px hsl(var(--olivewood) / 0.06), 0 4px 10px -4px hsl(var(--olivewood) / 0.08)",
};

// Design-system eyebrow — same serif-italic burnt-sienna caption the peer
// pages use for their section headers ("Work Summary", year groups, etc.).
const eyebrowClass = "font-serif italic uppercase text-ds-9";
const eyebrowStyle: React.CSSProperties = {
  color: "hsl(var(--burnt-sienna))",
  letterSpacing: "0.18em",
};

export default function BenefitsPage() {
  usePageTitle("Benefits & Perks — Helpr");
  const navigate = useNavigate();

  const open = (url: string) =>
    window.open(url, "_blank", "noopener noreferrer");

  return (
    <div className="min-h-screen bg-premium-page pb-safe-nav">
      {/* The intro copy that used to live in a saturated gradient hero now
          rides in the standard PageHeader eyebrow/meta slots — the same calm
          header treatment every other profile-linked page uses. */}
      <PageHeader
        title="Benefits & Perks"
        eyebrow="Built for Helprs, by Helprs"
        meta="Partner perks curated for Louisiana Helpr members — health coverage, financial tools, and supply discounts to help you earn more and keep more."
        onBack={() => navigate("/profile")}
        showBrand
        rightSlot={<NotificationPanel />}
      />

      <div className="mx-auto max-w-5xl px-4 lg:px-8 xl:px-12 pb-10 space-y-6 mt-2">
        {/* Sections */}
        {SECTIONS.map((section) => (
          <div
            key={section.title}
            className="rounded-ds-lg overflow-hidden"
            style={cardStyle}
          >
            {/* Section header */}
            <div
              className="flex items-center gap-2 px-5 py-3.5"
              style={{ borderBottom: "1px solid hsl(var(--olivewood) / 0.10)" }}
            >
              <span style={{ color: "hsl(var(--bark))" }}>{section.icon}</span>
              <h2 className={eyebrowClass} style={eyebrowStyle}>
                {section.title}
              </h2>
            </div>

            {/* Items */}
            <div className="divide-y" style={{ borderColor: "hsl(var(--olivewood) / 0.10)" }}>
              {section.items.map((item) => (
                <button
                  key={item.name}
                  className="w-full text-left px-5 py-4 flex items-start justify-between gap-3 active:opacity-70 transition-opacity"
                  onClick={() => open(item.url)}
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
                  />
                </button>
              ))}
            </div>
          </div>
        ))}

        {/* Coming soon */}
        <div className="rounded-ds-lg p-5" style={cardStyle}>
          <div className="flex items-center gap-2 mb-3">
            <Clock className="w-4 h-4" style={{ color: "hsl(var(--bark))" }} />
            <h2 className={eyebrowClass} style={eyebrowStyle}>
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
