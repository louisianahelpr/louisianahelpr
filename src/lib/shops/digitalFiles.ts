/**
 * Shops digital downloads: the seller's files and the buyer's download (owner 11-08; migration
 * 20261108182917_shops_digital_downloads; edge function shop-digital). The files live in a PRIVATE bucket that no
 * member can read: every upload and download link is signed by shop-digital after the database says who may.
 *   upload:   upload_url (a waiting row + a one-time signed upload link) -> the file goes straight to storage ->
 *             confirm (shop-digital reads its own bytes; a mismatch is deleted and refused).
 *   download: a fresh 10-minute link per tap, for the seller or a buyer whose order is complete and not refunded.
 */
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { rpcErrorMessage } from "./rpcErrorCopy";
import { DIGITAL_MAX_BYTES, DIGITAL_MAX_FILES, digitalExtFromName } from "../../../supabase/functions/_shared/digitalFileCheck";

export { DIGITAL_MAX_FILES };
const BUCKET = "shop-digital";
/** What the file picker offers (the server decides from the bytes either way). */
export const DIGITAL_FILE_ACCEPT = ".pdf,.zip,.png,.jpg,.jpeg,application/pdf,application/zip,image/png,image/jpeg";

export interface ShopDigitalFile {
  id: string;
  file_name: string;
  ext: string;
  byte_size: number;
  position: number;
  checked_at: string | null;
}

/** The seller's own files for an item (RLS: the seller reads their own rows; the storage path is never granted). */
export async function fetchMyDigitalFiles(itemId: string): Promise<ShopDigitalFile[]> {
  const res = await supabase.from("shop_item_files")
    .select("id, file_name, ext, byte_size, position, checked_at")
    .eq("item_id", itemId)
    .order("position");
  return unwrap(res) as ShopDigitalFile[];
}

/** A refusal shopsErrorMessage can read: the code as the message, the server's own plain words as userMessage. */
function digitalError(code: string, hint: string | null = null): Error {
  const e = new Error(code) as Error & { userMessage?: string };
  if (hint) e.userMessage = hint;
  return e;
}

async function invokeShopDigital(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.functions.invoke("shop-digital", { body });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    const parsed: { error?: unknown; hint?: unknown } | null = ctx && typeof ctx.json === "function"
      ? await ctx.clone().json().catch((parseErr: unknown) => {
          // A body that is not JSON carries no code: the generic message.
          console.warn("[shops] shop-digital error body was not JSON", parseErr);
          return null;
        })
      : null;
    throw digitalError(typeof parsed?.error === "string" && parsed.error ? parsed.error : "payment_unavailable",
      typeof parsed?.hint === "string" ? parsed.hint : null);
  }
  return (data ?? {}) as Record<string, unknown>;
}

