import { createClient } from 'npm:@supabase/supabase-js@2'
import { verifyCronSecret } from '../_shared/cron-auth.ts'
import { cronError, cronResult, defectTracker } from '../_shared/cron-result.ts'

// Email delivery is via Resend exclusively. Helpr's auth-email-hook
// renders templates locally with @react-email/components and enqueues
// the rendered HTML/text into the auth_emails queue, where this function
// picks it up and sends via Resend like any transactional email.

const MAX_RETRIES = 5
const DEFAULT_BATCH_SIZE = 10
const DEFAULT_SEND_DELAY_MS = 200
const DEFAULT_AUTH_TTL_MINUTES = 15
const DEFAULT_TRANSACTIONAL_TTL_MINUTES = 60

function isRateLimited(error: unknown): boolean {
  if (error && typeof error === 'object' && 'status' in error) {
    return (error as { status: number }).status === 429
  }
  return error instanceof Error && error.message.includes('429')
}

function getRetryAfterSeconds(error: unknown): number {
  if (error && typeof error === 'object' && 'retryAfterSeconds' in error) {
    return (error as { retryAfterSeconds: number | null }).retryAfterSeconds ?? 60
  }
  return 60
}

// Send via Resend API for transactional emails
async function sendWithResend(apiKey: string, payload: any): Promise<void> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: payload.from,
      to: [payload.to],
      subject: payload.subject,
      html: payload.html,
      text: payload.text,
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    const err: any = new Error(`Resend API error [${res.status}]: ${body}`)
    err.status = res.status
    if (res.status === 429) {
      const retryAfter = res.headers.get('Retry-After')
      err.retryAfterSeconds = retryAfter ? parseInt(retryAfter, 10) : 60
    }
    throw err
  }
}

