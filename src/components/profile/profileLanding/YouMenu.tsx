import { Bell, Headphones, LogOut, Settings, ShieldAlert, Wallet } from "lucide-react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useHomeMoney } from "@/pages/home/homeDashboard/homeMoney";
import { formatCents } from "@/components/profile/earningsTab/earningsTabHelpers";

/**
 * BOARD 18's list: Money · Alerts · Settings · Talk to a real person, one card
 * (with Admin above Talk to a real person for a confirmed admin, ADMIN_ROW),
 * then Log out (the clear pill) and Delete account (quiet text) under it
 * (owner, 2026-10-19: "Log Out clear and Delete Account quiet").
 *
 * The Money caption is the same "Coming to you" / "Held for you" the Home
 * money tiles show (useHomeMoney: the Money tab's own reads), in rust because
 * it is money; with nothing real it says nothing (spec v2 §1.5).
 */
export const YOU_ROWS = [
  { key: "earnings", label: "Money" },
  { key: "notifications", label: "Notifications" },
  { key: "settings", label: "Settings" },
  { key: "support", label: "Talk to a real person" },
] as const;

/**
 * ADMINS ONLY: the way into /admin from the phone (owner, 2026-10-21: "I can't
 * find the admin panel"). It sits directly above "Talk to a real person" and is
 * drawn only for a CONFIRMED admin: useCurrentUser's `isAdmin`, the same signal
 * the desktop rail's Admin group reads, which is false while the role is
 * loading and when the role read failed, so it never flashes for anyone else.
 * The skeleton draws no admin row (it cannot know the role yet). Hiding it is
 * not the protection: /admin sits behind AdminRoute and the server's admin checks.
 */
export const ADMIN_ROW = { key: "admin", label: "Admin" } as const;

type RowKey = (typeof YOU_ROWS)[number]["key"] | typeof ADMIN_ROW.key;

/** The rows to draw: YOU_ROWS, plus Admin above "Talk to a real person" for a confirmed admin. */
function youRows(showAdmin: boolean): ReadonlyArray<{ key: RowKey; label: string }> {
  if (!showAdmin) return YOU_ROWS;
  const at = YOU_ROWS.findIndex((r) => r.key === "support");
  return [...YOU_ROWS.slice(0, at), ADMIN_ROW, ...YOU_ROWS.slice(at)];
}

const ICON: Record<RowKey, ReactNode> = {
  earnings: <Wallet className="w-5 h-5" aria-hidden />,
  notifications: <Bell className="w-5 h-5" aria-hidden />,
  settings: <Settings className="w-5 h-5" aria-hidden />,
  support: <Headphones className="w-5 h-5" aria-hidden />,
  admin: <ShieldAlert className="w-5 h-5" aria-hidden />,
};

/** The captions known before any data (the skeleton draws these too). Money's is data, so it is not here. */
export const YOU_STATIC_CAPTIONS: Partial<Record<RowKey, string>> = {
  // Short enough to sit whole beside "Notifications" at 375 (it was cut, audit 2026-10-29 A3-L4).
  notifications: "Alerts and email",
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
export function YouMenuList({
  captions,
  onSelect,
  showAdmin = false,
}: {
  captions?: Partial<Record<RowKey, string | null>>;
  onSelect?: (key: string) => void;
  showAdmin?: boolean;
}) {
  return (
    <section aria-label="You" className="liquid-glass overflow-hidden" data-testid="you-menu">
      {youRows(showAdmin).map((row, i) => {
        const cap = captions?.[row.key];
        return (
          <button
            key={row.key}
            type="button"
            data-you-row={row.key}
            onClick={onSelect ? () => onSelect(row.key) : undefined}
            disabled={!onSelect}
            tabIndex={onSelect ? undefined : -1}
            className="glass-press relative w-full min-h-[56px] flex items-center gap-3.5 px-4 py-3 text-left ctl-tint transition-colors disabled:opacity-100"
          >
            {i > 0 && <span aria-hidden className="hairline pointer-events-none absolute top-0 left-4 right-4" />}
            <span className="shrink-0" style={{ color: "hsl(var(--bark))" }}>{ICON[row.key]}</span>
            {/* Q2306: the label never gives way (shrink-0, never truncated); the caption takes what is left and
                truncates. At 375 the old flex-1 label + shrink-0 caption cut "Notifications" to "Notificat…". */}
            <span data-you-label={row.key} className="shrink-0 whitespace-nowrap text-ds-15 font-semibold text-foreground" title={row.label}>{row.label}</span>
            {cap && (
              <span
                data-you-caption={row.key}
                title={cap}
                className={`flex-1 min-w-0 truncate text-right text-ds-13 ${row.key === "earnings" ? "font-bold tabular-nums" : "text-muted-foreground"}`}
                style={row.key === "earnings" ? { color: "hsl(var(--accent-ink))" } : undefined}
              >
                {cap}
              </span>
            )}
          </button>
        );
      })}
    </section>
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
  const { user, isAdmin } = useCurrentUser();
  const navigate = useNavigate();
  const money = useHomeMoney(user);
  const moneyCaption = youMoneyCaption(money);
  const caption: Partial<Record<RowKey, string | null>> = { ...YOU_STATIC_CAPTIONS, earnings: moneyCaption };

  return (
    <div className="shrink-0 flex flex-col gap-3">
      <YouMenuList
        captions={caption}
        showAdmin={isAdmin}
        onSelect={(key) => (key === ADMIN_ROW.key ? navigate("/admin") : onSelectTab(key))}
      />

      <div className="pt-1 space-y-1">
        <Button
          type="button"
          variant="ghost"
          size="md"
          onClick={onRequestLogout}
          className="glass-press w-full bg-card px-0 active:scale-[0.99] transition-all font-semibold tracking-normal [&_svg]:size-4"
          style={{ color: "hsl(var(--foreground))", border: "1px solid hsl(var(--border))" }}
        >
          <LogOut className="w-4 h-4" aria-hidden /> Log out
        </Button>
        {/* Quiet: a small muted text button, never a second pill. Its confirm dialog does the warning. */}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onRequestDelete}
          data-testid="profile-delete-account"
          className="w-full px-0 text-ds-13 font-semibold tracking-normal text-muted-foreground"
        >
          Delete account
        </Button>
      </div>
    </div>
  );
}
