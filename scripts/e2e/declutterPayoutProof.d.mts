export const PROOF_TAG: string;
export const TEST_BANK: Readonly<{ routing_number: string; account_number: string }>;
export type ProofState = {
  runId: string;
  startedAt?: string;
  users: { seller?: string; buyer?: string };
  accountId: string | null;
  [k: string]: unknown;
};
export type ProofProfileRow = { user_id: string; email?: string | null; is_seed?: boolean | null; [k: string]: unknown };
export function testKeyRefusal(key: string | undefined | null): string | null;
export function newRunId(now?: Date, rand?: string): string;
export function proofEmail(runId: string, role: "seller" | "buyer"): string;
export function profileRefusal(
  row: ProofProfileRow | null | undefined,
  state: ProofState,
  role: "seller" | "buyer",
  opts?: { enrolledIds?: Set<string> | null },
): string | null;
export function accountRefusal(
  acct: { id: string; livemode?: boolean; metadata?: Record<string, string> } | null | undefined,
  state: ProofState,
): string | null;
export function isCustomAccountsDisabled(err: { type?: string; message?: string } | null | undefined): boolean;
export function buyerFeeCents(itemsCents: number): number;
export function transferProblems(
  transfer: Record<string, unknown> | null | undefined,
  ctx: { accountId: string; payout: { id: string; order_id: string; amount_cents: number }; chargeId?: string | null; priceCents: number },
): string[];
export function stripeForm(obj: Record<string, unknown>, prefix?: string, out?: URLSearchParams): URLSearchParams;
export function pickupSlot(now?: Date): string;
export function restoreVerdict(
  drift: { report?: Record<string, { matched?: number; missing?: Array<{ id: string }> }> } | null | undefined,
  ids: { paymentIntent?: string; transfer?: string },
): { problems: string[]; others: string[] };
export function closeAfterFailure(c: unknown, state: ProofState): Promise<void>;
export function unlinkRun(c: unknown, state: ProofState): Promise<void>;
