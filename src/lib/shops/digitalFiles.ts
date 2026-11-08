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
    const refusal = new Error(typeof parsed?.hint === "string" && parsed.hint ? parsed.hint
      : typeof parsed?.error === "string" && parsed.error ? parsed.error : "Something went wrong. Please try again.");
    throw refusal;
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
export function digitalFileProblem(file: File): string | null {
  if (!digitalExtFromName(file.name)) return "Upload a PDF, ZIP, PNG or JPG file.";
  if (file.size < 1) return "That file is empty.";
  if (file.size > DIGITAL_MAX_BYTES) return "Each file can be up to 100 MB.";
  return null;
}

export async function uploadDigitalFile(itemId: string, file: File): Promise<void> {
  const problem = digitalFileProblem(file);
  if (problem) throw new Error(problem);
  const begun = await invokeShopDigital({ action: "upload_url", item_id: itemId, file_name: file.name, byte_size: file.size });
  const fileId = String(begun.file_id ?? "");
  const path = String(begun.path ?? "");
  const token = String(begun.token ?? "");
  if (!fileId || !path || !token) throw new Error("Something went wrong. Please try again.");
  const up = await supabase.storage.from(BUCKET).uploadToSignedUrl(path, token, file, { contentType: file.type || undefined });
  if (up.error) {
    // The waiting row would block publishing: take it back, then report the upload's own failure.
    await invokeShopDigital({ action: "remove", file_id: fileId }).catch((e: unknown) => {
      console.warn("[shops] waiting file row not removed after a failed upload", e);
    });
    throw new Error("The upload did not finish. Please try again.");
  }
  await invokeShopDigital({ action: "confirm", file_id: fileId });
}

export async function removeDigitalFile(fileId: string): Promise<void> {
  await invokeShopDigital({ action: "remove", file_id: fileId });
}

/** A fresh 10-minute download link (never stored; one per tap). */
export async function digitalDownloadUrl(fileId: string): Promise<string> {
  const data = await invokeShopDigital({ action: "download", file_id: fileId });
  const url = String(data.url ?? "");
  if (!url) throw new Error("Something went wrong. Please try again.");
  return url;
}
