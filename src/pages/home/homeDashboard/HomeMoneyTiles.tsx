import { useNavigate } from "react-router-dom";
import { formatCents } from "@/components/profile/earningsTab/earningsTabHelpers";
import { STANDARD_PAYOUT_DAYS_AFTER_APPROVAL } from "../../../../supabase/functions/_shared/escrowTiming";
import { getLang, t, useLanguage } from "@/lib/i18n/language";
import "@/lib/i18n/enMoneyTiles";
import type { HomeMoney } from "./homeMoney";
import { usePayoutSetupPaused } from "@/hooks/usePayoutSetupPaused";
import { GlassTileButton } from "@/components/ui/GlassTileButton";
import { MoneyTilesLoading } from "./MoneyTilesLoading";

/** "Fri, Oct 23": the day the approved money reaches the member's wallet. */
const walletDay = (iso: string) => new Date(iso).toLocaleDateString(getLang() === "es" ? "es-US" : "en-US", { weekday: "short", month: "short", day: "numeric" });

/**
 * Board 51/7 caption under "Coming to you", always TRUE (lh-money-escrow review, 2026-10-20):
 *  - no payout account: the money cannot move until there is one, so say that;
 *  - a row past its date (no account, a payout hold): never a past date, just that it is not sent yet;
 *  - else the REAL soonest date ("First" when the rows arrive on several days);
 *  - no date on any row: the rule, never a made-up date.
 */
function comingCaption(c: NonNullable<HomeMoney["coming"]>, setupPaused: boolean): string {
  // Payout setup switched off (owner 2026-10-23); no "add your account" ask and
  // no "paused" notice (owner 2026-10-25: "its not paused"). The pay is kept.
  if (!c.hasPayoutAccount && setupPaused) return t("mt.kept");
  if (!c.hasPayoutAccount) return t("mt.addPayout");
  if (c.overdue) return t("mt.notSent");
  if (c.at) return t(c.severalDates ? "mt.firstReaches" : "mt.reaches", { day: walletDay(c.at) });
  // escrowTiming's STANDARD_PAYOUT_PHRASE, in the dictionary with the same day count.
  return t("mt.sentAfter", { days: STANDARD_PAYOUT_DAYS_AFTER_APPROVAL });
}

/**
 * The held tile's words (owner, 2026-10-21, truth): this is the POSTER'S own payment held for the Helpr,
 * not money held FOR the poster, so it never says "Held for you". One job: "Held for Mow two lawns" /
 * "Paid to Yusef H. after you confirm it's done"; several: "Held for 2 jobs" / "Paid to each Helpr after
 * you confirm their job is done". Only a Helpr's own pending earnings ("Coming to you") are theirs.
 */
function heldWords(h: NonNullable<HomeMoney["held"]>): { label: string; caption: string } {
  if (h.only) {
    return { label: t("mt.heldFor", { title: h.only.title }), caption: t("mt.paidToAfter", { name: h.only.helper ?? t("mt.yourHelpr") }) };
  }
  return {
    label: h.jobs === 1 ? t("mt.heldForOneJob") : t("mt.heldForJobs", { n: h.jobs }),
    caption: h.jobs === 1 ? t("mt.paidToAfter", { name: t("mt.yourHelpr") }) : t("mt.paidEach"),
  };
}

/**
 * HOME'S MONEY STRIP (spec v2 §5.3; board 7 on phone, board 11 on desktop):
 * "Coming to you" and the poster's held payment ("Held for <job>"), side by side, amounts in rust (money is
 * the one thing rust means). A tile with nothing real is not drawn; with both
 * gone the strip is gone. Each opens You › Money on the half it is about.
 */
