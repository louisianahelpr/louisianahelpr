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

const client = async (): Promise<Client | null> => {
  const m = await loadModule(() => import("@/integrations/supabase/client"));
  return m ? (m.supabase as unknown as Client) : null;
};

/** Why a draw was not saved: too many draws from here just now, or anything else. */
export class SantaSaveError extends Error {
  constructor(public readonly kind: "rateLimited" | "failed", message: string) {
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
  if (error) throw new SantaSaveError(/rate_limited/.test(error.message ?? "") ? "rateLimited" : "failed", error.message ?? "save failed");
  const d = data as { code?: unknown; tokens?: unknown } | null;
  const tokens = Array.isArray(d?.tokens) ? d.tokens.filter((t): t is string => typeof t === "string" && SANTA_TOKEN.test(t)) : [];
  if (typeof d?.code !== "string" || !SANTA_CODE.test(d.code) || tokens.length !== input.names.length) throw new SantaSaveError("failed", "bad answer");
  return { code: d.code, tokens };
}

export interface SantaReveal { name: string; match: string; budget: number | null; exchangeOn: string | null; size: number; matchWishList: string | null; myWishList: string | null }

const LIST = /^[a-z0-9]{10}$/;
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
  if (error) throw new Error(`secret santa: ${error.message ?? "save failed"}`);
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
