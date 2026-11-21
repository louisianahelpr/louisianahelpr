/**
 * Declutter selling boost (owner 11-20): Browse's "New this week" row, the newest listings put up for sale in the last
 * 7 days.
 *
 * It reads the list Browse already loaded, so it costs no extra request. That list already leaves test (is_seed)
 * listings out for real accounts: the declutter_items read policy asks seed_hidden_in_discovery() (20261020033623),
 * and testers/admins see them as they do in the grid. A row that still says is_seed (a tester's view) is dropped here
 * as well, so the row only ever features real listings. The viewer's own listings are left out (it is for finding
 * things to buy), and so is a reserved item (someone is already buying it).
 *
 * Empty when nothing qualifies, and also when the row would only repeat the whole list (two listings, both new: the
 * grid right under it already shows them). Browse hides the row whenever this is empty.
 */
const NEW_THIS_WEEK_DAYS = 7;
export const NEW_THIS_WEEK_MAX = 10;

export interface NewThisWeekCandidate {
  id: string;
  seller_id: string;
  status: string;
  live_at: string | null;
  created_at: string;
  is_seed?: boolean | null;
}

export function newThisWeek<T extends NewThisWeekCandidate>(items: readonly T[], viewerId: string | null, now: number): T[] {
  const since = now - NEW_THIS_WEEK_DAYS * 24 * 60 * 60 * 1000;
  const when = (i: T) => Date.parse(i.live_at ?? i.created_at);
  const fresh = items
    .filter((i) => i.status === "live" && i.is_seed !== true && i.seller_id !== viewerId)
    .filter((i) => {
      const t = when(i);
      return Number.isFinite(t) && t >= since && t <= now + 60_000;
    })
    .sort((a, b) => when(b) - when(a))
    .slice(0, NEW_THIS_WEEK_MAX);
  const others = items.filter((i) => i.seller_id !== viewerId).length;
  return fresh.length >= others ? [] : fresh;
}
