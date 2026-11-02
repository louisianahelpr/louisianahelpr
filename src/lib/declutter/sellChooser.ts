/**
 * "What do you want to sell?" (owner 2026-10-30): the paths in and out of Declutter's sell chooser, in one place so
 * every Sell button opens the same page and every choice keeps its own deep link. Pure strings only, so the Create
 * sheet, the section top bar and the Declutter screens can all import it without pulling one another's code.
 *
 * The chooser is a mode of /declutter/sell (same gate, same page); a deep link that already names what to sell
 * (?mode=bunch, ?mode=moving, ?item=<draft>, ?answer=<wanted>, ?free=1) never shows it.
 */

/** The chooser itself: where every "Sell" button goes. */
export const SELL_CHOOSER_PATH = "/declutter/sell?mode=choose";

/** One item: today's one-screen Sell flow. */
export const SELL_ONE_PATH = "/declutter/sell";

/** A bunch of things: many listings from many photos at once. */
export const SELL_BUNCH_PATH = "/declutter/sell?mode=bunch";

/** Give it away free: the one-screen Sell flow with Free already on (price 0). */
const SELL_FREE_PARAM = "free";
export const SELL_FREE_PATH = `/declutter/sell?${SELL_FREE_PARAM}=1`;

/** Moving out sale: Sell a bunch with a move-out date (only while 'declutter_moving_out' is on for the viewer). */
export const SELL_MOVE_PATH = "/declutter/sell?mode=moving";

/** Looking for something: the Wanted tab with its "Post what you're looking for" form open. */
export const WANTED_POST_PARAM = "post";
export const WANTED_POST_PATH = `/declutter?tab=wanted&${WANTED_POST_PARAM}=1`;

/**
 * A3-99 (audit 7, 11-01): "Can't find it? Post what you're looking for" under a search that found nothing opened an
 * empty form, so the member typed "treadmill" again. The link carries the search words (and a category filter) into
 * the open form: /declutter?tab=wanted&post=1&what=treadmill. The form keeps at most 60 characters, as it allows.
 */
export const WANTED_WHAT_PARAM = "what";
export const WANTED_CATEGORY_PARAM = "category";
export function wantedAskHref(query: string, category: string | null = null): string {
  const p = new URLSearchParams({ tab: "wanted", [WANTED_POST_PARAM]: "1" });
  const what = query.trim().slice(0, 60);
  if (what) p.set(WANTED_WHAT_PARAM, what);
  if (category) p.set(WANTED_CATEGORY_PARAM, category);
  return `/declutter?${p.toString()}`;
}

/** True when the URL asks for the chooser. */
export function wantsSellChooser(params: URLSearchParams): boolean {
  return params.get("mode") === "choose";
}

/** True when the URL asks for Sell a bunch, with or without the moving sale's date. */
export function wantsBunch(params: URLSearchParams): boolean {
  const mode = params.get("mode");
  return mode === "bunch" || mode === "moving";
}

/** True when a NEW listing should start as Free (Give it away free). */
export function startsFree(params: URLSearchParams): boolean {
  return params.get(SELL_FREE_PARAM) === "1";
}
