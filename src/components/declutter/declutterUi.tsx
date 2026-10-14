/**
 * Declutter: shared words and small pieces for the three screens
 * (docs/specs/declutter-auctions.md). Plain words only: no "draft",
 * "pending_review" or other codes reach the member.
 */
import { Star } from "lucide-react";
import { useFeature } from "@/hooks/useFeature";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuthReady } from "@/hooks/useAuthReady";
import NotFound from "@/pages/info/NotFound";
import { fetchHasAgreedSales, type DeclutterStatus, type DeliverySize } from "@/lib/declutter/api";
import type { ReactNode } from "react";

export const STATUS_LABEL: Record<DeclutterStatus, string> = {
  draft: "Not listed yet",
  pending_review: "Waiting for a review",
  live: "For sale",
  reserved: "Someone is buying it",
  sold: "Sold",
  completed: "Handed over",
  ended: "Off sale",
  withdrawn: "Taken down",
  rejected: "Not approved",
  removed: "Removed by Louisiana Helpr",
};

export const STATUS_HELP: Partial<Record<DeclutterStatus, string>> = {
  draft: "Finish the listing to put it up for sale.",
  pending_review:
    "Someone from Louisiana Helpr checks a new seller's first 3 listings, and any listing the photo check flags. You'll get a notice when it's done.",
  rejected: "This listing wasn't approved. The reason is below.",
};

export const SIZE_LABEL: Record<DeliverySize, string> = {
  small: "Small: fits in a car",
  large: "Large: needs a truck",
  xl: "Extra large: truck and two people",
};

export const CATEGORY_LABEL: Record<string, string> = {
  furniture: "Furniture",
  appliances: "Appliances",
  electronics: "Electronics",
  kitchen: "Kitchen",
  home_decor: "Home decor",
  tools: "Tools",
  outdoor_garden: "Outdoor and garden",
  sports_outdoors: "Sports",
  toys_games: "Toys and games",
  baby_kids: "Baby and kids",
  clothing: "Clothing",
  books_media: "Books and media",
  other: "Other",
};

export const CONDITION_LABEL: Record<number, string> = {
  5: "Like new",
  4: "Lightly used",
  3: "Used, some wear",
  2: "Heavy wear or a fault",
  1: "For parts or repair",
};

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** 1-5 condition stars, with the words for screen readers and beside them. */
export function ConditionStars({ stars, showLabel = true }: { stars: number; showLabel?: boolean }) {
  const label = CONDITION_LABEL[stars] ?? "";
  return (
    <span className="inline-flex items-center gap-1.5" role="img" aria-label={`Condition: ${stars} of 5 stars, ${label}`}>
      <span className="inline-flex" aria-hidden>
        {[1, 2, 3, 4, 5].map((n) => (
          <Star
            key={n}
            className="w-3.5 h-3.5 text-amber-500"
            fill={n <= stars ? "currentColor" : "none"}
          />
        ))}
      </span>
      {showLabel && <span className="text-xs text-muted-foreground">{label}</span>}
    </span>
  );
}

/** A plain-English block in place of a control the member cannot use yet. */
export function DeclutterNotice({ title, children, tone = "info" }: { title: string; children?: ReactNode; tone?: "info" | "warn" }) {
  return (
    <div
      role={tone === "warn" ? "alert" : "status"}
      className={`rounded-2xl border p-4 text-sm ${tone === "warn" ? "border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100" : "border-border bg-card text-foreground"}`}
    >
      <p className="font-semibold">{title}</p>
      {children && <div className="mt-1 text-muted-foreground">{children}</div>}
    </div>
  );
}

/**
 * Renders Declutter only when the hidden switch is on for this member.
 * While the server's answer is loading it renders the screen's own
 * `skeleton` (DeclutterSkeletons.tsx: the page's real AppPage shell and
 * title, bones where the data lands), never a blank page and never a flash
 * of the 404 for a tester; a settled "off" is the 404, exactly as if the
 * route did not exist. Never the protection: every RPC refuses too.
 */
export function DeclutterGate({ children, skeleton, agreedSales }: { children: ReactNode; skeleton: ReactNode; agreedSales?: ReactNode }) {
  const enabled = useFeature("declutter");
  const { user, isReady } = useAuthReady();
  const qc = useQueryClient();
  const state = qc.getQueryState(["feature-enabled", "declutter", user?.id ?? null]);
  const settled = isReady && (!user || state?.status === "success" || state?.status === "error");
  // Row 62 (B44): with the switch off, a member with a sale in flight still
  // gets `agreedSales` (the cart and their sales) to finish it.
  const agreed = useQuery({
    queryKey: ["declutter", "has-agreed-sales", user?.id ?? null],
    enabled: !!agreedSales && settled && !enabled && !!user,
    queryFn: fetchHasAgreedSales,
  });
  if (enabled) return <>{children}</>;
  if (!settled) return <>{skeleton}</>;
  if (agreedSales && user) {
    if (agreed.isLoading) return <>{skeleton}</>;
    if (agreed.data === true) return <>{agreedSales}</>;
  }
  return <NotFound />;
}
