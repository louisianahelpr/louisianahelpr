/**
 * THE test-recipient predicate (Q840). Every path that can hand an address to
 * Resend asks this first, and a test or seed recipient is logged 'suppressed'
 * instead of mailed.
 *
 * Why: measured on prod 2026-09-30 (email_send_log, status='sent', last 7
 * days), 279 of 282 sent emails went to test recipients — mailinator fixture
 * inboxes and is_seed accounts — and 951 in the last 30 days. They were eating
 * the Resend plan quota that quota-monitor alarms on, for mail nobody reads.
 *
 * A recipient is a TEST recipient when either:
 *   1. its ADDRESS is a fixture address: an RFC 2606 reserved domain
 *      (`isReservedRecipient`), or the fixture inboxes the SQL
 *      `public.is_fixture_email()` names (@mailinator.com, @helpr.test,
 *      eli.test.*) — keep the two in step; or
 *   2. it belongs to a profile with `is_seed = true`. Three seed accounts use
 *      @louisianahelpr.com addresses (measured 2026-09-30), so the address
 *      alone is not enough.
 *
 * Failure policy: if the is_seed lookup ERRORS, the answer falls back to the
 * address check alone and the error is logged. That is deliberate: failing
 * closed here would stop every real user's email whenever the profiles read
 * hiccups, and the cost of failing open is one email to a seed inbox we own.
 *
 * Zero imports on purpose (beyond the zero-import reserved-domain list), so a
 * vitest can load it directly. Guard: src/test/testRecipientEmailGate.test.ts.
 */
import { isReservedRecipient } from './reservedRecipient.ts'

/** Mirrors public.is_fixture_email(text) (migration 20260926040523). */
const FIXTURE_ADDRESS = /(?:@mailinator\.com$|@helpr\.test$|^eli\.test\.)/i

/** error_message written on every suppressed row, so the log says why. */
export const TEST_RECIPIENT_REASON = 'test or seed recipient (Q840); never mailed'

/** Sync half: the address alone marks it a test recipient. */
export function isTestAddress(to: unknown): boolean {
  const list = Array.isArray(to) ? to : [to]
  return list.length > 0 &&
    list.every((t) => typeof t === 'string' && (isReservedRecipient(t) || FIXTURE_ADDRESS.test(t.trim())))
}

/**
 * The minimal supabase-js surface this needs. The parameter is typed as a bare
 * `{ from }` (not the chain below) because matching supabase-js's generic
 * builders structurally is "excessively deep" for deno check (TS2589); the
 * chain is asserted once, inside.
 */
interface ProfilesChain {
  select(cols: string): {
    eq(col: string, val: unknown): {
      eq(col: string, val: unknown): {
        limit(n: number): PromiseLike<{ data: unknown; error: { message: string } | null }>
      }
    }
  }
}
interface ProfilesReader {
  from(table: string): unknown
}

/**
 * Full predicate: fixture address, or an is_seed profile at that address.
 * `to` may be one address or a list (a list is a test send only when EVERY
 * address is a test address — a mixed list still reaches the real person).
 */
export async function isTestRecipient(
  supabase: ProfilesReader | null | undefined,
  to: unknown,
): Promise<boolean> {
  if (isTestAddress(to)) return true
  const list = (Array.isArray(to) ? to : [to]).filter((t): t is string => typeof t === 'string')
  if (list.length === 0 || !supabase) return false
  for (const addr of list) {
    // profiles.email is stored lowercased (0 of 60 mixed-case, measured
    // 2026-09-30) and carries a unique index on lower(email).
    const { data, error } = await (supabase.from('profiles') as ProfilesChain)
      .select('is_seed')
      .eq('email', addr.trim().toLowerCase())
      .eq('is_seed', true)
      .limit(1)
    if (error) {
      console.error('[testRecipient] is_seed lookup failed; using the address check only:', error.message)
      return false
    }
    const rows = Array.isArray(data) ? data : []
    if (!rows.some((r) => (r as { is_seed?: unknown })?.is_seed === true)) return false
  }
  return true
}

/**
 * Thrown by `sendWithResend` when a fixture address reaches it anyway. Callers
 * are expected to ask `isTestRecipient` first and never get here; this is the
 * last line, so a new sender that forgets cannot mail a fixture inbox.
 */
export class TestRecipientRefusedError extends Error {
  readonly status = 0
  constructor(to: unknown) {
    super(`sendWithResend refused a test recipient (${Array.isArray(to) ? to.length + ' addresses' : 'fixture address'}): ${TEST_RECIPIENT_REASON}`)
    this.name = 'TestRecipientRefusedError'
  }
}
