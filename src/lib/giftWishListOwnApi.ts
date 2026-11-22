/**
 * The wish list's owner-only calls (holiday audit 1121, migration 20261122024017): keep a token for a link this browser
 * shared, stop that link, delete the account's own list. Loaded only when one of them runs (giftWishListApi.ts's
 * claimShare / stopSharing / deleteMyWishList), so no guide page downloads them (critical-path budget, train 1121i).
 */
import { LIST_CODE, TOKENS_KEY, WishListSaveError, client, readTokens, rpcErrorMessage } from "./giftWishListApi";

const writeTokens = (t: Record<string, string>) => {
  try {
    window.localStorage.setItem(TOKENS_KEY, JSON.stringify(Object.fromEntries(Object.entries(t).slice(-50))));
  } catch {
    // Storage blocked: this link can't be stopped later from this browser (it still ends after 90 days).
  }
};

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
