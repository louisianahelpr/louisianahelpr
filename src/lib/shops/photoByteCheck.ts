/**
 * Q1956 (migration 20261112095000_shops_photo_byte_check): between upload and attach, a shop photo goes through the
 * shop-photo-check edge function, which reads the object's own first bytes (PNG, JPEG or WebP) and stamps that object;
 * shops_attach_photo and shops_add_item_photo attach only a stamped path. A refused object is deleted by the function
 * itself; on any other failure the caller deletes it. The error's message is the code shopsErrorMessage reads.
 */
import { supabase } from "@/integrations/supabase/client";
import { removeShopObjects } from "./storageCleanup";

export async function checkShopPhotoBytes(bucket: string, path: string): Promise<void> {
  const { error } = await supabase.functions.invoke("shop-photo-check", { body: { path } });
  if (!error) return;
  const ctx = (error as { context?: Response }).context;
  const parsed: { error?: unknown } | null = ctx && typeof ctx.json === "function"
    ? await ctx.clone().json().catch((parseErr: unknown) => {
        // A body that is not JSON carries no code: the generic upload words.
        console.warn("[shops] shop-photo-check error body was not JSON", parseErr);
        return null;
      })
    : null;
  const code = parsed?.error === "photo_not_an_image" ? "photo_not_an_image" : "photo_not_uploaded";
  if (code !== "photo_not_an_image") await removeShopObjects(bucket, [path], "unchecked photo upload");
  throw new Error(code);
}
