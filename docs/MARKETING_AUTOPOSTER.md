# Social auto-poster — setup

Posts written by the `/lh-marketing` agent team land in `marketing_content` as
drafts. You review them in **Admin → Marketing**, attach an image, and schedule.
A cron then posts them to the Facebook Page and Instagram account below.

Nothing posts until you do three things: set the secrets, flip the kill switch
on, and enable the channel. All three default to off.

---

## 0. Before you start — the one thing that can't be worked around

**Instagram must be a Business or Creator account, linked to your Facebook Page.**
There is no API that can post to a personal Instagram account — not this one,
not any third-party scheduler. If your IG is personal, convert it first:

> Instagram app → Settings → Account type and tools → Switch to professional
> account → then link it to your Facebook Page.

**Every Instagram post needs an image.** There is no text-only IG post. The
database enforces this: an Instagram row cannot be scheduled with no media. You
make the image (Canva), upload it in the admin UI, and it goes to a public
bucket so Meta's servers can fetch it.

Facebook has neither restriction — text-only Page posts are fine.

---

## 1. Create a Meta app

1. <https://developers.facebook.com/apps> → **Create App** → type **Business**.
2. Note the **App ID** and **App Secret** (Settings → Basic).

**You do NOT need App Review.** App Review is required to act on *other
people's* Pages. While the app stays in **Development mode**, it can act on
assets owned by its own admins — which is you, on your own Page. That is the
whole setup.

---

## 2. Get a long-lived Page token

This is the fiddly part, and the order matters. The goal is a **Page** token
derived from a **long-lived User** token — that combination is the one that
does not expire.

**a. Short-lived user token.** Graph API Explorer
(<https://developers.facebook.com/tools/explorer>), select your app, and request
these permissions:

```
pages_show_list
pages_read_engagement
pages_manage_posts
instagram_basic
instagram_content_publish
business_management
```

Click **Generate Access Token** and approve. Copy it.

**b. Exchange it for a long-lived user token** (60 days):

```
GET https://graph.facebook.com/v21.0/oauth/access_token
  ?grant_type=fb_exchange_token
  &client_id=<APP_ID>
  &client_secret=<APP_SECRET>
  &fb_exchange_token=<SHORT_LIVED_TOKEN>
```

**c. Get the Page token** using the long-lived user token from (b):

```
GET https://graph.facebook.com/v21.0/me/accounts?access_token=<LONG_LIVED_USER_TOKEN>
```

The response lists your Pages. Take `id` (→ `META_PAGE_ID`) and `access_token`
(→ `META_PAGE_ACCESS_TOKEN`).

> **This step is the whole trick.** A Page token obtained from a *long-lived*
> user token has no expiry. A Page token obtained from a *short-lived* one
> expires in about an hour, and everything will appear to work until it
> silently stops. If posting dies a day later, this is why — redo (b) then (c).

**d. Get the Instagram user id:**

```
GET https://graph.facebook.com/v21.0/<PAGE_ID>?fields=instagram_business_account&access_token=<PAGE_TOKEN>
```

`instagram_business_account.id` → `META_IG_USER_ID`. If this comes back empty,
the IG account is not a Business account or is not linked to the Page — go back
to step 0.

---

## 3. Set the secrets

```bash
supabase secrets set \
  META_PAGE_ID=<page id> \
  META_PAGE_ACCESS_TOKEN=<page token> \
  META_IG_USER_ID=<ig user id>
```

**Check which project you are linked to first.** `supabase/.temp/project-ref`
has pointed at *staging* before, and secrets set against the wrong project look
exactly like secrets that were never set.

---

## 4. Turn it on

Admin → Marketing:

1. Enable the channels you want (a channel that is off stays off even with a
   valid token).
2. Set the daily cap. Default is **2 posts per channel per Louisiana day** —
   the window is Central time, not UTC, so a cap of 2 can't become 4 posts in
   one evening.
3. Flip **auto-publish on**. Read the confirmation: with this on, posts go to
   your public accounts on schedule with no further review.

**The kill switch is the stop button.** Turning it off is instant and takes
effect on the next dispatch. Turning it on asks for confirmation.

---

## 5. When it breaks — because tokens do

A dead token is a *silent* failure: posting simply stops and nothing tells you.
`marketing-token-health` runs on a schedule and alerts through the existing ops
channel when the token is invalid or expiring, and when scheduled posts are
overdue but nothing is draining.

If you get that alert, redo **step 2b–2c**. A Page token can be invalidated by a
Facebook password change, a permissions change, or removing the app — none of
which produce an error anywhere else.

### Things that will look like bugs and are not

| Symptom | Cause |
|---|---|
| IG post fails, FB fine | Missing image, caption over 2200 chars, or over 30 hashtags |
| `instagram_business_account` empty | IG is personal, or not linked to the Page |
| Everything stops after ~1 hour | Page token came from a short-lived user token (step 2b skipped) |
| Everything stops after ~60 days | Long-lived *user* token expired before the Page token was minted |
| Nothing posts, no errors | Kill switch off, channel not enabled, or daily cap reached |

---

## What the system will not do

- **It will not invent facts.** The agent team is bound by a truthfulness rule:
  no earnings figures, ratings, testimonials, response times, user counts, or
  safety guarantees unless sourced from the live database or supplied by you in
  writing. This is a marketplace that holds other people's money; a fabricated
  "helpers earn $X a week" is a legal exposure, not a copy choice.
- **It will not make images.** You do that in Canva. Agents write a visual brief
  alongside every Instagram caption saying what to make.
- **It will not post twice.** Three independent guards: an atomic claim, an
  attempt counter, and a unique constraint on the platform's own post id.
