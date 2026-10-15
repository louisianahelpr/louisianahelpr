/**
 * Quotes on jobs (docs/specs/louisiana-hub-roadmap.md, owner Q1-Q8): the
 * client's only door to the quote RPCs in 20261015091114_job_quotes.sql.
 * Every call goes through quoteRpc() (unwrap() plus the RPC's own words from
 * RPC_ERROR_COPY, read at the call: the rpcErrorCopyCoverage rule), so a
 * refusal reaches the screen as an Error whose message is the server's code
 * and whose `userMessage` is its sentence (quoteErrorMessage shows it).
 * Every RPC refuses while the 'quotes' switch is off for the caller.
 */
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { rpcErrorMessage } from "@/lib/lifecycleErrors";
import { NEVER_PAID_STATUSES } from "@/lib/neverPaidStatuses";
import type { Database } from "@/integrations/supabase/types";
import { IMMUTABLE_OBJECT_CACHE_CONTROL } from "@/lib/storageCacheControl";
import { LISTING_PHOTO_UPLOAD_TYPES, cleanListingPhoto } from "@/lib/declutter/photos";

type Fns = Database["public"]["Functions"];
export type MyQuoteRequest = Fns["get_my_quote_requests"]["Returns"][number];
export type OpenQuoteRequest = Fns["list_open_quote_requests"]["Returns"][number];
export type RequestQuote = Fns["get_quotes_for_request"]["Returns"][number];
export type MyJobQuote = Fns["get_my_job_quotes"]["Returns"][number];

/** One step of the back-and-forth on a quote (job_quote_offers, oldest first). */
export interface QuoteOffer {
  by: "quoter" | "poster";
  price_cents: number;
  note: string | null;
  at: string;
}

/** The quote window choices (owner Q4): 24 h, 48 h (default) or 3 days. */
export const QUOTE_WINDOWS = [
  { value: 24, label: "24 hours" },
  { value: 48, label: "48 hours" },
  { value: 72, label: "3 days" },
] as const;
export type QuoteWindowHours = (typeof QUOTE_WINDOWS)[number]["value"];
export const DEFAULT_QUOTE_WINDOW: QuoteWindowHours = 48;

/** The past-work photos a quote may carry (job_quotes CHECK cardinality <= 4). */
export const MAX_QUOTE_PHOTOS = 4;
/** job_quotes.price_cents: whole dollars from $10 to $1,000. */
export const MIN_QUOTE_DOLLARS = 10;
export const MAX_QUOTE_DOLLARS = 1000;

/**
 * unwrap() a quote RPC's result; on a refusal, attach the words `words` finds
 * for it as `userMessage` (the original error stays the thrown one, so its
 * code still reads as its message).
 */
function quoteRpc<T>(result: { data: T; error: { message: string } | null; status?: number }, words: (e: unknown) => string | null): T {
  if (!result.error) return result.data;
  try {
    unwrap(result);
  } catch (thrown) {
    const e = thrown as Error & { userMessage?: string };
    const msg = words(thrown);
    if (msg && Object.isExtensible(e)) e.userMessage = msg;
    throw e;
  }
  return result.data;
}

export function offersOf(raw: unknown): QuoteOffer[] {
  return Array.isArray(raw) ? (raw as QuoteOffer[]) : [];
}

export async function fetchMyQuoteRequests(): Promise<MyQuoteRequest[]> {
  return quoteRpc(await supabase.rpc("get_my_quote_requests"), (e) => rpcErrorMessage("get_my_quote_requests", e)) ?? [];
}

export async function fetchOpenQuoteRequests(): Promise<OpenQuoteRequest[]> {
  return quoteRpc(await supabase.rpc("list_open_quote_requests"), (e) => rpcErrorMessage("list_open_quote_requests", e)) ?? [];
}

export async function fetchQuotesForRequest(requestId: string): Promise<RequestQuote[]> {
  return quoteRpc(await supabase.rpc("get_quotes_for_request", { p_request_id: requestId }), (e) => rpcErrorMessage("get_quotes_for_request", e)) ?? [];
}

export async function fetchMyJobQuotes(): Promise<MyJobQuote[]> {
  return quoteRpc(await supabase.rpc("get_my_job_quotes"), (e) => rpcErrorMessage("get_my_job_quotes", e)) ?? [];
}

export interface NewQuoteRequest {
  title: string;
  description: string;
  category: string;
  dateNeeded: string;
  startTime: string | null;
  estimatedHours: number | null;
  location: string | null;
  latitude: number | null;
  longitude: number | null;
  parish: string | null;
  windowHours: QuoteWindowHours;
}

/** Ask for quotes. Returns the new request's id (never null: unwrap throws first). */
export async function createQuoteRequest(r: NewQuoteRequest): Promise<string> {
  const id = quoteRpc(
    await supabase.rpc("create_quote_request", {
      p_title: r.title,
      p_description: r.description,
      p_category: r.category,
      p_date_needed: r.dateNeeded,
      p_start_time: r.startTime ?? undefined,
      p_estimated_hours: r.estimatedHours ?? undefined,
      p_location: r.location ?? undefined,
      p_latitude: r.latitude ?? undefined,
      p_longitude: r.longitude ?? undefined,
      p_parish: r.parish ?? undefined,
      p_window_hours: r.windowHours,
    }),
    (e) => rpcErrorMessage("create_quote_request", e),
  );
  if (!id) throw new Error("no_request_id");
  return id;
}

