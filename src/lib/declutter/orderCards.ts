/**
 * Declutter "My orders" in one read (builder 1, 2026-11-15; handoff builder4b-1115 section 1b).
 *
 * The Buying and Selling lists, their order cards and the panels inside them each asked the server per order:
 * declutter_my_handover, declutter_order_problem, declutter_refund_request_view and the order row for the other
 * person's id. For an account with 11 orders one /declutter?tab=buying load made about 77 requests (the
 * abuse-journeys request budget). The handover and refund reads are also never "fresh" (orderFreshness), so every
 * card and panel that mounts reads them again.
 *
 * Every one of those per-order reads now goes through `orderCardPart`: the reads asked in the same tick are sent as
 * ONE declutter_my_order_cards(ids) call (20261115185143), which answers the caller's own orders only, each part being
 * the per-order function's own answer. Reads in a later tick make their own call: a result is never reused across
 * ticks, so a read after a change (an invalidation) always asks the server again.
 *
 * The per-order function is still asked, alone, when the batch has no answer for that order: an order the caller is
 * not on (an admin's read, a stranger: the per-order read keeps its own error), a handover read on an order that is
 * neither paid nor handed over, a refund read while the switch is off (both keep the per-order function's error), the
 * batch read failing, and while the batch read is not on the server yet (PGRST202, then not asked again this session).
 *
 * Guard: src/test/declutterOrderListBatchRead.test.ts (the number of calls the list makes).
 */
import { supabase } from "@/integrations/supabase/client";
import { isMissingRpcNamed } from "@/lib/missingRpc";

/** One order's row in declutter_my_order_cards. The parts are the per-order reads' own JSON. */
export interface OrderCardRow {
  order_id: string;
  other_id: string | null;
  handover: unknown;
  problem: unknown;
  refund: unknown;
}

export type OrderCardKind = "handover" | "problem" | "refund" | "other";

const BATCH_RPC = "declutter_my_order_cards";
/** The server's cap (too_many_orders above it). */
const ORDER_CARDS_MAX_IDS = 200;

let notDeployed = false;
let pending: Map<string, Array<(row: OrderCardRow | null | undefined) => void>> | null = null;

/** undefined: the batch gave no answer at all (failed or not deployed); null: answered, but not the caller's order. */
async function sendBatch(ids: string[]): Promise<Map<string, OrderCardRow> | undefined> {
  if (notDeployed) return undefined;
  try {
    const res = await supabase.rpc("declutter_my_order_cards", { p_order_ids: ids });
    if (res?.error) {
      if (isMissingRpcNamed(res.error, BATCH_RPC)) notDeployed = true;
      else console.warn("[declutter] order cards read failed; asking per order", res.error.message);
      return undefined;
    }
    if (!Array.isArray(res?.data)) return undefined;
    return new Map((res.data as unknown as OrderCardRow[]).filter((r) => r && typeof r.order_id === "string").map((r) => [r.order_id, r]));
  } catch (e) {
    // The per-order reads that follow report their own failure; this only says the batch was skipped.
    console.warn("[declutter] order cards read threw; asking per order", e);
    return undefined;
  }
}

function flush(): void {
  const batch = pending;
  pending = null;
  if (!batch) return;
  const ids = [...batch.keys()];
  for (let i = 0; i < ids.length; i += ORDER_CARDS_MAX_IDS) {
    const chunk = ids.slice(i, i + ORDER_CARDS_MAX_IDS);
    void sendBatch(chunk).then((rows) => {
      for (const id of chunk) for (const done of batch.get(id) ?? []) done(rows ? rows.get(id) ?? null : undefined);
    });
  }
}

/** The order's batch row (null: not the caller's order; undefined: no batch answer). Coalesced per tick. */
function loadOrderCardRow(orderId: string): Promise<OrderCardRow | null | undefined> {
  return new Promise((resolve) => {
    if (!pending) {
      pending = new Map();
      queueMicrotask(flush);
    }
    const waiting = pending.get(orderId);
    if (waiting) waiting.push(resolve);
    else pending.set(orderId, [resolve]);
  });
}

/**
 * One part of an order's card, from the tick's batch read; `direct` (the per-order read) when the batch has no answer
 * for it. `nullMeansAsk`: a null part means the per-order read would refuse (handover, refund), so it is asked and its
 * own error stands; for a problem, null is the answer (the order has none).
 */
export async function orderCardPart<T>(orderId: string, kind: OrderCardKind, direct: () => Promise<T>): Promise<T> {
  const row = await loadOrderCardRow(orderId);
  if (!row) return direct();
  if (kind === "other") return (row.other_id ?? null) as T;
  const part = row[kind];
  if (part == null && kind !== "problem") return direct();
  return (part ?? null) as T;
}

/** Tests only: forget a PGRST202 seen earlier and any read waiting for its tick. */
export function __resetOrderCardsForTests(): void {
  notDeployed = false;
  pending = null;
}
