---
name: Saved Helpers + Direct Offer
description: Posters can heart helpers to save them, then send a private 24-hour direct job offer that's invisible to everyone else.
type: feature
---

- Surfaces the existing `favorite_helpers` table via `SaveHelperButton` (heart) on `/user/:id` and the new `/saved-helpers` page.
- New jobs columns: `offered_to_helper_id`, `direct_offer_status` (`pending|accepted|declined|expired`), `direct_offer_expires_at`.
- `open_jobs_browse` view hides pending direct offers from non-targeted helpers; once `declined`/`expired`, the job becomes public.
- Trigger `notify_helper_on_direct_offer` pings the targeted helper instantly with link to `/activity?tab=offers`.
- `expire_pending_direct_offers()` RPC flips stale offers to `expired` and notifies the poster — wire to a cron later.
- PostJob accepts `?offerTo=<helperId>` query param: shows banner, sets the 3 fields on insert, defaults to a 24-hour window.
- `get_my_saved_helpers()` RPC returns saved helpers enriched with `completed_jobs_together` + `last_job_at` for the Saved Helprs page.
