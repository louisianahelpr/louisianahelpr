// The app's VAPID public key (RFC 8292). Browsers bind each push subscription to
// it, and send-push-notification signs with the matching private key, which
// lives only in Supabase secrets (VAPID_PRIVATE_KEY; VAPID_PUBLIC_KEY and
// VAPID_SUBJECT beside it). A public key is safe to ship: it only identifies the
// sender. Changing it orphans every existing browser subscription (each would
// need re-subscribing), so it changes only with the secret, in one step.
export const VAPID_PUBLIC_KEY =
  "BOO7-mJchtxNyklTvTc-TG6vG2HRVXN_srpPsnQNR0y73UBdKeS8HaKELMI1JOhYmxcd38nS8fVLxCvlv6bUknE";
