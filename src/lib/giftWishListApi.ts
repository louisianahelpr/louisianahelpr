/**
 * The gift guides' wish list on the server (owner 2026-11-20: "add something that they can add to their list and send
 * their list to someone"). Every call is a server function on public.gift_wish_lists (migration
 * 20261120062130_gift_wish_lists); no browser reads or writes the table itself:
 *   gift_wish_list_save(p_name, p_items)  anyone: signed out, a new snapshot (rate limited) and its code; signed in, the
 *                                         account's one list (created or updated, same code every time).
 *   gift_wish_list_get(p_code)            anyone: a list by its code (name and item refs only), or null.
 *   gift_wish_list_mine()                 signed in: the account's list, or null.
 * A list holds only its name and item refs (guide slug + item id): no name, email or account id is ever in a link or
 * read back. The Supabase client loads only when a list is shared, opened or synced (loadModule), never on page load.
 */
import { loadModule } from "@/lib/loadModule";
import type { WishRef } from "@/pages/info/giftGuides/giftList";

/** A shared list's page: /gift-guides/list/<code>. */
export const sharedListPath = (code: string) => `/gift-guides/list/${code}`;
/** A list code as the server makes them (10 lowercase letters or digits). */
export const LIST_CODE = /^[a-z0-9]{10}$/;

export interface SharedList { name: string; items: WishRef[] }

type Rpc = (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;

const client = async (): Promise<{ rpc: Rpc } | null> => {
  const m = await loadModule(() => import("@/integrations/supabase/client"));
  return m ? (m.supabase as unknown as { rpc: Rpc }) : null;
};

const isRef = (v: unknown): v is WishRef => {
  const r = v as WishRef;
  return !!r && typeof r === "object" && typeof r.g === "string" && typeof r.i === "string" && /^[a-z0-9-]{1,80}$/.test(r.g) && /^[a-z0-9]{1,16}$/.test(r.i);
};

/** A list as the server answered it, or null when the answer is not one. */
export function asSharedList(data: unknown): SharedList | null {
  const d = data as { name?: unknown; items?: unknown } | null;
  if (!d || typeof d !== "object" || !Array.isArray(d.items)) return null;
  return { name: typeof d.name === "string" ? d.name : "", items: d.items.filter(isRef) };
}

/** Why a save did not happen: too many shares from here just now, or anything else (offline, a server error). */
export class WishListSaveError extends Error {
  constructor(public readonly kind: "rateLimited" | "failed", message: string) {
    super(message);
  }
}

/**
 * A shared list by its code (the viewer's page; no sign-in). Null when no list has that code. Throws when the server
 * could not be asked (the page says so and offers a retry).
 */
export async function getSharedList(code: string): Promise<SharedList | null> {
  if (!LIST_CODE.test(code)) return null;
  const sb = await client();
  if (!sb) throw new Error("gift wish list: client not loaded");
  const { data, error } = await sb.rpc("gift_wish_list_get", { p_code: code });
  if (error) throw new Error(`gift wish list: ${error.message ?? "read failed"}`);
  return asSharedList(data);
}

/** Save the list and get its code (signed out: a new snapshot; signed in: the account's list, same code). */
export async function saveWishList(name: string, items: WishRef[]): Promise<string> {
  const sb = await client();
  if (!sb) throw new WishListSaveError("failed", "client not loaded");
  const { data, error } = await sb.rpc("gift_wish_list_save", { p_name: name, p_items: items });
  if (error) throw new WishListSaveError(/rate_limited/.test(error.message ?? "") ? "rateLimited" : "failed", error.message ?? "save failed");
  if (typeof data !== "string" || !LIST_CODE.test(data)) throw new WishListSaveError("failed", "no code returned");
  return data;
}

/** The signed-in account's list (null when it has none yet). Throws when the server could not be asked. */
export async function getMyWishList(): Promise<(SharedList & { code: string }) | null> {
  const sb = await client();
  if (!sb) throw new Error("gift wish list: client not loaded");
  const { data, error } = await sb.rpc("gift_wish_list_mine");
  if (error) throw new Error(`gift wish list: ${error.message ?? "read failed"}`);
  const list = asSharedList(data);
  const code = (data as { code?: unknown } | null)?.code;
  return list && typeof code === "string" && LIST_CODE.test(code) ? { ...list, code } : null;
}
