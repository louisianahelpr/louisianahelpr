import { sendLovableEmail } from 'npm:@lovable.dev/email-js'
import { createClient } from 'npm:@supabase/supabase-js@2'

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
  const lovableApiKey = Deno.env.get('LOVABLE_API_KEY')
  const resendApiKey = Deno.env.get('RESEND_API_KEY')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing required environment variables')
    return new Response(
      JSON.stringify({ error: 'Server configuration error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }

  if (!lovableApiKey && !resendApiKey) {
    console.error('Neither LOVABLE_API_KEY nor RESEND_API_KEY configured')
    return new Response(
      JSON.stringify({ error: 'No email provider configured' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  // 1. Check rate-limit cooldown and read queue config
  const { data: state } = await supabase
    .from('email_send_state')
    .select('retry_after_until, batch_size, send_delay_ms, auth_email_ttl_minutes, transactional_email_ttl_minutes')
    .single()

  if (state?.retry_after_until && new Date(state.retry_after_until) > new Date()) {
    return new Response(
      JSON.stringify({ skipped: true, reason: 'rate_limited' }),
      { headers: { 'Content-Type': 'application/json' } }
    )
  }

  const batchSize = state?.batch_size ?? DEFAULT_BATCH_SIZE
  const sendDelayMs = state?.send_delay_ms ?? DEFAULT_SEND_DELAY_MS
  const ttlMinutes: Record<string, number> = {
    auth_emails: state?.auth_email_ttl_minutes ?? DEFAULT_AUTH_TTL_MINUTES,
    transactional_emails: state?.transactional_email_ttl_minutes ?? DEFAULT_TRANSACTIONAL_TTL_MINUTES,
  }

  let totalProcessed = 0

  // 2. Process auth_emails first (via Lovable), then transactional_emails (via Resend)
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
        const { data: alreadySent } = await supabase
          .from('email_send_log')
          .select('id')
          .eq('message_id', payload.message_id)
          .eq('status', 'sent')
          .maybeSingle()

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
        if (queue === 'auth_emails' && lovableApiKey) {
          // Auth emails use sendLovableEmail (run_id from webhook)
          await sendLovableEmail(
            {
              run_id: payload.run_id,
              to: payload.to,
              from: payload.from,
              sender_domain: payload.sender_domain,
              subject: payload.subject,
              html: payload.html,
              text: payload.text,
              purpose: payload.purpose,
              label: payload.label,
              external_id: payload.external_id,
              idempotency_key: payload.idempotency_key,
              unsubscribe_token: payload.unsubscribe_token,
            },
            { apiKey: lovableApiKey, sendUrl: Deno.env.get('LOVABLE_SEND_URL') }
          )
        } else if (queue === 'transactional_emails' && resendApiKey) {
          // Transactional emails use Resend directly
          await sendWithResend(resendApiKey, payload)
        } else {
          throw new Error(`No API key for queue: ${queue}`)
        }

        // Log success
        await supabase.from('email_send_log').insert({
          message_id: payload.message_id,
          template_name: payload.label || queue,
          recipient_email: payload.to,
          status: 'sent',
        })

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

        await supabase.from('email_send_log').insert({
          message_id: payload.message_id,
          template_name: payload.label || queue,
          recipient_email: payload.to,
          status: 'failed',
          error_message: errorMsg.slice(0, 1000),
        })

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

          return new Response(
            JSON.stringify({ processed: totalProcessed, stopped: 'rate_limited' }),
            { headers: { 'Content-Type': 'application/json' } }
          )
        }
      }

      // Small delay between sends
      if (i < messages.length - 1) {
        await new Promise((r) => setTimeout(r, sendDelayMs))
      }
    }
  }

  return new Response(
    JSON.stringify({ processed: totalProcessed }),
    { headers: { 'Content-Type': 'application/json' } }
  )
})