/** Plain words for a size, e.g. "4.2 MB". */
export function fileSizeLabel(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} bytes`;
}

/** Why a picked file is refused before any upload, or null. The server checks again from the bytes. */
function digitalFileProblem(file: File): string | null {
  if (!digitalExtFromName(file.name)) return "Upload a PDF, ZIP, PNG or JPG file.";
  if (file.size < 1) return "That file is empty.";
  if (file.size > DIGITAL_MAX_BYTES) return "Each file can be up to 100 MB.";
  return null;
}

export async function uploadDigitalFile(itemId: string, file: File): Promise<void> {
  const problem = digitalFileProblem(file);
  if (problem) throw digitalError("file_not_allowed", problem);
  const begun = await invokeShopDigital({ action: "upload_url", item_id: itemId, file_name: file.name, byte_size: file.size });
  const fileId = String(begun.file_id ?? "");
  const path = String(begun.path ?? "");
  const token = String(begun.token ?? "");
  if (!fileId || !path || !token) throw digitalError("upload_missing");
  const up = await supabase.storage.from(BUCKET).uploadToSignedUrl(path, token, file, { contentType: file.type || undefined });
  if (up.error) {
    // The waiting row would block publishing: take it back, then report the upload's own failure.
    await invokeShopDigital({ action: "remove", file_id: fileId }).catch((e: unknown) => {
      console.warn("[shops] waiting file row not removed after a failed upload", e);
    });
    throw digitalError("upload_missing");
  }
  await invokeShopDigital({ action: "confirm", file_id: fileId });
}

/** S2-005: check a file again whose upload landed but whose check never answered (tab closed, network drop). */
export async function confirmDigitalFile(fileId: string): Promise<void> {
  await invokeShopDigital({ action: "confirm", file_id: fileId });
}

export async function removeDigitalFile(fileId: string): Promise<void> {
  await invokeShopDigital({ action: "remove", file_id: fileId });
}

/** A fresh 10-minute download link (never stored; one per tap). */
export async function digitalDownloadUrl(fileId: string): Promise<string> {
  const data = await invokeShopDigital({ action: "download", file_id: fileId });
  const url = String(data.url ?? "");
  if (!url) throw digitalError("file_not_found");
  return url;
}

/** The buyer's billing address for a download's sales tax (sourced to where the buyer lives). */
export interface BillingAddress {
  line1: string;
  city: string;
  state: string;
  postal_code: string;
}

/** Why the typed billing address would be refused, or null. The server checks again. */
export function billingAddressProblem(a: BillingAddress): string | null {
  if (a.line1.trim().length < 3) return "Type your street address.";
  if (a.city.trim().length < 2) return "Type your city.";
  if (!/^[A-Za-z]{2}$/.test(a.state.trim())) return "Type your state as two letters, like LA.";
  if (!/^\d{5}$/.test(a.postal_code.trim())) return "Type your 5-digit ZIP code.";
  return null;
}

/**
 * The website page where a download is bought. The iPhone app never shows a card page for a download: its Buy button
 * opens this page on louisianahelpr.com (App Review Guideline 3.1.1(a) and 3.1.3, as revised after the 2025 Epic v.
 * Apple injunction: apps on the United States storefront may include buttons and links to other purchase methods).
 */
const DIGITAL_BUY_ORIGIN = "https://www.louisianahelpr.com";
export function digitalBuyUrl(shopId: string, itemId: string): string {
  return `${DIGITAL_BUY_ORIGIN}/shops/${encodeURIComponent(shopId)}?buy=${encodeURIComponent(itemId)}`;
}

export interface BuyerDigitalFile {
  file_id: string;
  file_name: string;
  ext: string;
  byte_size: number;
}

/** The files of a download the buyer paid for (empty once refunded). Names only; links are minted per tap. */
export async function fetchOrderDigitalFiles(orderId: string): Promise<BuyerDigitalFile[]> {
  const res = await supabase.rpc("shops_my_digital_files", { p_order_id: orderId });
  return (unwrap(res) ?? []) as BuyerDigitalFile[];
}

/** The buyer says the file is broken or not as described (within 72 hours of buying; the payout waits). */
export async function reportDigitalProblem(orderId: string, reason: "broken" | "not_as_described", note: string): Promise<void> {
  const res = await supabase.rpc("shops_report_digital_problem", { p_order_id: orderId, p_reason: reason, p_note: note.trim() });
  if (!res.error) return;
  try {
    unwrap(res);
  } catch (thrown) {
    // The RPC's own words for its refusal (SHOPS_RPC_ERROR_COPY), read by shopsErrorMessage as userMessage.
    const e = thrown as Error & { userMessage?: string };
    const words = rpcErrorMessage("shops_report_digital_problem", thrown);
    if (words && Object.isExtensible(e)) e.userMessage = words;
    throw e;
  }
}

/** Hours left to report a problem (72 after the charge), or 0. */
export function digitalReportHoursLeft(capturedAt: string | null, now = Date.now()): number {
  if (!capturedAt) return 0;
  const left = new Date(capturedAt).getTime() + 72 * 3_600_000 - now;
  return left > 0 ? Math.ceil(left / 3_600_000) : 0;
}
