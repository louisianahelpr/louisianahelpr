/**
 * The gift guides' fun features on the server (migration 20261120062334). The Supabase client loads only when a
 * feature calls it (loadModule), never on page load.
 *   secret_santa_create(names, gives_to, avoid, budget, day) -> {code, tokens}   anyone (no account)
 *   secret_santa_reveal(code, token) -> one person's match, or null               anyone with that link
 *   secret_santa_set_wish_list(code, token, list) -> boolean                      anyone with that link
 *   gift_planner_plans (table, own row by RLS)                                     signed in
 */
import { loadModule } from "@/lib/loadModule";
import { SANTA_CODE, SANTA_TOKEN, cleanPlan, type GiftPlan } from "@/content/giftGuideFun1120";

type Err = { code?: string; message?: string } | null;
type Rpc = (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: Err }>;
interface PlanTable {
  select: (cols: string) => { eq: (c: string, v: string) => { maybeSingle: () => PromiseLike<{ data: unknown; error: Err }> } };
  upsert: (row: Record<string, unknown>, opts: { onConflict: string }) => { select: (cols: string) => PromiseLike<{ data: unknown; error: Err }> };
}
interface Client { rpc: Rpc; from: (t: "gift_planner_plans") => PlanTable }

/**
 * Each code the Secret Santa functions raise, in plain words (src/test/rpcErrorCopyCoverage.test.ts, both ways). The
 * drawer checks names, pairs, budget and day before sending, so most of these show only if a request was made by hand.
 */
export const SANTA_RPC_ERROR_COPY = {
  secret_santa_create: {
    rate_limited: "That's a lot of draws in a row. Try again in a little while.",
    bad_group_size: "Add 3 to 30 names.",
    bad_name: "Just a first name, please (no links or phone numbers).",
    duplicate_name: "Two names are the same. Add a last initial to tell them apart.",
    bad_draw: "The names didn't draw right. Tap Draw names again.",
    bad_avoid: "One of the can't-draw pairs isn't right. Check the pairs and try again.",
    draw_breaks_avoid: "The draw matched a can't-draw pair. Tap Draw names again.",
    bad_budget: "Pick a whole-dollar budget from $1 to $500.",
    bad_date: "Pick an exchange day from today to about 3 months out.",
    no_code: "We couldn't save the draw. Try again.",
  },
  secret_santa_set_wish_list: {
    bad_wish_list: "That wish list link isn't right. Share your list again.",
  },
} satisfies Record<string, Record<string, string>>;

/** Words for an error a Secret Santa call returned, or null when it is not one of its codes (whole-token match). */
function rpcErrorMessage(rpc: keyof typeof SANTA_RPC_ERROR_COPY, error: Err): string | null {
  const raw = error?.message ?? "";
  const table: Record<string, string> = SANTA_RPC_ERROR_COPY[rpc];
  for (const code of Object.keys(table)) {
    if (new RegExp(`(^|[^a-z0-9_])${code}($|[^a-z0-9_])`).test(raw)) return table[code];
  }
  return null;
}

const client = async (): Promise<Client | null> => {
  const m = await loadModule(() => import("@/integrations/supabase/client"));
  return m ? (m.supabase as unknown as Client) : null;
};

/** Why a draw was not saved: too many draws from here just now, or anything else. */
export class SantaSaveError extends Error {
  constructor(public readonly kind: "rateLimited" | "failed", message: string, public readonly words: string | null = null) {
    super(message);
  }
}