export function HomeMoneyTiles({
  money,
  placement,
  onOpen,
}: {
  money: HomeMoney;
  /** "main"/"side": Home's phone flow and desktop column. "money": the head of You › Money (board 51), every width. */
  placement: "main" | "side" | "money";
  /** You › Money opens its own halves instead of navigating to itself. */
  onOpen?: (kind: "coming" | "held") => void;
}) {
  const navigate = useNavigate();
  useLanguage();
  const setupPaused = usePayoutSetupPaused();
  // Q2706 (lead 11-05, owner may override): You > Money's tile row never appears or collapses. Live lab (prod,
  // helper, 375, Fast 4G + 4x): the tiles landing at the top after their reads (~2.2 s) pushed the page down,
  // CLS 0.385 of 0.41-0.51. On that page the row holds a tile's shape while the reads are out, and a member with
  // nothing coming or held sees "Coming to you $0.00". Home's strip is unchanged (hidden at $0; its own hold, B98).
  // src/pages/home/homeDashboard/moneyTabTileRowNeverMoves.test.tsx.
  // F266a (owner 11-11): on You > Money the Helpr's tile is ONE stack: "On its way" (the approved pay, comingToYou),
  // then "Waiting for approval" and "Held in a dispute" (earningsTabHelpers.moneyStack), each row only when it holds
  // money. Home's strip keeps "Coming to you" alone.
  const stack = placement === "money" && money.stack && (money.stack.waitingCents > 0 || money.stack.disputeCents > 0) ? money.stack : null;
  const comingLabel = placement === "money" ? t("mt.onItsWay") : t("mt.comingToYou");
  if (placement === "money" && money.pending && !money.coming && !money.held) return <MoneyTilesLoading />;
  if (placement === "money" && !money.failed && !money.coming && !money.held && !stack) {
    return (
      <div data-home-money="money" className="grid grid-cols-2 gap-3">
        <MoneyTile kind="coming" span="col-span-2" label={comingLabel} cents={0} caption={t("mt.nothingYet")}
          onClick={() => (onOpen ? onOpen("coming") : navigate("/profile?tab=earnings"))} />
      </div>
    );
  }
  if (!money.coming && !money.held && !stack) return null;
  // A lone tile takes the row everywhere (half a row of empty ground reads as a missing tile). F082 (owner UI audit
  // 11-09): the desktop column used to keep it at half width, a small card alone with a gap beside it.
  const showComing = !!money.coming || !!stack;
  const span = showComing && money.held ? "" : "col-span-2";
  const where = placement === "main" ? "xl:hidden" : placement === "side" ? "hidden xl:grid xl:mb-2" : "";
  return (
    <div
      data-home-money={placement}
      className={`grid grid-cols-2 gap-3 ${where}`}
    >
      {showComing && (
        <MoneyTile
          kind="coming"
          span={span}
          label={comingLabel}
          cents={money.coming?.cents ?? 0}
          caption={money.coming ? comingCaption(money.coming, setupPaused) : t("mt.nothingYet")}
          stack={stack}
          // No payout account: open the screen that sets one up (the cron's own notification links there),
          // or, while setup is paused, You › Money (the pay is kept there).
          onClick={() => (onOpen ? onOpen("coming") : navigate(!money.coming || money.coming.hasPayoutAccount || setupPaused ? "/profile?tab=earnings" : "/profile?tab=payment"))}
        />
      )}
      {money.held && (
        <MoneyTile
          kind="held"
          span={span}
          label={heldWords(money.held).label}
          cents={money.held.cents}
          caption={heldWords(money.held).caption}
          onClick={() => (onOpen ? onOpen("held") : navigate("/profile?tab=earnings&view=spent"))}
        />
      )}
    </div>
  );
}

function MoneyTile({ kind, span, label, cents, caption, stack, onClick }: {
  kind: string; span: string; label: string; cents: number; caption: string;
  /** F266a: the rest of the Helpr's stack on You > Money; a row only when it holds money. */
  stack?: { waitingCents: number; disputeCents: number } | null;
  onClick: () => void;
}) {
  const amount = formatCents(cents);
  return (
    <GlassTileButton
      data-money-tile={kind}
      // No aria-label: the tile's own text (label, amount, caption) is its name, so a screen reader and a
      // voice user say the same words (axe label-content-name-mismatch, WCAG 2.5.3; ui-sweep #3491).
      onClick={onClick}
      className={`p-card lg:p-4 gap-0.5 ${span}`}
    >
      <span className="text-ds-13 text-muted-foreground">{label}</span>
      <span data-money-amount className="text-ds-24 font-bold tabular-nums leading-tight" style={{ color: "hsl(var(--accent-ink))" }}>{amount}</span>
      <span className="text-ds-13 text-muted-foreground leading-snug">{caption}</span>
      {stack && stack.waitingCents > 0 && (
        <span data-money-stack="waiting" className="mt-2 flex justify-between gap-2 text-ds-13">
          <span className="text-muted-foreground">{t("mt.waiting")}</span>
          <span className="font-semibold tabular-nums">{formatCents(stack.waitingCents)}</span>
        </span>
      )}
      {stack && stack.disputeCents > 0 && (
        <span data-money-stack="dispute" className={`${stack.waitingCents > 0 ? "mt-1" : "mt-2"} flex justify-between gap-2 text-ds-13`}>
          <span className="text-muted-foreground">{t("mt.dispute")}</span>
          <span className="font-semibold tabular-nums">{formatCents(stack.disputeCents)}</span>
        </span>
      )}
    </GlassTileButton>
  );
}
