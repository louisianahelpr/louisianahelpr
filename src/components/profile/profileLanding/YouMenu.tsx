import { Bell, Headphones, LogOut, Settings, Wallet } from "lucide-react";
import type { ReactNode } from "react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useHomeMoney } from "@/pages/home/homeDashboard/homeMoney";
import { formatCents } from "@/components/profile/earningsTab/earningsTabHelpers";

/**
 * BOARD 18's list: Money · Alerts · Settings · Talk to a real person, one card,
 * then Log out (the clear pill) and Delete account (quiet text) under it
 * (owner, 2026-10-19: "Log Out clear and Delete Account quiet").
 *
 * The Money caption is the same "Coming to you" / "Held for you" the Home
 * money tiles show (useHomeMoney: the Money tab's own reads), in rust because
 * it is money; with nothing real it says nothing (spec v2 §1.5).
 */
export const YOU_ROWS = [
  { key: "earnings", label: "Money" },
  { key: "notifications", label: "Alerts" },
  { key: "settings", label: "Settings" },
  { key: "support", label: "Talk to a real person" },
] as const;

type RowKey = (typeof YOU_ROWS)[number]["key"];

const ICON: Record<RowKey, ReactNode> = {
  earnings: <Wallet className="w-5 h-5" aria-hidden />,
  notifications: <Bell className="w-5 h-5" aria-hidden />,
  settings: <Settings className="w-5 h-5" aria-hidden />,
  support: <Headphones className="w-5 h-5" aria-hidden />,
};

/** The captions known before any data (the skeleton draws these too). Money's is data, so it is not here. */
export const YOU_STATIC_CAPTIONS: Partial<Record<RowKey, string>> = {
  notifications: "Notifications",
  settings: "Account, look, sections",
  support: "Help",
};

export function youMoneyCaption(money: ReturnType<typeof useHomeMoney>): string | null {
  if (money.coming) return `${formatCents(money.coming.cents)} coming`;
  if (money.held) return `${formatCents(money.held.cents)} held`;
  return null;
}

/**
 * The four rows themselves. With no `onSelect` they are drawn inert (disabled,
 * out of the tab order): that is the landing skeleton's first frame
 * (ProfilePageSkeleton), so the loading frame and the page share one markup.
 */
export function YouMenuList({ captions, onSelect }: { captions?: Partial<Record<RowKey, string | null>>; onSelect?: (key: string) => void }) {
  return (
    <nav aria-label="You" className="liquid-glass overflow-hidden" data-testid="you-menu">
      {YOU_ROWS.map((row, i) => {
        const cap = captions?.[row.key];
        return (
          <button
            key={row.key}
            type="button"
            data-you-row={row.key}
            onClick={onSelect ? () => onSelect(row.key) : undefined}
            disabled={!onSelect}
            tabIndex={onSelect ? undefined : -1}
            className="glass-press relative w-full min-h-[56px] flex items-center gap-3.5 px-4 py-3 text-left hover:bg-secondary/40 active:bg-secondary/60 transition-colors disabled:opacity-100"
          >
            {i > 0 && <span aria-hidden className="hairline pointer-events-none absolute top-0 left-4 right-4" />}
            <span className="shrink-0" style={{ color: "hsl(var(--bark))" }}>{ICON[row.key]}</span>
            <span className="flex-1 min-w-0 text-ds-15 font-semibold text-foreground truncate" title={row.label}>{row.label}</span>
            {cap && (
              <span
                data-you-caption={row.key}
                className={`shrink-0 text-ds-13 ${row.key === "earnings" ? "font-bold tabular-nums" : "text-muted-foreground"}`}
                style={row.key === "earnings" ? { color: "hsl(var(--accent-ink))" } : undefined}
              >
                {cap}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}

export function YouMenu({
  onSelectTab,
  onRequestLogout,
  onRequestDelete,
}: {
  onSelectTab: (key: string) => void;
  onRequestLogout: () => void;
  onRequestDelete: () => void;
}) {
  const { user } = useCurrentUser();
  const money = useHomeMoney(user);
  const moneyCaption = youMoneyCaption(money);
  const caption: Record<RowKey, string | null> = { ...YOU_STATIC_CAPTIONS, earnings: moneyCaption };

  return (
    <div className="shrink-0 flex flex-col gap-3">
      <YouMenuList captions={caption} onSelect={onSelectTab} />

      <div className="pt-1 space-y-1">
        <button
          type="button"
          onClick={onRequestLogout}
          className="glass-press w-full rounded-full bg-card min-h-[48px] inline-flex items-center justify-center gap-2 active:scale-[0.99] transition-all font-semibold"
          style={{ color: "hsl(var(--foreground))", border: "1px solid hsl(var(--border))" }}
        >
          <LogOut className="w-4 h-4" aria-hidden /> Log out
        </button>
        {/* Quiet: a small muted text button, never a second pill. Its confirm dialog does the warning. */}
        <button
          type="button"
          onClick={onRequestDelete}
          data-testid="profile-delete-account"
          className="w-full min-h-11 inline-flex items-center justify-center text-ds-13 font-semibold text-muted-foreground transition-colors"
        >
          Delete account
        </button>
      </div>
    </div>
  );
}