/** Store a checked draw; the organizer gets the group code and one token per person (in the names' order). */
export async function createSecretSanta(input: { names: string[]; givesTo: number[]; avoid: [number, number][]; budget?: number; day?: string }): Promise<{ code: string; tokens: string[] }> {
  const sb = await client();
  if (!sb) throw new SantaSaveError("failed", "client not loaded");
  const { data, error } = await sb.rpc("secret_santa_create", {
    p_names: input.names,
    p_gives_to: input.givesTo,
    p_avoid: input.avoid.flat(),
    p_budget: input.budget ?? null,
    p_exchange_on: input.day ?? null,
  });
  if (error) throw new SantaSaveError(/rate_limited/.test(error.message ?? "") ? "rateLimited" : "failed", error.message ?? "save failed", rpcErrorMessage("secret_santa_create", error));
  const d = data as { code?: unknown; tokens?: unknown } | null;
  const tokens = Array.isArray(d?.tokens) ? d.tokens.filter((t): t is string => typeof t === "string" && SANTA_TOKEN.test(t)) : [];
  if (typeof d?.code !== "string" || !SANTA_CODE.test(d.code) || tokens.length !== input.names.length) throw new SantaSaveError("failed", "bad answer");
  return { code: d.code, tokens };
}

export interface SantaReveal { name: string; match: string; budget: number | null; exchangeOn: string | null; size: number; matchWishList: string | null; myWishList: string | null }

/** A wish list share code (gift_wish_lists.code, 12 lowercase letters or digits). */
const LIST = /^[a-z0-9]{12}$/;
/** One person's match (null when the link is wrong or the group expired). Throws when the server could not be asked. */
export async function revealSecretSanta(code: string, token: string): Promise<SantaReveal | null> {
  if (!SANTA_CODE.test(code) || !SANTA_TOKEN.test(token)) return null;
  const sb = await client();
  if (!sb) throw new Error("secret santa: client not loaded");
  const { data, error } = await sb.rpc("secret_santa_reveal", { p_code: code, p_token: token });
  if (error) throw new Error(`secret santa: ${error.message ?? "read failed"}`);
  const d = data as Record<string, unknown> | null;
  if (!d || typeof d.name !== "string" || typeof d.match !== "string") return null;
  return {
    name: d.name,
    match: d.match,
    budget: typeof d.budget === "number" ? d.budget : null,
    exchangeOn: typeof d.exchange_on === "string" ? d.exchange_on : null,
    size: typeof d.size === "number" ? d.size : 0,
    matchWishList: typeof d.match_wish_list === "string" && LIST.test(d.match_wish_list) ? d.match_wish_list : null,
    myWishList: typeof d.my_wish_list === "string" && LIST.test(d.my_wish_list) ? d.my_wish_list : null,
  };
}

/** Attach the person's own wish list (its share code) to their row, so their Secret Santa sees it. */
export async function setSecretSantaWishList(code: string, token: string, listCode: string): Promise<boolean> {
  const sb = await client();
  if (!sb) throw new Error("secret santa: client not loaded");
  const { data, error } = await sb.rpc("secret_santa_set_wish_list", { p_code: code, p_token: token, p_wish_list_code: listCode });
  if (error) throw new Error(rpcErrorMessage("secret_santa_set_wish_list", error) ?? `secret santa: ${error.message ?? "save failed"}`);
  return data === true;
}

/** The signed-in member's planner on the account (null when there is none yet). */
export async function loadAccountPlan(userId: string): Promise<GiftPlan | null> {
  const sb = await client();
  if (!sb) throw new Error("gift planner: client not loaded");
  const { data, error } = await sb.from("gift_planner_plans").select("plan").eq("user_id", userId).maybeSingle();
  if (error) throw new Error(`gift planner: ${error.message ?? "read failed"}`);
  const row = data as { plan?: unknown } | null;
  return row ? cleanPlan(row.plan) : null;
}

/** Save the planner to the account (one row per member). Throws when the row was not written. */
export async function saveAccountPlan(userId: string, plan: GiftPlan): Promise<void> {
  const sb = await client();
  if (!sb) throw new Error("gift planner: client not loaded");
  const { data, error } = await sb.from("gift_planner_plans").upsert({ user_id: userId, plan, updated_at: new Date().toISOString() }, { onConflict: "user_id" }).select("user_id");
  if (error) throw new Error(`gift planner: ${error.message ?? "save failed"}`);
  // A null error with no row back is not a write (RLS refused it).
  if (!Array.isArray(data) || data.length !== 1) throw new Error("gift planner: not saved");
}
