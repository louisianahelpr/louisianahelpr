/**
 * "What do you want to sell?" (owner 2026-10-30): the paths in and out of Declutter's sell chooser, in one place so
 * every Sell button opens the same page and every choice keeps its own deep link. Pure strings only, so the Create
 * sheet, the section top bar and the Declutter screens can all import it without pulling one another's code.
 *
 * The chooser is a mode of /declutter/sell (same gate, same page); a deep link that already names what to sell
 * (?mode=bunch, ?item=<draft>, ?answer=<wanted>, ?free=1) never shows it.
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

/** Moving out sale (only while 'declutter_moving_out' is on for the viewer). */
export const SELL_MOVE_PATH = "/declutter/move";

/** Looking for something: the Wanted tab with its "Post what you're looking for" form open. */
export const WANTED_POST_PARAM = "post";
export const WANTED_POST_PATH = `/declutter?tab=wanted&${WANTED_POST_PARAM}=1`;

/** True when the URL asks for the chooser. */
export function wantsSellChooser(params: URLSearchParams): boolean {
  return params.get("mode") === "choose";
}

/** True when a NEW listing should start as Free (Give it away free). */
export function startsFree(params: URLSearchParams): boolean {
  return params.get(SELL_FREE_PARAM) === "1";
}
