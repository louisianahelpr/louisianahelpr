# E2E fixtures & gates

## Seeded two-role identities
- **Poster**: the owner's own account (lexilombas05@gmail.com) — log in normally.
- **Helper**: `eli.test.helper@louisianahelpr.com` — auth user bound to profile
  id 6bdc1f67-ae1f-46a0-8edf-4035629a6147 ("Audit Helper"). No password: mint a
  one-time login with `bash scripts/e2e/mint-helper-login.sh` (writes the magic
  link to /tmp/lh-helper-magiclink.txt). NOTE: the ORIGINAL seed Eli
  (user_id 11111111-1111-1111-1111-111111111104, owns the seeded jobs/messages)
  has NO auth user — creating one with that id collides with the profile
  trigger (500). Use the Audit Helper identity for driving, and the seed graph
  read-only.

## Two-origin trick
The dev server is one process, three origins — `localhost`, `127.0.0.1`, and
`[::1]` — each with isolated storage. Poster on localhost, helper on
127.0.0.1, guest on [::1]: three sessions, one server, zero sign-out risk.

## Stripe sandbox
`stripe-sandbox-on.sh` (owner-run; prompts for sk_test) flips the edge
functions to test mode and creates a test webhook endpoint;
`stripe-sandbox-off.sh` restores live. Test card: 4242 4242 4242 4242.
