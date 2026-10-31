/**
 * Declutter "Add a Helpr" (owner 2026-10-16; docs/specs/declutter-add-a-helpr.md).
 *
 * A buyer who paid for a Declutter item taps one choice (move it to their
 * place, put it together, hang it on the wall, set it up) and lands on Post a
 * Job pre-filled
 * (`/post-job?declutterOrder=<order id>&help=<kind>`). They confirm and pay
 * through the normal job checkout: the job is an ordinary Helpr job. Right
 * after the post is created, declutter_link_setup_job points the order at it
 * (20261017073146), the same shape as an STR turnover (turnoverPrefill.ts).
 *
 * The server decides who may do this (the order's buyer, paid or handed over
 * within 30 days, switch 'declutter_add_helpr'); this file only builds words.
 */
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { rpcErrorMessage } from "@/lib/lifecycleErrors";
import { LISTED_PAYMENT_STATUSES } from "../../../supabase/functions/_shared/listedPaymentStatus";

export type SetupKind = "move" | "assemble" | "mount" | "setup";

export const SETUP_KINDS: readonly SetupKind[] = ["move", "assemble", "mount", "setup"];

/** The job categories a choice pre-fills. */
export type SetupJobCategory = "moving" | "assembly" | "handyman";

/** The button words, the job category and the job words for each choice. */
export const SETUP_KIND_INFO: Record<SetupKind, { button: string; category: SetupJobCategory; titleVerb: string; need: string }> = {
  // GROW-5 (owner 2026-10-29, "Need help moving it?"): the Declutter way into Jobs. A buyer
  // collecting a big item from the seller books a Helpr to move it to their place.
  move: { button: "Move it to my place", category: "moving", titleVerb: "Move", need: "moved from the seller's place to mine" },
  assemble: { button: "Put it together", category: "assembly", titleVerb: "Put together", need: "put together" },
  mount: { button: "Hang it on the wall", category: "handyman", titleVerb: "Wall-mount", need: "hung on the wall" },
  setup: { button: "Set it up", category: "handyman", titleVerb: "Set up", need: "set up" },
};

/** What each item can need (audit #27: "Put it together" was offered on a mug). A category listed here offers those
 *  choices at any size; any other category offers all three only when the item is bigger than small. */
const KINDS_BY_CATEGORY: Record<string, readonly SetupKind[]> = {
  furniture: ["assemble", "mount"],
  baby_kids: ["assemble"],
  outdoor_garden: ["assemble"],
  sports_outdoors: ["assemble"],
  home_decor: ["mount"],
  electronics: ["mount", "setup"],
  appliances: ["setup"],
};

/**
 * The choices an order's items fit, in SETUP_KINDS order; with no item details (an older server) every choice.
 * "Move it" (GROW-5) is offered only when the buyer collects the item themselves (any handover but Helpr or seller
 * delivery, which already bring it) and something in the order is too big for a car (large or xl).
 */
export function setupKindsFor(details: SetupItemDetail[] | undefined, handover?: SetupHelprInfo["handover"]): SetupKind[] {
  // AUD31-8: a seller who delivers brings it too, so no "Move it" there either.
  const canMove = handover !== "delivery" && handover !== "seller_delivery";
  if (!details || details.length === 0) return SETUP_KINDS.filter((k) => k !== "move" || canMove);
  const fit = new Set<SetupKind>();
  if (canMove && details.some((d) => d.delivery_size === "large" || d.delivery_size === "xl")) fit.add("move");
  for (const d of details) {
    const kinds = KINDS_BY_CATEGORY[d.category] ?? (d.delivery_size === "small" ? [] : SETUP_KINDS.filter((k) => k !== "move"));
    kinds.forEach((k) => fit.add(k));
  }
  return SETUP_KINDS.filter((k) => fit.has(k));
}

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
  /** How the item reaches the buyer: pickup at the seller's home, porch pickup, Helpr delivery (20261017055505) or
   *  the seller's own delivery (20261027153244). */
  handover: "pickup_home" | "porch" | "delivery" | "seller_delivery";
  items: string[];
  /** Each item's category and size, in the order of items (20261028 setup-Helpr item details); absent on an older server. */
  item_details?: SetupItemDetail[];
  pickup_at: string | null;
  jobs: SetupJob[];
}

export interface SetupItemDetail {
  title: string;
  category: string;
  delivery_size: "small" | "large" | "xl";
}

/** The browse surfaces' funded set: a job Helprs can see (same rule as turnoverPrefill). */
// Q2399: a held card is listed too.
const FUNDED = new Set<string>(LISTED_PAYMENT_STATUSES);

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
  category: SetupJobCategory;
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
  // Moving: the Helpr collects it at the seller's on the pickup day and brings it home.
  const description = kind === "move"
    ? `I bought ${what} on Declutter and need it ${k.need}.${dateNeeded ? ` Pickup is on ${dateNeeded}.` : ""} Please bring a truck or van big enough for it.`
    : `I bought ${what} on Declutter and need it ${k.need} at my place.${when} Please bring your own tools.`;
  return {
    title: fitWords(`${k.titleVerb} ${items[0]}`, 32),
    description: fit(description, 1000),
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
    // Pass every handover the server has through as it is (money review of
    // a98e0049d6: 'delivery' was read as 'pickup_home'). An unknown value is
    // read as the plain seller's-home pickup, the original handover.
    handover: raw.handover === "porch" || raw.handover === "delivery" || raw.handover === "seller_delivery" ? raw.handover : "pickup_home",
    items: Array.isArray(raw.items) ? raw.items : [],
    item_details: Array.isArray(raw.item_details) ? raw.item_details : undefined,
    pickup_at: raw.pickup_at ?? null,
    jobs: Array.isArray(raw.jobs) ? raw.jobs : [],
  };
}

/**
 * Point the order at the job just posted from it. Best effort, like the STR
 * turnover link: the job is posted either way; a failed link only means the
 * order card does not list it. True = linked.
 *
 * Called only by useJobSubmit, right after the job row is created and BEFORE
 * its checkout, so the job is never paid for yet. The server refuses a job
 * that is already paid for (job_already_funded): the link is for the job just
 * posted from this order, not for pinning an older paid job onto the order
 * card. A refusal is thrown with its words in `userMessage` (RPC_ERROR_COPY).
 */
export async function linkSetupJob(orderId: string, jobId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("declutter_link_setup_job", { p_order_id: orderId, p_job_id: jobId });
  if (error) {
    const msg = rpcErrorMessage("declutter_link_setup_job", error);
    throw Object.assign(new Error(error.message), { code: (error as { code?: string }).code, userMessage: msg ?? undefined });
  }
  return data === true;
}
