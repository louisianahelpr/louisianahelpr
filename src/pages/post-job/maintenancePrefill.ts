import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { maintenanceCategory } from "@/lib/rentals/copy";
import type { JobCategory } from "@/lib/jobCategories";

/**
 * Rentals S1 (docs/specs/landlord-hub-prep.md Q39): an APPROVED maintenance
 * request opens Post a Job pre-filled (`/post-job?maintenance=<request id>`).
 * The landlord checks the price and pays like any new post (same fees, same
 * checkout); link_maintenance_request_job then points the request at the job.
 * Nothing is posted or charged before the landlord does it here
 * (src/test/noJobRowBeforePayment.test.ts). The STR turnover twin is
 * turnoverPrefill.ts.
 */

export interface MaintenancePrefill {
  category: JobCategory;
  title: string;
  description: string;
  /** Always "": the landlord sets the price (a pre-filled maximum anchors it; lh-money-escrow review #5). */
  budget: string;
  /** The auto-approve limit in dollars, shown as a hint only; null when none. */
  autoApproveLimit: string | null;
  /** The job the request already points at (funded or paying), to send the landlord there. */
  linkedJobId: string | null;
  location: string;
  /** The tenant's gate/lock info (Q41): goes into the job's private access notes. */
  accessNotes: string;
  /** Already linked to a live (not settled) job: offer nothing to post. */
  alreadyPosted: boolean;
  /** Not approved (submitted, declined, withdrawn): nothing to post. */
  notApproved: boolean;
}

interface RequestRow {
  id: string;
  status: string;
  category: string;
  description: string;
  urgency: string;
  access_windows: string;
  pets_on_site: boolean;
  ok_to_enter_alone: boolean;
  access_notes: string;
  property_address: string;
  property_label: string;
  unit_label: string;
  approved_budget_cents: number | null;
  job_id: string | null;
  landlord_id?: string | null;
  jobs?: { status: string; payment_status: string | null; stripe_session_id?: string | null } | null;
}

const MONEY_BACK = new Set(["refunded", "cancelled"]);
const NEVER_FUNDED = new Set(["unpaid", "failed", "abandoned"]);
/**
 * Not settled = live: the link RPC's own rule (20261017220911, one live job per
 * request). Settled is money back ('refunded' / 'cancelled'), or a CANCELLED job
 * that was never funded with no checkout that could still complete. Anything
 * else (funded, mid-checkout, open and still payable, chargeback, cancelling)
 * keeps the request on its job.
 */
function isLive(j: RequestRow["jobs"]): boolean {
  if (!j) return false;
  const pay = j.payment_status ?? "unpaid";
  if (MONEY_BACK.has(pay)) return false;
  if (j.status === "cancelled" && NEVER_FUNDED.has(pay) && (!j.stripe_session_id || pay === "abandoned")) return false;
  return true;
}
/** public.jobs CHECKs (Q782): title <= 32 and description <= 1000 code points. */
const fit = (s: string, n: number) => Array.from(s).slice(0, n).join("").trim();

/** The job a request pre-fills. Pure. */
export function buildMaintenancePrefill(row: RequestRow): MaintenancePrefill {
  const cat = maintenanceCategory(row.category);
  const shortLabel = cat.label.replace(/\s*\(.*\)\s*$/, "");
  const where = [row.property_label, row.unit_label].filter(Boolean).join(", ");
  // PUBLIC description (browse shows it to anyone): the problem and pets only.
  // When someone may come in and whether the tenant is home go in the PRIVATE
  // access notes only the booked Helpr reads (lh-authz-rls review #4).
  const lines = [row.description, "", "Rental repair.", row.pets_on_site ? "Pets are on site." : ""].filter(
    (l, i) => l !== "" || i === 1,
  );
  const privateNotes = [
    `Rental repair at ${where}.`,
    row.access_windows ? `When someone may come in: ${row.access_windows}` : "",
    row.ok_to_enter_alone ? "The tenant is OK with the Helpr entering without them." : "The tenant wants to be home for the visit.",
    row.access_notes ?? "",
  ].filter(Boolean);
  return {
    category: cat.jobCategory,
    title: fit(`${shortLabel} repair`, 32),
    description: fit(lines.join("\n"), 1000),
    budget: "",
    autoApproveLimit: row.approved_budget_cents != null ? String(row.approved_budget_cents / 100) : null,
    linkedJobId: row.job_id != null && isLive(row.jobs) ? row.job_id : null,
    location: row.property_address,
    accessNotes: fit(privateNotes.join("\n"), 1000),
    alreadyPosted: row.job_id != null && isLive(row.jobs),
    notApproved: row.status !== "approved",
  };
}

/** Read the landlord's own request. Null when not visible, or when the caller is
 *  not its landlord (RLS also lets the tenant read it; lh-money-escrow review #4). */
export async function fetchMaintenancePrefill(requestId: string): Promise<MaintenancePrefill | null> {
  const { data: auth } = await supabase.auth.getUser();
  const row = unwrap(
    await supabase
      .from("maintenance_requests")
      .select(
        "id, status, category, description, urgency, access_windows, pets_on_site, ok_to_enter_alone, access_notes, property_address, property_label, unit_label, approved_budget_cents, job_id, landlord_id, jobs(status, payment_status, stripe_session_id)",
      )
      .eq("id", requestId)
      .maybeSingle(),
  ) as RequestRow | null;
  if (!row || !auth?.user || row.landlord_id !== auth.user.id) return null;
  return buildMaintenancePrefill(row);
}

/** Point the request at the job just posted from it. Best effort, like linkTurnoverJob. */
export async function linkMaintenanceJob(requestId: string, jobId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("link_maintenance_request_job", { p_request_id: requestId, p_job_id: jobId });
  if (error) throw error;
  return data === true;
}
