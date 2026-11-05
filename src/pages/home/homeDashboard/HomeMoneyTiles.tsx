import { useNavigate } from "react-router-dom";
import { formatCents } from "@/components/profile/earningsTab/earningsTabHelpers";
import { STANDARD_PAYOUT_PHRASE } from "../../../../supabase/functions/_shared/escrowTiming";
import type { HomeMoney } from "./homeMoney";
import { usePayoutSetupPaused } from "@/hooks/usePayoutSetupPaused";

/** "Fri, Oct 23": the day the approved money reaches the member's wallet. */
const walletDay = (iso: string) => new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

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
  if (!c.hasPayoutAccount && setupPaused) return "Kept for you";
  if (!c.hasPayoutAccount) return "Add your payout account to get it";
  if (c.overdue) return "Approved, not sent yet";
  if (c.at) return `${c.severalDates ? "First reaches" : "Reaches"} your wallet ${walletDay(c.at)}`;
  return `Sent ${STANDARD_PAYOUT_PHRASE}`;
}

/**
 * The held tile's words (owner, 2026-10-21, truth): this is the POSTER'S own payment held for the Helpr,
 * not money held FOR the poster, so it never says "Held for you". One job: "Held for Mow two lawns" /
 * "Paid to Yusef H. after you confirm it's done"; several: "Held for 2 jobs" / "Paid to each Helpr after
 * you confirm their job is done". Only a Helpr's own pending earnings ("Coming to you") are theirs.
 */
function heldWords(h: NonNullable<HomeMoney["held"]>): { label: string; caption: string } {
  if (h.only) {
    return { label: `Held for ${h.only.title}`, caption: `Paid to ${h.only.helper ?? "your Helpr"} after you confirm it's done` };
  }
  return { label: `Held for ${h.jobs} job${h.jobs === 1 ? "" : "s"}`, caption: h.jobs === 1 ? "Paid to your Helpr after you confirm it's done" : "Paid to each Helpr after you confirm their job is done" };
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
  const setupPaused = usePayoutSetupPaused();
  // Q2706 (lead 11-05, owner may override): You > Money's tile row never appears or collapses. Live lab (prod,
  // helper, 375, Fast 4G + 4x): the tiles landing at the top after their reads (~2.2 s) pushed the page down,
  // CLS 0.385 of 0.41-0.51. On that page the row holds a tile's shape while the reads are out, and a member with
  // nothing coming or held sees "Coming to you $0.00". Home's strip is unchanged (hidden at $0; its own hold, B98).
  // src/pages/home/homeDashboard/moneyTabTileRowNeverMoves.test.tsx.
  if (placement === "money" && money.pending && !money.coming && !money.held) {
    return (
      <div data-home-money="money" data-money-loading="" aria-hidden="true" className="grid grid-cols-2 gap-3">
        <div className="liquid-glass p-card lg:p-4 flex flex-col gap-0.5 col-span-2 animate-pulse">
          <span className="text-ds-13 invisible">&nbsp;</span>
          <span className="text-ds-24 font-bold leading-tight invisible">&nbsp;</span>
          <span className="text-ds-13 leading-snug invisible">&nbsp;</span>
        </div>
      </div>
    );
  }
  if (placement === "money" && !money.failed && !money.coming && !money.held) {
    return (
      <div data-home-money="money" className="grid grid-cols-2 gap-3">
        <MoneyTile kind="coming" span="col-span-2" label="Coming to you" cents={0} caption="Nothing on its way yet"
          onClick={() => (onOpen ? onOpen("coming") : navigate("/profile?tab=earnings"))} />
      </div>
    );
  }
  if (!money.coming && !money.held) return null;
  // A lone tile on the phone takes the row (half a row of empty ground reads as a missing tile);
  // in the desktop column it keeps its half so it lines up with the section tiles under it.
  const span = money.coming && money.held ? "" : placement === "side" ? "" : "col-span-2";
  const where = placement === "main" ? "xl:hidden" : placement === "side" ? "hidden xl:grid xl:mb-2" : "";
  return (
    <div
      data-home-money={placement}
      className={`grid grid-cols-2 gap-3 ${where}`}
    >
      {money.coming && (
        <MoneyTile
          kind="coming"
          span={span}
          label="Coming to you"
          cents={money.coming.cents}
          caption={comingCaption(money.coming, setupPaused)}
          // No payout account: open the screen that sets one up (the cron's own notification links there),
          // or, while setup is paused, You › Money (the pay is kept there).
          onClick={() => (onOpen ? onOpen("coming") : navigate(money.coming!.hasPayoutAccount || setupPaused ? "/profile?tab=earnings" : "/profile?tab=payment"))}
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

function MoneyTile({ kind, span, label, cents, caption, onClick }: { kind: string; span: string; label: string; cents: number; caption: string; onClick: () => void }) {
  const amount = formatCents(cents);
  return (
    <button
      type="button"
      data-money-tile={kind}
      aria-label={`${label}: ${amount}. ${caption}`}
      onClick={onClick}
      className={`btn-press liquid-glass text-left p-card lg:p-4 flex flex-col gap-0.5 min-w-0 ${span}`}
    >
      <span className="text-ds-13 text-muted-foreground">{label}</span>
      <span data-money-amount className="text-ds-24 font-bold tabular-nums leading-tight" style={{ color: "hsl(var(--accent-ink))" }}>{amount}</span>
      <span className="text-ds-13 text-muted-foreground leading-snug">{caption}</span>
    </button>
  );
}
