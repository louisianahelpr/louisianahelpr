/**
 * Declutter: shared words and small pieces for the three screens
 * (docs/specs/declutter-auctions.md). Plain words only: no "draft",
 * "pending_review" or other codes reach the member.
 */
import { Checkbox } from "@/components/ui/checkbox";
import { useFeature } from "@/hooks/useFeature";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuthReady } from "@/hooks/useAuthReady";
import { definitelyGuest } from "@/lib/persistedAuthToken";
import { featureSwitchSettled } from "@/lib/featureSwitchQuery";
import NotFound from "@/pages/info/NotFound";
import { DeclutterGuestGate } from "./DeclutterGuest";
import { fetchHasAgreedSales, type DeclutterStatus, type DeliverySize } from "@/lib/declutter/api";
import type { ReactNode } from "react";
import { CONDITION_LABEL } from "@/lib/declutter/conditionLabels";
import { useLanguage } from "@/lib/i18n/language";
import type { MsgKey } from "@/lib/i18n/en";
import "@/lib/i18n/enDeclutter";

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
  // LEAD-LIST-FOR-SELLER: written by the seller's Helpr, waiting for the seller's OK.
  pending_seller_approval: "Waiting for your approval",
};

/**
 * A seller's own listing's status word. A FREE item is claimed, never sold (deep audit SE-4, 2026-10-28: a claimed
 * free item read "Sold" before anyone had picked it up): declutter_claim_free reserves it, declutter_checkout_free
 * moves it to 'sold' with nothing paid, and only the handover makes it 'completed'.
 */
export function sellerStatusLabel(item: { status: DeclutterStatus; current_price_cents: number }, tradedFor?: string | null): string {
  // Lead 11-08: a listing that went in a trade says what it was traded for, never "Someone is buying it".
  if (tradedFor && (item.status === "reserved" || item.status === "sold" || item.status === "completed")) return `Traded for ${tradedFor}`;
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

// The one condition-name map (src/lib/declutter/conditionLabels.ts), re-exported likewise; read here below too.
export { CONDITION_LABEL };

/** The four sales-tax confirmations (row 54), asked before every listing. */
export const TAX_STATEMENTS = [
  "I bought this item for my own personal or household use.",
  "I'm not in the business of selling items like this.",
  "I don't sell things often. This is an occasional sale.",
  "I'll keep the item until I hand it over to the buyer.",
] as const;

/**
 * The ONE checkbox under the four statements, on every sell form (owner 2026-10-28: "make these checks 1"; 2026-10-30:
 * "only need to be 1 check box"). One tick records all four attestations (attestItem sends each as true;
 * declutter_attest_item stores each column), so the R.S. 47:305(A) occasional-sale record is unchanged. On a bunch or
 * a move, one tick covers every item in the run.
 */
export const TAX_TICK_LABEL = "All of this is true for what I'm listing";
/** The same promises for a give-away, where nothing is sold (lead's wording, audit single-free #14), one per line (audit 1110 F340). */
const TAX_FREE_STATEMENTS = [
  "I own this.",
  "It's from my own household.",
  "I don't do this as a business.",
  "I'll keep it until it's picked up.",
] as const;
const TAX_FREE_TICK_LABEL = "All of this is true";

/** The four statements as one short list, and the one checkbox that confirms them. Shared by every sell form. */
export function TaxStatementsCheck({ id, checked, onChange, free = false }: { id: string; checked: boolean; onChange: (on: boolean) => void; free?: boolean }) {
  const box = <Checkbox id={id} className="mt-0.5" checked={checked} onCheckedChange={(v) => onChange(v === true)} />;
  // Nothing is sold in a giveaway, so it says so (lead's wording, audit single-free #14), as bullets like the paid form
  // rather than one long line (audit 1110 F340). The server keeps the same record.
  if (free) {
    return (
      <div className="space-y-2" data-tax-statements="free">
        <ul className="list-disc space-y-1 pl-5 text-ds-13 text-foreground">
          {TAX_FREE_STATEMENTS.map((s) => <li key={s}>{s}</li>)}
        </ul>
        <div className="flex items-start gap-3 text-ds-14 font-semibold">
          {box}
          <label htmlFor={id} className="min-h-11 flex-1">{TAX_FREE_TICK_LABEL}</label>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-2" data-tax-statements="">
      <ul className="list-disc space-y-1 pl-5 text-ds-13 text-foreground">
        {TAX_STATEMENTS.map((s) => <li key={s}>{s}</li>)}
      </ul>
      <div className="flex items-start gap-3 text-ds-14 font-semibold">
        {box}
        <label htmlFor={id} className="min-h-11 flex-1">{TAX_TICK_LABEL}</label>
      </div>
    </div>
  );
}

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * An item's condition as a word chip ("Lightly used"), never stars (Cowork
 * design audit 2026-10-20, D5; HELPR-DESIGN-SPEC: stars are only for people's
 * ratings, and a gold star row next to the seller's star rating read as a
 * second rating). Pill, card white, hairline border, 13px.
 */
export function ConditionChip({ stars }: { stars: number }) {
  const { t } = useLanguage();
  // F260q (owner 11-11): the condition in the reader's language.
  const label = CONDITION_LABEL[stars] ? t(`decl.cond.${stars}` as MsgKey) : null;
  if (!label) return null;
  return (
    <span
      data-condition-chip=""
      className="inline-flex items-center rounded-full border border-border bg-card px-3 py-1 text-ds-13 font-medium text-foreground"
    >
      <span className="sr-only">{t("decl.item.conditionSr")}</span>
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
  // Q2705: a provable guest (no stored session, readable storage) does not wait for auth to settle (the Supabase chunk
  // and its session read, ~2.3 s on Slow 4G): the guest gate starts at once, on the entry's own answer.
  if (!isReady && !definitelyGuest()) return <>{skeleton}</>;
  // BUY-16: a guest reads Declutter while it is open to everyone; otherwise the login wall, as before.
  if (!user) return <DeclutterGuestGate skeleton={skeleton}>{children}</DeclutterGuestGate>;
  if (!settled) return <>{skeleton}</>;
  if (agreedSales && user) {
    if (agreed.isLoading) return <>{skeleton}</>;
    if (agreed.data === true) return <>{agreedSales}</>;
  }
  return <NotFound />;
}
