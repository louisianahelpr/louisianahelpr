/**
 * R5 receipts: hand one rent receipt to the member. Web: a .txt download. Native:
 * the file is written to the cache and handed to the share sheet (save to Files,
 * print, send), the calendarExport pattern. Every failure is told and reported;
 * a dismissed share sheet is not a failure.
 */
import { toast } from "sonner";
import { isNativePlatform } from "@/lib/nativeInit";
import { report } from "@/lib/errorLogger";

function isUserCancellation(err: unknown): boolean {
  return err instanceof Error && (err.name === "AbortError" || /cancel/i.test(err.message) || /dismiss/i.test(err.message));
}

export async function saveRentReceipt(fileName: string, text: string): Promise<void> {
  if (isNativePlatform) {
    try {
      const { Filesystem, Directory, Encoding } = await import("@capacitor/filesystem");
      const written = await Filesystem.writeFile({ path: fileName, data: text, directory: Directory.Cache, encoding: Encoding.UTF8, recursive: true });
      const { Share } = await import("@capacitor/share");
      await Share.share({ title: "Rent receipt", files: [written.uri], dialogTitle: "Save rent receipt" });
    } catch (err) {
      if (isUserCancellation(err)) return;
      report(err, { severity: "error", tags: { source: "rentReceipt.native" } });
      toast.error("Couldn't save the receipt. Try again.");
    }
    return;
  }
  try {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    // The bare callable: an action-less toast.success renders nothing (toastPolicy).
    toast(`${fileName} downloaded`);
  } catch (err) {
    report(err, { severity: "error", tags: { source: "rentReceipt.download" } });
    toast.error("Couldn't download the receipt. Try again.");
  }
}
