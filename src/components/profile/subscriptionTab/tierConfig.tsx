import { Crown, Sparkles, Star } from "lucide-react";

export type TierIconName = "star" | "sparkles" | "crown";

export const tierConfig: Array<{
  id: string;
  name: string;
  iconName: TierIconName;
  forWhom: string;
  monthly: string;
  annual: string;
  oneTime: string;
  annualSave: string;
  features: string[];
}> = [
  {
    id: "basic",
    name: "Basic",
    iconName: "star",
    forWhom: "Great for an occasional weekend job",
    monthly: "$5/mo",
    annual: "$50/yr",
    oneTime: "$5 one-time",
    annualSave: "Save 17%",
    features: ["Helpr Badge", "Instant Payouts", "Search Priority", "5-min Early Access"],
  },
  {
    id: "pro",
    name: "Pro",
    iconName: "sparkles",
    forWhom: "For Helprs picking up regular work",
    monthly: "$10/mo",
    annual: "$100/yr",
    oneTime: "$10 one-time",
    annualSave: "Save 17%",
    features: ["Everything in Basic", "Instant Payouts", "Portfolio Showcase", "10-min Early Access"],
  },
  {
    id: "elite",
    name: "Elite",
    iconName: "crown",
    forWhom: "For Helprs running this as their main income.",
    monthly: "$15/mo",
    annual: "$150/yr",
    oneTime: "$15 one-time",
    annualSave: "Save 17%",
    features: ["Everything in Pro", "Free Job Boosts", "Landing Spotlight", "Auto-Match", "20-min Early Access"],
  },
];

export const TierIcon = ({ name, className, style }: { name: TierIconName; className?: string; style?: React.CSSProperties }) => {
  if (name === "star") return <Star className={className} style={style} strokeWidth={2} />;
  if (name === "sparkles") return <Sparkles className={className} style={style} strokeWidth={2} />;
  return <Crown className={className} style={style} strokeWidth={2} />;
};
