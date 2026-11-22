/**
 * The gift guides' wish list on the server (owner 2026-11-20: "add something that they can add to their list and send
 * their list to someone"). Every call is a server function on public.gift_wish_lists (migration
 * 20261120062130_gift_wish_lists); no browser reads or writes the table itself:
 *   gift_wish_list_save(p_name, p_items, p_test)  anyone: signed out, a new snapshot (rate limited) and its code;
 *                                         signed in, the account's one list (created or updated, same code every time).
 *                                         p_test: a test browser (automationReason), so its rows are is_seed.
 *   gift_wish_list_get(p_code)            anyone: a list by its code (name and item refs only), or null.
 *   gift_wish_list_mine()                 signed in: the account's list, or null.
 *   gift_wish_list_new_link()             signed in: a new code for the account's list (the old link stops working).
 *   gift_wish_lists_share(p_lists, p_test) anyone: several named lists (the gift planner's people, owner 2026-11-21:
 *                                         "share all lists") as one new snapshot and its code (migration
 *                                         20261121204723_gift_wish_lists_share); the same /gift-guides/list/<code> page.
 *                                         A gift from any store rides as {r: <link request id>} (20261121221514).
 *   wish_link_request_add(...)            anyone: queue a pasted shop link or typed idea for us to make our link.
 *   wish_link_requests_get(p_ids)         anyone: our link for each request, once we made it.
 * A list holds only its name and item refs (guide slug + item id): no name, email or account id is ever in a link or
 * read back. The Supabase client loads only when a list is shared, opened or synced (loadModule), never on page load.
 */
import { loadModule } from "@/lib/loadModule";
import { automationReason } from "@/lib/automatedBrowser";
import type { WishRef } from "@/pages/info/giftGuides/giftList";

/** A shared list's page: /gift-guides/list/<code>. */
export const sharedListPath = (code: string) => `/gift-guides/list/${code}`;
/** A list code as the server makes them (12 lowercase letters or digits). */
const LIST_CODE = /^[a-z0-9]{12}$/;

/**
 * Each code the wish list's server functions raise, in plain words (src/test/rpcErrorCopyCoverage.test.ts, both ways).
 * Shown by the Share button and "Make a new link"; the background sync shows nothing and keeps the list on the device.
 */
export const GIFT_WISH_RPC_ERROR_COPY = {
  gift_wish_list_save: {
    rate_limited: "You've shared a lot just now. Try again in a few minutes.",
    invalid_items: "Something on your list couldn't be saved. Remove a gift or two and try again.",
    invalid_name: "Please use a name without a link or phone number.",
    empty_list: "Add a gift to your list first, then share it.",
  },
  gift_wish_lists_share: {
    rate_limited: "You've shared a lot just now. Try again in a few minutes.",
    invalid_items: "Something on these lists couldn't be shared. Remove a gift or two and try again.",
    invalid_name: "Please use names without a link or phone number.",
    empty_list: "Add a gift from our guides first, then share.",
  },
  gift_wish_list_new_link: {
    not_authenticated: "Sign in again to make a new link.",
  },
  // Delete a list or stop a shared link (holiday audit 1121, migration 20261122024017).
  gift_wish_list_delete: {
    not_authenticated: "Sign in again to delete your list.",
  },
  gift_wish_list_claim: {
    invalid_token: "This link can't be stopped from here.",
  },
  gift_wish_list_unshare: {
    invalid_token: "This link can't be stopped from here.",
  },
  // Add from any store (owner 11-21): the gift is always kept on the device; these say why we could not also ask for
  // our link (shown under the box).
  wish_link_request_add: {
    rate_limited: "Added. You've added a lot just now, so we'll look for its link later.",
    invalid_words: "Added. Its name has a web address or phone number in it, so we can't look for our link.",
    invalid_url: "Added. That link can't be used for ours.",
    invalid_list: "Added. We couldn't send it to look for our link.",
    invalid_kind: "Added. We couldn't send it to look for our link.",
  },
  wish_link_requests_get: {
    invalid_ids: "Some gifts' links couldn't be checked.",
  },
} satisfies Record<string, Record<string, string>>;

