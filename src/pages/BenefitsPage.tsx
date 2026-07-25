import {
  Heart,
  DollarSign,
  ShoppingBag,
  Clock,
  ExternalLink,
} from "lucide-react";
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
  color: string;
  items: BenefitItem[];
}

const SECTIONS: BenefitSection[] = [
  {
    icon: <Heart className="w-5 h-5" />,
    title: "Health & Wellness",
    color: "hsl(var(--burnt-sienna))",
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
    color: "hsl(var(--bark))",
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
    color: "hsl(var(--gold-warm))",
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

export default function BenefitsPage() {
  usePageTitle("Benefits & Perks — Helpr");

  const open = (url: string) =>
    window.open(url, "_blank", "noopener noreferrer");

  return (
    <div className="min-h-screen bg-premium-page pb-safe-nav">
      <PageHeader title="Benefits & Perks" showBrand rightSlot={<NotificationPanel />} />

      <div className="max-w-5xl lg:max-w-6xl xl:max-w-7xl 2xl:max-w-[90rem] mx-auto px-4 lg:px-8 pt-4 space-y-6">
        {/* Hero — text-white swapped for the parchment token used by every
            other gradient hero in the app, so the color reads from the
            design-system source instead of a raw utility. */}
        <div
          className="rounded-2xl p-6 shadow-md"
          style={{
            background:
              "linear-gradient(135deg, hsl(var(--burnt-sienna)) 0%, hsl(var(--bark)) 100%)",
            color: "hsl(var(--parchment))",
          }}
        >
          <p className="font-semibold text-lg mb-1">Built for Helprs, by Helprs.</p>
          <p className="text-sm opacity-85">
            These partner perks are curated for Louisiana Helpr members — health
            coverage, financial tools, and supply discounts to help you earn more
            and keep more.
          </p>
        </div>

        {/* Sections */}
        {SECTIONS.map((section) => (
          <div
            key={section.title}
            className="rounded-2xl overflow-hidden"
            style={{ background: "hsl(var(--cream))" }}
          >
            {/* Section header */}
            <div
              className="flex items-center gap-2 px-5 py-3"
              style={{ borderBottom: "1px solid hsl(var(--bark) / 0.08)" }}
            >
              <span style={{ color: section.color }}>{section.icon}</span>
              <h2
                className="font-semibold text-sm uppercase tracking-wide"
                style={{ color: section.color }}
              >
                {section.title}
              </h2>
            </div>

            {/* Items */}
            <div className="divide-y" style={{ borderColor: "hsl(var(--bark) / 0.06)" }}>
              {section.items.map((item) => (
                <button
                  key={item.name}
                  className="w-full text-left px-5 py-4 flex items-start justify-between gap-3 active:opacity-70 transition-opacity"
                  onClick={() => open(item.url)}
                >
                  <div>
                    <p
                      className="font-semibold text-sm"
                      style={{ color: "hsl(var(--bark))" }}
                    >
                      {item.name}
                    </p>
                    <p
                      className="text-xs mt-0.5 leading-relaxed"
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
        <div
          className="rounded-2xl p-5"
          style={{ background: "hsl(var(--cream))" }}
        >
          <div className="flex items-center gap-2 mb-3">
            <Clock className="w-4 h-4" style={{ color: "hsl(var(--olivewood))" }} />
            <h2
              className="font-semibold text-sm uppercase tracking-wide"
              style={{ color: "hsl(var(--olivewood))" }}
            >
              Coming soon
            </h2>
          </div>
          <ul className="space-y-1.5">
            {COMING_SOON.map((item) => (
              <li
                key={item}
                className="text-sm flex items-center gap-2"
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
