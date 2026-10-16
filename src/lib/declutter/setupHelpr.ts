/**
 * Declutter "Add a Helpr" (owner 2026-10-16; docs/specs/declutter-add-a-helpr.md).
 *
 * A buyer who paid for a Declutter item taps one choice (put it together, hang
 * it on the wall, set it up) and lands on Post a Job pre-filled
 * (`/post-job?declutterOrder=<order id>&help=<kind>`). They confirm and pay
 * through the normal job checkout: the job is an ordinary Helpr job. Right
 * after the post is created, declutter_link_setup_job points the order at it
 * (20261016053527), the same shape as an STR turnover (turnoverPrefill.ts).
 *
 * The server decides who may do this (the order's buyer, paid or handed over
 * within 30 days, switch 'declutter_add_helpr'); this file only builds words.
 */
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { rpcErrorMessage } from "@/lib/lifecycleErrors";

export type SetupKind = "assemble" | "mount" | "setup";

export const SETUP_KINDS: readonly SetupKind[] = ["assemble", "mount", "setup"];

/** The button words, the job category and the job words for each choice. */
export const SETUP_KIND_INFO: Record<SetupKind, { button: string; category: "assembly" | "handyman"; titleVerb: string; need: string }> = {
  assemble: { button: "Put it together", category: "assembly", titleVerb: "Put together", need: "put together" },
  mount: { button: "Hang it on the wall", category: "handyman", titleVerb: "Wall-mount", need: "hung on the wall" },
  setup: { button: "Set it up", category: "handyman", titleVerb: "Set up", need: "set up" },
};

export function parseSetupKind(v: string | null | undefined): SetupKind {
  return SETUP_KINDS.includes(v as SetupKind) ? (v as SetupKind) : "assemble";
}

export interface SetupJob {
  job_id: string;
  title: string;
  category: string;
  status: string;
  payment_status: string | null;
}

export interface SetupHelprInfo {
  order_id: string;
  status: "paid" | "handed_over";
  handover: "pickup_home" | "porch";
  items: string[];
  pickup_at: string | null;
  jobs: SetupJob[];
}

/** The browse surfaces' funded set: a job Helprs can see (same rule as turnoverPrefill). */
const FUNDED = new Set(["escrow", "payout_pending", "released"]);

/** A linked job counts as booked once it is paid for and not cancelled. */
export function isBookedSetupJob(j: Pick<SetupJob, "status" | "payment_status">): boolean {
  return j.status !== "cancelled" && FUNDED.has(j.payment_status ?? "");
}

/** public.jobs CHECKs (Q782): title <= 32 and description <= 1000 code points. */
const fit = (s: string, n: number) => Array.from(s).slice(0, n).join("").trim();

/** Like `fit`, but a title never ends on half a word. */
function fitWords(s: string, n: number): string {
  const chars = Array.from(s.trim());
  if (chars.length <= n) return chars.join("");
  const cut = chars.slice(0, n).join("");
  if (chars[n] === " ") return cut.trim();
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim();
}

/** The Louisiana calendar day (YYYY-MM-DD) of an instant. */
export function louisianaYmd(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

export interface SetupJobPrefill {
  title: string;
  description: string;
  category: "assembly" | "handyman";
  /** The pickup day when it is today or later (Louisiana), else "" (the buyer picks). */
  dateNeeded: string;
}

/** The job a choice pre-fills. Pure. `todayYmd` is the Louisiana date today. */
export function buildSetupJobPrefill(info: Pick<SetupHelprInfo, "items" | "pickup_at">, kind: SetupKind, todayYmd: string): SetupJobPrefill {
  const k = SETUP_KIND_INFO[kind];
  const items = info.items.length > 0 ? info.items : ["an item"];
  const what = items.length === 1 ? items[0] : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
  const pickupDay = info.pickup_at ? louisianaYmd(info.pickup_at) : "";
  const dateNeeded = pickupDay && pickupDay >= todayYmd ? pickupDay : "";
  const when = dateNeeded ? ` I pick it up on ${dateNeeded}, so any time after that works.` : "";
  return {
    title: fitWords(`${k.titleVerb} ${items[0]}`, 32),
    description: fit(
      `I bought ${what} on Declutter and need it ${k.need} at my place.${when} Please bring your own tools.`,
      1000,
    ),
    category: k.category,
    dateNeeded,
  };
}

/** The buyer's own paid order: items, pickup time and the jobs already linked. */
export async function fetchSetupHelpr(orderId: string): Promise<SetupHelprInfo> {
  const result = await supabase.rpc("declutter_setup_helpr", { p_order_id: orderId });
  if (result.error) {
    const msg = rpcErrorMessage("declutter_setup_helpr", result.error);
    try {
      unwrap(result);
    } catch (thrown) {
      const e = thrown as Error & { userMessage?: string };
      if (msg && Object.isExtensible(e)) e.userMessage = msg;
      throw e;
    }
  }
  const raw = (result.data ?? {}) as unknown as Partial<SetupHelprInfo>;
  return {
    order_id: raw.order_id ?? orderId,
    status: raw.status === "handed_over" ? "handed_over" : "paid",
    handover: raw.handover === "porch" ? "porch" : "pickup_home",
    items: Array.isArray(raw.items) ? raw.items : [],
    pickup_at: raw.pickup_at ?? null,
    jobs: Array.isArray(raw.jobs) ? raw.jobs : [],
  };
}

/**
 * Point the order at the job just posted from it. Best effort, like the STR
 * turnover link: the job is posted either way; a failed link only means the
 * order card does not list it. True = linked.
 */
export async function linkSetupJob(orderId: string, jobId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("declutter_link_setup_job", { p_order_id: orderId, p_job_id: jobId });
  if (error) {
    const msg = rpcErrorMessage("declutter_link_setup_job", error);
    throw Object.assign(new Error(error.message), { code: (error as { code?: string }).code, userMessage: msg ?? undefined });
  }
  return data === true;
}
