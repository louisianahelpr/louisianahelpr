import { useInRouterContext, useLocation, useNavigate } from "react-router-dom";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useHomeMoney } from "@/pages/home/homeDashboard/homeMoney";
import { formatCents } from "@/components/profile/earningsTab/earningsTabHelpers";

/** "Coming to you: $96.55 · held for your jobs: $40." from the tiles' own figures; null when both are $0. Pure; tested. */
export function deleteMoneyLine(comingCents: number, heldCents: number): string | null {
  const parts = [
    comingCents > 0 ? `Coming to you: ${formatCents(comingCents)}` : null,
    heldCents > 0 ? `held for your jobs: ${formatCents(heldCents)}` : null,
  ].filter(Boolean) as string[];
  if (parts.length === 0) return null;
  const line = parts.join(" · ");
  return `${line.charAt(0).toUpperCase()}${line.slice(1)}. You can delete once these settle. Nothing is lost.`;
}

/**
 * BOARD 120's money line on "Before you go": what is coming to the member and what of theirs is
 * held, the SAME figures as Home's and Money's tiles (useHomeMoney). Any such money refuses the
 * delete on the server (findActiveWork), so the line says why the delete will wait, and that nothing
 * is lost. Nothing at $0, while loading or on a failed read.
 */
export function DeleteMoneyLine() {
  const { user } = useCurrentUser();
  const money = useHomeMoney(user);
  const line = deleteMoneyLine(money.coming?.cents ?? 0, money.held?.cents ?? 0);
  if (!line) return null;
  return (
    <p data-delete-money-line="" className="rounded-2xl px-4 py-3 text-ds-13 leading-snug" style={{ background: "hsl(var(--accent-ink) / 0.08)", color: "hsl(var(--accent-ink))" }}>
      {line}
    </p>
  );
}

/** Board 120's "Pause instead", only on /profile: opens Settings' pause confirm. */
export function PauseInsteadLink({ onLeave }: { onLeave: () => void }) {
  return useInRouterContext() ? <PauseInsteadRouted onLeave={onLeave} /> : null;
}

function PauseInsteadRouted({ onLeave }: { onLeave: () => void }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  if (!pathname.startsWith("/profile")) return null;
  return (
    <button
      type="button"
      data-pause-instead=""
      className="w-full min-h-11 text-ds-14 font-semibold text-primary"
      onClick={() => { onLeave(); navigate("/profile?tab=settings&pause=1"); }}
    >
      Pause instead
    </button>
  );
}