/** Words for an error a wish list call returned, or null when it is not one of its codes (whole-token match). */
function rpcErrorMessage(rpc: keyof typeof GIFT_WISH_RPC_ERROR_COPY, error: unknown): string | null {
  const m = typeof error === "string" ? error : (error as { message?: unknown } | null)?.message;
  const raw = typeof m === "string" ? m : "";
  const table: Record<string, string> = GIFT_WISH_RPC_ERROR_COPY[rpc];
  for (const code of Object.keys(table)) {
    if (new RegExp(`(^|[^a-z0-9_])${code}($|[^a-z0-9_])`).test(raw)) return table[code];
  }
  return null;
}

/** A gift from any store on a shared list (owner 11-21): the person's words and our link once we made it (else null). */
export interface SharedAnyItem { id: string; name: string; href: string | null; dismissed?: true }
/** One person's list in a lists share: its name ("Mom"), its gifts from our guides as refs, and its gifts from any store. */
export interface SharedPersonList { name: string; items: WishRef[]; any?: SharedAnyItem[] }
/** A gift on a list being shared: one from our guides ({g, i}) or one from any store (its link request, {r}). */
export type ShareRef = WishRef | { r: string };
/** A shared link: one wish list (`items`), or a lists share (`lists`, owner 11-21; `items` then empty). */
export interface SharedList { name: string; items: WishRef[]; lists?: SharedPersonList[] }