/** Past-work photos live in job-photos under the quoter's own folder. */
const QUOTE_PHOTO_BUCKET = "job-photos";

/**
 * Where one past-work photo is stored: under the quoter's own `quotes` folder,
 * which account deletion erases (supabase/functions/_shared/purgeBuckets.ts
 * IDENTITY_SUBFOLDERS; src/test/quotePhotosPurged.test.ts).
 */
export function quotePhotoPath(userId: string, nonce: string): string {
  return `${userId}/quotes/${nonce}.jpg`;
}

/**
 * Clean (to JPEG, metadata stripped, as Declutter listing photos) and upload
 * one past-work photo to <uid>/quotes/<random>.jpg. Returns the storage path
 * submit_job_quote takes (it refuses a path outside the quoter's folder).
 */
export async function uploadQuotePhoto(userId: string, file: File): Promise<string> {
  const cleaned = await cleanListingPhoto(file);
  if (!LISTING_PHOTO_UPLOAD_TYPES.includes(cleaned.type)) throw new Error("invalid_photo");
  const nonce = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now());
  const path = quotePhotoPath(userId, nonce);
  const { error } = await supabase.storage.from(QUOTE_PHOTO_BUCKET).upload(path, cleaned, {
    contentType: "image/jpeg",
    upsert: false,
    cacheControl: IMMUTABLE_OBJECT_CACHE_CONTROL,
  });
  if (error) throw new Error("invalid_photo");
  return path;
}

/** Remove photos uploaded for a quote that was then not sent (best effort). */
export async function removeQuotePhotos(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const { error } = await supabase.storage.from(QUOTE_PHOTO_BUCKET).remove(paths);
  if (error) console.warn("[quotes] unsent quote photos not removed", error.message);
}

export function quotePhotoUrl(path: string): string {
  return supabase.storage.from(QUOTE_PHOTO_BUCKET).getPublicUrl(path).data.publicUrl;
}

export async function submitJobQuote(input: {
  requestId: string;
  priceDollars: number;
  note: string;
  when: string;
  photoPaths: string[];
}): Promise<string> {
  const id = quoteRpc(
    await supabase.rpc("submit_job_quote", {
      p_request_id: input.requestId,
      p_price_cents: Math.round(input.priceDollars) * 100,
      p_note: input.note,
      p_available_note: input.when,
      p_photo_paths: input.photoPaths,
    }),
    (e) => rpcErrorMessage("submit_job_quote", e),
  );
  if (!id) throw new Error("no_quote_id");
  return id;
}

export type QuoteAnswer = "accept" | "decline" | "counter";

/** Answer the offer on the table. Returns 'accepted' | 'declined' | 'countered'. */
export async function respondToQuote(input: {
  quoteId: string;
  action: QuoteAnswer;
  priceDollars?: number;
  note?: string;
}): Promise<string> {
  const out = quoteRpc(
    await supabase.rpc("respond_to_job_quote", {
      p_quote_id: input.quoteId,
      p_action: input.action,
      p_price_cents: input.priceDollars != null ? Math.round(input.priceDollars) * 100 : undefined,
      p_note: input.note?.trim() ? input.note.trim() : undefined,
    }),
    (e) => rpcErrorMessage("respond_to_job_quote", e),
  );
  if (!out) throw new Error("no_answer");
  return out;
}

/** Turn the agreed quote into an unpaid job (idempotent). Returns the job id. */
export async function bookAcceptedQuote(requestId: string): Promise<string> {
  const jobId = quoteRpc(await supabase.rpc("book_accepted_quote", { p_request_id: requestId }), (e) => rpcErrorMessage("book_accepted_quote", e));
  if (!jobId) throw new Error("no_job_id");
  return jobId;
}

/** Close every quote and post the job at the poster's own price. Returns the job id. */
export async function switchToSetPrice(requestId: string, budgetDollars: number): Promise<string> {
  const jobId = quoteRpc(
    await supabase.rpc("switch_quote_request_to_set_price", { p_request_id: requestId, p_budget: budgetDollars }),
    (e) => rpcErrorMessage("switch_quote_request_to_set_price", e),
  );
  if (!jobId) throw new Error("no_job_id");
  return jobId;
}

export async function cancelQuoteRequest(requestId: string): Promise<void> {
  quoteRpc(await supabase.rpc("cancel_quote_request", { p_request_id: requestId }), (e) => rpcErrorMessage("cancel_quote_request", e));
}

export async function withdrawJobQuote(quoteId: string): Promise<void> {
  quoteRpc(await supabase.rpc("withdraw_job_quote", { p_quote_id: quoteId }), (e) => rpcErrorMessage("withdraw_job_quote", e));
}

/**
 * Whether the job a quote was booked into is paid for (anything past the
 * never-paid states). The poster reads their own job (jobs RLS).
 */
export async function fetchBookedJobPaid(jobId: string): Promise<boolean> {
  const row = unwrap(await supabase.from("jobs").select("payment_status").eq("id", jobId).maybeSingle());
  const status = row?.payment_status ?? "unpaid";
  return !(NEVER_PAID_STATUSES as readonly string[]).includes(status);
}

/** Whole dollars, no cents: every quote price is a whole-dollar amount. */
export function dollars(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString("en-US")}`;
}
