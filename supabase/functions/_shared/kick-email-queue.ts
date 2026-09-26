// Q258: an auth email (signup confirm, password reset, magic link) has a
// person staring at their inbox. Enqueueing it and leaving it for the
// process-email-queue cron ('3-58/5 * * * *') made them wait for the next
// tick: measured on prod 2026-09-26 over the last 60 days of auth emails
// (72 messages), 156 s on average and up to 299 s before the send even began.
//
// kickEmailQueue asks process-email-queue to drain NOW. The cron is still the
// safety net: if the kick fails, the email goes out on the next tick exactly as
// before, so a failed kick is logged, never thrown. Two workers draining at once
// (a kick and a cron tick) is already safe: pgmq's visibility timeout hands each
// message to one reader, and the worker skips messages already logged 'sent'.
//
// The request runs in the background (EdgeRuntime.waitUntil when the runtime
// offers it) so the Auth hook answers immediately; Auth times the hook out.

type EdgeRuntimeLike = { waitUntil?: (p: Promise<unknown>) => void }

export function kickEmailQueue(reason: string): void {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) {
    console.warn('[kickEmailQueue] no SUPABASE_URL or service key; the cron will send it', { reason })
    return
  }
  const run = fetch(`${url}/functions/v1/process-email-queue`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ kick: reason }),
    signal: AbortSignal.timeout(25_000),
  })
    .then(async (res) => {
      if (!res.ok) console.warn('[kickEmailQueue] drain answered', res.status, { reason, body: (await res.text()).slice(0, 200) })
    })
    .catch((err) => {
      // Not silent: logged, and the 5-minute cron still sends the email.
      console.warn('[kickEmailQueue] drain request failed; the cron will send it', { reason, error: err instanceof Error ? err.message : String(err) })
    })
  const rt = (globalThis as { EdgeRuntime?: EdgeRuntimeLike }).EdgeRuntime
  if (rt?.waitUntil) rt.waitUntil(run)
}