type Rpc = (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;

const client = async (): Promise<{ rpc: Rpc } | null> => {
  const m = await loadModule(() => import("@/integrations/supabase/client"));
  return m ? (m.supabase as unknown as { rpc: Rpc }) : null;
};

const isRef = (v: unknown): v is WishRef => {
  const r = v as WishRef;
  return !!r && typeof r === "object" && typeof r.g === "string" && typeof r.i === "string" && /^[a-z0-9-]{1,80}$/.test(r.g) && /^[a-z0-9]{1,16}$/.test(r.i);
};

const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** A gift from any store as gift_wish_list_get reads it back ({r, w, h}); our link only when it is an https link. */
const anyItem = (v: unknown): SharedAnyItem[] => {
  const x = v as { r?: unknown; w?: unknown; h?: unknown } | null;
  if (!x || typeof x !== "object" || typeof x.r !== "string" || !REQUEST_ID.test(x.r) || typeof x.w !== "string" || !x.w.trim()) return [];
  return [{ id: x.r, name: x.w.trim().slice(0, 120), href: typeof x.h === "string" && /^https:\/\//.test(x.h) ? x.h : null, ...((x as { d?: unknown }).d === true ? { dismissed: true } : {}) }];
};

/** `any` only when the list has gifts from any store (a list without them reads exactly as before). */
const withAny = (any: SharedAnyItem[]) => (any.length > 0 ? { any } : {});

/** A list as the server answered it, or null when the answer is not one. */
export function asSharedList(data: unknown): SharedList | null {
  const d = data as { name?: unknown; items?: unknown } | null;
  if (!d || typeof d !== "object" || !Array.isArray(d.items)) return null;
  const raw = (d as { lists?: unknown }).lists;
  const lists = Array.isArray(raw)
    ? raw.flatMap((l): SharedPersonList[] => {
      const x = l as { n?: unknown; items?: unknown } | null;
      return x && typeof x === "object" && typeof x.n === "string" && Array.isArray(x.items) ? [{ name: x.n, items: x.items.filter(isRef), ...withAny(x.items.flatMap(anyItem)) }] : [];
    })
    : undefined;
  return { name: typeof d.name === "string" ? d.name : "", items: d.items.filter(isRef), ...(lists ? { lists } : {}) };
}

/** Why a save did not happen: too many shares from here just now, or anything else (offline, a server error). */
class WishListSaveError extends Error {
  /** `copy`: the plain words for the code the server raised (GIFT_WISH_RPC_ERROR_COPY), or null for any other failure. */
  constructor(public readonly kind: "rateLimited" | "failed", message: string, public readonly copy: string | null = null) {
    super(message);
  }
}

/** The words to show for a failed save or new link: the code's own copy, or null (the caller's plain fallback). */
export const wishErrorCopy = (e: unknown): string | null => {
  const copy = (e as { copy?: unknown } | null)?.copy;
  return typeof copy === "string" ? copy : null;
};

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
  const { data, error } = await sb.rpc("gift_wish_list_save", { p_name: name, p_items: items, p_test: automationReason() !== null });
  if (error) throw new WishListSaveError(/rate_limited/.test(error.message ?? "") ? "rateLimited" : "failed", error.message ?? "save failed", rpcErrorMessage("gift_wish_list_save", error));
  if (typeof data !== "string" || !LIST_CODE.test(data)) throw new WishListSaveError("failed", "no code returned");
  return data;
}

/**
 * Share several named lists (the gift planner's people) as one link: always a new snapshot, signed in or not. Names
 * and refs only: never a budget, price or "bought" mark. Throws like saveWishList.
 */
export async function shareGiftLists(lists: { n: string; items: ShareRef[] }[]): Promise<string> {
  const sb = await client();
  if (!sb) throw new WishListSaveError("failed", "client not loaded");
  const { data, error } = await sb.rpc("gift_wish_lists_share", { p_lists: lists, p_test: automationReason() !== null });
  if (error) throw new WishListSaveError(/rate_limited/.test(error.message ?? "") ? "rateLimited" : "failed", error.message ?? "share failed", rpcErrorMessage("gift_wish_lists_share", error));
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

/** "Make a new link": a new code for the signed-in account's list (null when it has none yet). */
export async function newWishLink(): Promise<string | null> {
  const sb = await client();
  if (!sb) throw new WishListSaveError("failed", "client not loaded");
  const { data, error } = await sb.rpc("gift_wish_list_new_link");
  if (error) throw new WishListSaveError("failed", error.message ?? "new link failed", rpcErrorMessage("gift_wish_list_new_link", error));
  return typeof data === "string" && LIST_CODE.test(data) ? data : null;
}

/** What a link request answered: its id (kept on the gift) and our link when we already have one, else null. */
export interface WishLinkAnswer { id: string; link: string | null }

/**
 * Add from any store (owner 11-21, migration 20261121221514_wish_link_requests): ask us to make our link for a pasted
 * shop link (`url`) or typed idea (no url). The gift is already on the device; this only queues it for us. `listKey`
 * is the planner's own person id, `listName` the person's first name (we see lists grouped). Throws like saveWishList
 * (`copy`: the plain words for the code the server raised).
 */
export async function requestWishLink(kind: "link" | "idea", words: string, url: string | null, listKey: string, listName: string): Promise<WishLinkAnswer> {
  const sb = await client();
  if (!sb) throw new WishListSaveError("failed", "client not loaded");
  const { data, error } = await sb.rpc("wish_link_request_add", {
    p_kind: kind, p_words: words, p_url: url, p_list_key: listKey, p_list_name: listName, p_test: automationReason() !== null,
  });
  if (error) throw new WishListSaveError(/rate_limited/.test(error.message ?? "") ? "rateLimited" : "failed", error.message ?? "request failed", rpcErrorMessage("wish_link_request_add", error));
  const d = data as { id?: unknown; link?: unknown } | null;
  if (!d || typeof d.id !== "string" || !REQUEST_ID.test(d.id)) throw new WishListSaveError("failed", "no request id returned");
  return { id: d.id, link: typeof d.link === "string" && /^https:\/\//.test(d.link) ? d.link : null };
}

/**
 * These requests as the server has them, by id: our link once made, else null. A request that no longer exists (pruned)
 * is not in the map. Throws when the server could not be asked.
 */
export async function readWishLinks(ids: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  const want = [...new Set(ids.filter((id) => REQUEST_ID.test(id)))].slice(0, 300);
  if (want.length === 0) return out;
  const sb = await client();
  if (!sb) throw new Error("wish links: client not loaded");
  const { data, error } = await sb.rpc("wish_link_requests_get", { p_ids: want });
  if (error) throw new Error(rpcErrorMessage("wish_link_requests_get", error) ?? `wish links: ${error.message ?? "read failed"}`);
  for (const r of Array.isArray(data) ? data : []) {
    const x = r as { id?: unknown; link?: unknown };
    if (typeof x.id === "string") out.set(x.id, typeof x.link === "string" && /^https:\/\//.test(x.link) ? x.link : null);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Delete a list, or stop a shared link (holiday audit 1121: "No way to delete a wish list or stop a shared link";
// migration 20261122024017). The browser that makes a shared snapshot keeps a random token for it (localStorage
// "lh-gift-share-tokens", by code; only its hash is on the server), so it can stop that link later.

const TOKENS_KEY = "lh-gift-share-tokens";
const readTokens = (): Record<string, string> => {
  try {
    const v = JSON.parse(window.localStorage.getItem(TOKENS_KEY) ?? "{}") as unknown;
    if (!v || typeof v !== "object") return {};
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter((e): e is [string, string] => LIST_CODE.test(e[0]) && typeof e[1] === "string" && /^[0-9a-f]{64}$/.test(e[1])));
  } catch {
    // Storage blocked or not ours: no link can be stopped from this browser.
    return {};
  }
};
const writeTokens = (t: Record<string, string>) => {
  try {
    window.localStorage.setItem(TOKENS_KEY, JSON.stringify(Object.fromEntries(Object.entries(t).slice(-50))));
  } catch {
    // Storage blocked: this link can't be stopped later from this browser (it still ends after 90 days).
  }
};
/** True when this browser can stop the shared link with this code. */
export const canStopSharing = (code: string) => code in readTokens();

/** Right after a share: keep a token so this browser can stop the link. Throws when the server could not be asked. */
export async function claimShare(code: string): Promise<void> {
  if (!LIST_CODE.test(code) || typeof crypto === "undefined" || !crypto.getRandomValues) return;
  const token = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const sb = await client();
  if (!sb) return;
  const { data, error } = await sb.rpc("gift_wish_list_claim", { p_code: code, p_token: token });
  if (error) throw new Error(rpcErrorMessage("gift_wish_list_claim", error) ?? `gift wish list: ${error.message ?? "claim failed"}`);
  // false: an account's own list (it has Delete instead) or a snapshot already claimed.
  if (data === true) writeTokens({ ...readTokens(), [code]: token });
}

/** Stop a shared link this browser made: the list is deleted and the link stops opening. False when it could not be. */
export async function stopSharing(code: string): Promise<boolean> {
  const token = readTokens()[code];
  if (!token) return false;
  const sb = await client();
  if (!sb) throw new Error("gift wish list: client not loaded");
  const { data, error } = await sb.rpc("gift_wish_list_unshare", { p_code: code, p_token: token });
  if (error) throw new WishListSaveError("failed", error.message ?? "unshare failed", rpcErrorMessage("gift_wish_list_unshare", error));
  const t = readTokens();
  delete t[code];
  writeTokens(t);
  return data === true;
}

/** Signed in: delete the account's own list (its link stops at once). True when there was one. */
export async function deleteMyWishList(): Promise<boolean> {
  const sb = await client();
  if (!sb) throw new Error("gift wish list: client not loaded");
  const { data, error } = await sb.rpc("gift_wish_list_delete");
  if (error) throw new WishListSaveError("failed", error.message ?? "delete failed", rpcErrorMessage("gift_wish_list_delete", error));
  return data === true;
}