Deno.serve(async (req) => {
  // Cron-only: this function drains the auth + transactional email queues and
  // sends via Resend. Before this gate, verify_jwt=false in config.toml +
  // no in-handler auth meant anyone could POST and either drain the queue
  // (denying delivery to real recipients) or burn through Resend quota.
  const denied = verifyCronSecret(req)
  if (denied) return denied

  const resendApiKey = Deno.env.get('RESEND_API_KEY')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const supabaseServiceKey = (Deno.env.get('SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing required environment variables')
    return new Response(
      JSON.stringify({ error: 'Server configuration error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }

  if (!resendApiKey) {
    console.error('RESEND_API_KEY not configured — cannot send emails')
    return new Response(
      JSON.stringify({ error: 'Email provider not configured (set RESEND_API_KEY in Supabase function secrets)' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  // A Resend rejection is an OUTCOME, not a defect: a bounced or malformed
  // address fails identically forever, and this cron runs every 5 minutes, so
  // counting sends would page ~288 times a day over one bad address. Those are
  // already recorded per-row as email_send_log.status = 'failed'. Only genuine
  // breakage is tracked here.
  const defects = defectTracker()

  // 1. Check rate-limit cooldown and read queue config
  // Fail closed. `retry_after_until` is the cooldown Resend told us to observe
  // after rate-limiting us. Dropping the error meant a failed config read left
  // `state` null, the cooldown check below silently evaluated false, and this
  // worker resumed hammering the provider mid-penalty — the one moment when
  // ignoring the backoff risks the sending domain. Skip this run instead; the
  // cron fires again shortly.
  const { data: state, error: stateError } = await supabase
    .from('email_send_state')
    .select('retry_after_until, batch_size, send_delay_ms, auth_email_ttl_minutes, transactional_email_ttl_minutes')
    .single()

  if (stateError) {
    console.error('[process-email-queue] send-state read failed:', stateError.message)
    // Already non-2xx, so the sweep sees it; naming the function makes the
    // alert point at the right file.
    return cronError('process-email-queue', `send-state read failed: ${stateError.message}`, {}, 503)
  }

  if (state?.retry_after_until && new Date(state.retry_after_until) > new Date()) {
    // Observing a provider cooldown is correct behaviour, not a failure.
    return cronResult('process-email-queue', { skipped: true, reason: 'rate_limited' }, { count: 0 })
  }

  const batchSize = state?.batch_size ?? DEFAULT_BATCH_SIZE
  const sendDelayMs = state?.send_delay_ms ?? DEFAULT_SEND_DELAY_MS
  const ttlMinutes: Record<string, number> = {
    auth_emails: state?.auth_email_ttl_minutes ?? DEFAULT_AUTH_TTL_MINUTES,
    transactional_emails: state?.transactional_email_ttl_minutes ?? DEFAULT_TRANSACTIONAL_TTL_MINUTES,
  }

  let totalProcessed = 0

  // 2. Process auth_emails first, then transactional_emails — both via Resend
  for (const queue of ['auth_emails', 'transactional_emails']) {
    const dlq = `${queue}_dlq`
    const { data: messages, error: readError } = await supabase.rpc('read_email_batch', {
      queue_name: queue,
      batch_size: batchSize,
      vt: 30,
    })

    if (readError) {
      console.error('Failed to read email batch', { queue, error: readError })
      continue
    }

    if (!messages?.length) continue

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]
      const payload = msg.message

      // Drop expired messages (TTL exceeded)
      if (payload.queued_at) {
        const ageMs = Date.now() - new Date(payload.queued_at).getTime()
        const maxAgeMs = ttlMinutes[queue] * 60 * 1000
        if (ageMs > maxAgeMs) {
          console.warn('Email expired (TTL exceeded)', {
            queue,
            msg_id: msg.msg_id,
            queued_at: payload.queued_at,
            ttl_minutes: ttlMinutes[queue],
          })
          await supabase.from('email_send_log').insert({
            message_id: payload.message_id,
            template_name: payload.label || queue,
            recipient_email: payload.to,
            status: 'dlq',
            error_message: `TTL exceeded (${ttlMinutes[queue]} minutes)`,
          })
          const { error: ttlDlqError } = await supabase.rpc('move_to_dlq', {
            source_queue: queue,
            dlq_name: dlq,
            message_id: msg.msg_id,
            payload,
          })
          if (ttlDlqError) {
            console.error('Failed to move expired message to DLQ', { queue, msg_id: msg.msg_id, error: ttlDlqError })
          }
          continue
        }
      }

      // Move to DLQ if max retries exceeded
      if (msg.read_ct > MAX_RETRIES) {
        await supabase.from('email_send_log').insert({
          message_id: payload.message_id,
          template_name: payload.label || queue,
          recipient_email: payload.to,
          status: 'dlq',
          error_message: `Max retries (${MAX_RETRIES}) exceeded`,
        })
        const { error: retryDlqError } = await supabase.rpc('move_to_dlq', {
          source_queue: queue,
          dlq_name: dlq,
          message_id: msg.msg_id,
          payload,
        })
        if (retryDlqError) {
          console.error('Failed to move max-retry message to DLQ', { queue, msg_id: msg.msg_id, error: retryDlqError })
        }
        continue
      }

      // Guard: skip if another worker already sent this message
      if (payload.message_id) {
        // Fail closed: this is the ONLY thing preventing a duplicate send when
        // two workers race the same message. Dropping the error made
        // `alreadySent` null on a failed read — indistinguishable from
        // "definitely not sent yet" — so the guard waved the message through
        // and the recipient got it twice. Leave the message on the queue and
        // let the next tick re-check.
        const { data: alreadySent, error: alreadySentError } = await supabase
          .from('email_send_log')
          .select('id')
          .eq('message_id', payload.message_id)
          .eq('status', 'sent')
          .maybeSingle()

        if (alreadySentError) {
          console.error('Duplicate-send check failed; leaving message queued', {
            queue,
            msg_id: msg.msg_id,
            error: alreadySentError.message,
          })
          // The only thing standing between a racing worker and a double-send.
          // If this read is broken, mail silently stops moving.
          defects.record(`duplicate-send check ${msg.msg_id}: ${alreadySentError.message}`)
          continue
        }

        if (alreadySent) {
          console.warn('Skipping duplicate send (already sent)', {
            queue,
            msg_id: msg.msg_id,
            message_id: payload.message_id,
          })
          const { error: dupDelError } = await supabase.rpc('delete_email', {
            queue_name: queue,
            message_id: msg.msg_id,
          })
          if (dupDelError) {
            console.error('Failed to delete duplicate message from queue', { queue, msg_id: msg.msg_id, error: dupDelError })
          }
          continue
        }
      }

      try {
        // Both auth_emails and transactional_emails route through Resend.
        // The auth-email-hook function pre-renders templates to HTML/text
        // before enqueuing, so payload already has subject/html/text.
        await sendWithResend(resendApiKey, payload)

        // Log success. auth-email-hook inserts a `pending` row at enqueue
        // time with the same message_id, so prefer to UPDATE that row
        // (single canonical entry per message). Fall through to INSERT only
        // if no pending row exists (transactional_emails path that doesn't
        // pre-log).
        const { data: updatedSent } = await supabase
          .from('email_send_log')
          .update({ status: 'sent', error_message: null })
          .eq('message_id', payload.message_id)
          .in('status', ['pending', 'failed'])
          .select('id')
        if (!updatedSent || updatedSent.length === 0) {
          await supabase.from('email_send_log').insert({
            message_id: payload.message_id,
            template_name: payload.label || queue,
            recipient_email: payload.to,
            status: 'sent',
          })
        }

        // Delete from queue
        const { error: delError } = await supabase.rpc('delete_email', {
          queue_name: queue,
          message_id: msg.msg_id,
        })
        if (delError) {
          console.error('Failed to delete sent message from queue', { queue, msg_id: msg.msg_id, error: delError })
        }
        totalProcessed++
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        console.error('Email send failed', {
          queue,
          msg_id: msg.msg_id,
          read_ct: msg.read_ct,
          error: errorMsg,
        })

        // Same UPDATE-first pattern as success path: collapse the pre-logged
        // pending row into the terminal failed state instead of orphaning it.
        const { data: updatedFailed } = await supabase
          .from('email_send_log')
          .update({ status: 'failed', error_message: errorMsg.slice(0, 1000) })
          .eq('message_id', payload.message_id)
          .eq('status', 'pending')
          .select('id')
        if (!updatedFailed || updatedFailed.length === 0) {
          await supabase.from('email_send_log').insert({
            message_id: payload.message_id,
            template_name: payload.label || queue,
            recipient_email: payload.to,
            status: 'failed',
            error_message: errorMsg.slice(0, 1000),
          })
        }

        if (isRateLimited(error)) {
          const retryAfterSecs = getRetryAfterSeconds(error)
          await supabase
            .from('email_send_state')
            .update({
              retry_after_until: new Date(
                Date.now() + retryAfterSecs * 1000
              ).toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('id', 1)

          return cronResult(
            'process-email-queue',
            { processed: totalProcessed, stopped: 'rate_limited' },
            defects.defects,
          )
        }
      }

      // Small delay between sends
      if (i < messages.length - 1) {
        await new Promise((r) => setTimeout(r, sendDelayMs))
      }
    }
  }

  return cronResult('process-email-queue', { processed: totalProcessed }, defects.defects)
})