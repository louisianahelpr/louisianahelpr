/**
 * Declutter: shared words and small pieces for the three screens
 * (docs/specs/declutter-auctions.md). Plain words only: no "draft",
 * "pending_review" or other codes reach the member.
 */
import { useFeature } from "@/hooks/useFeature";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuthReady } from "@/hooks/useAuthReady";
import { featureSwitchSettled } from "@/lib/featureSwitchQuery";
import NotFound from "@/pages/info/NotFound";
import { fetchHasAgreedSales, type DeclutterStatus, type DeliverySize } from "@/lib/declutter/api";
import type { ReactNode } from "react";

const STATUS_LABEL: Record<DeclutterStatus, string> = {
  draft: "Not listed yet",
  pending_review: "Waiting for a review",
  live: "For sale",
  paused: "Paused",
  reserved: "Someone is buying it",
  sold: "Sold",
  completed: "Handed over",
  ended: "Off sale",
  withdrawn: "Taken down",
  rejected: "Not approved",
  removed: "Removed by Louisiana Helpr",
  sold_elsewhere: "Sold elsewhere",
};

/**
 * A seller's own listing's status word. A FREE item is claimed, never sold (deep audit SE-4, 2026-10-28: a claimed
 * free item read "Sold" before anyone had picked it up): declutter_claim_free reserves it, declutter_checkout_free
 * moves it to 'sold' with nothing paid, and only the handover makes it 'completed'.
 */
export function sellerStatusLabel(item: { status: DeclutterStatus; current_price_cents: number }): string {
  if (item.current_price_cents === 0 && item.status === "reserved") return "Claimed";
  if (item.current_price_cents === 0 && item.status === "sold") return "Claimed · waiting for pickup";
  return STATUS_LABEL[item.status];
}

export const STATUS_HELP: Partial<Record<DeclutterStatus, string>> = {
  draft: "Finish the listing to put it up for sale.",
  pending_review:
    "Our automatic check flagged something, or it didn't finish, so someone from Louisiana Helpr is looking at it before buyers see it. You'll get a notice when it's done.",
  rejected: "This listing wasn't approved. The reason is below.",
  removed: "Louisiana Helpr took this listing down after a report. The reason is below.",
  paused: "Hidden from buyers. Relist it any time.",
  withdrawn: "Buyers can't see it. Relist it to put it up again with new photos.",
};

export const SIZE_LABEL: Record<DeliverySize, string> = {
  small: "Small: fits in a car",
  large: "Large: needs a truck",
  xl: "Extra large: truck and two people",
};

// The one category-name map (src/lib/declutter/categoryIcons.ts), re-exported for the screens that import it here.
export { CATEGORY_GROUPS, CATEGORY_LABEL } from "@/lib/declutter/categoryIcons";

export const CONDITION_LABEL: Record<number, string> = {
  5: "Like new",
  4: "Lightly used",
  3: "Used, some wear",
  2: "Heavy wear or a fault",
  1: "For parts or repair",
};

/** The four sales-tax confirmations (row 54), asked before every listing. */
export const TAX_STATEMENTS = [
  "I bought this item for my own personal or household use.",
  "I'm not in the business of selling items like this.",
  "I don't sell things often. This is an occasional sale.",
  "I'll keep the item until I hand it over to the buyer.",
] as const;

/**
 * The same four facts as ONE sentence for the Sell flow's single checkbox
 * (owner 2026-10-28: "make these checks 1"). One tick records all four
 * attestations (attestItem sends each as true; declutter_attest_item stores
 * each column), so the R.S. 47:305(A) occasional-sale record is unchanged.
 */
export const TAX_ATTESTATION_SENTENCE =
  "I bought this for my own personal or household use, I'm not in the business of selling items like this, this is an occasional sale, and I'll keep it until I hand it over to the buyer.";

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * An item's condition as a word chip ("Lightly used"), never stars (Cowork
 * design audit 2026-10-20, D5; HELPR-DESIGN-SPEC: stars are only for people's
 * ratings, and a gold star row next to the seller's star rating read as a
 * second rating). Pill, card white, hairline border, 13px.
 */
export function ConditionChip({ stars }: { stars: number }) {
  const label = CONDITION_LABEL[stars];
  if (!label) return null;
  return (
    <span
      data-condition-chip=""
      className="inline-flex items-center rounded-full border border-border bg-card px-3 py-1 text-ds-13 font-medium text-foreground"
    >
      <span className="sr-only">Condition: </span>
      {label}
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
  const settled = isReady && (!user || featureSwitchSettled(qc, "declutter", user.id));
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
