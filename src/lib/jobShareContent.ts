import type { ShareContent } from "@/lib/nativeShare";
import { isNativePlatform } from "@/lib/nativeInit";
import { helprFlatTakeHomeCents, isGiveawayFixedPayJob } from "@/lib/helprFlatFee";

/** The fields of a job a share reads (ShareJobButton, the Posted card's "Share job"). */
export interface ShareableJob {
  id: string;
  title: string;
  budget?: number;
  category?: string;
  /** City string (no state suffix) shown in the share text. */
  city?: string;
  /** The fee stamp: the giveaway shares the amount its page shows, not its budget. */
  helper_fee_flat_cents?: number | string | null;
  helper_fee_percent?: number | string | null;
}

/**
 * What a job share sends: one source for ShareJobButton and the Posted card face's "Share job" (F265, audit 11-10),
 * so the two never word a job differently. The URL is the public /jobs/:id preview with ?ref=share for attribution.
 */
export function jobShareContent(job: ShareableJob): ShareContent & { clipboardText: string } {
  const location = job.city || "Louisiana";
  const url = `https://www.louisianahelpr.com/jobs/${job.id}?ref=share`;
  const title = `${job.title} — Need help in ${location}`;
  // Every job has a set budget (bidding was removed after zero production usage).
  const price = job.budget != null && isGiveawayFixedPayJob(job)
    ? Math.floor(helprFlatTakeHomeCents(Math.round(job.budget * 100), job) / 100)
    : job.budget;
  const priceLabel = `$${price != null ? price : "?"}`;
  const text = `${job.title} · ${priceLabel} · ${location}\n\nApply on Helpr:`;
  return { title, text, url, dialogTitle: "Share this job", clipboardText: `${text}\n${url}` };
}

/**
 * Will this device open a share sheet, or only copy? Desktop Safari and Chrome on macOS have no navigator.share, so a
 * control there says "Copy link" rather than promise a sheet (owner: "why it says copied when it's clicked"). Native is
 * always a sheet (the Capacitor bridge), whatever the WebView advertises.
 */
export function deviceOpensShareSheet(): boolean {
  return isNativePlatform || (typeof navigator !== "undefined" && typeof navigator.share === "function");
}
