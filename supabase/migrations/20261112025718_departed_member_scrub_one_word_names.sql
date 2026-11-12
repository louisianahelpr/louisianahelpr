-- Departed-member scrub, handoff item 5 (lead 11-11): ONE-WORD names. scrub_departed_member_name_from_notifications()
-- returned early for a member whose name has no space, so a one-word name ("Rose") stayed in other members' notices
-- after they deleted their account. Prod had 1 non-test profile with a one-word name (of 275, measured read-only by the
-- previous lane). Design from that lane's measurement: whole word, case-sensitive, at least 2 letters, capitalised,
-- not a stopword (the capitalised words notice templates in the migrations and edge functions start with, plus month and weekday names: 302 words today),
-- and only at the START of a title or message (not followed by an initial), the place every template puts a name.
-- Leftover risk, accepted: a one-word name with an accent (under a C collation), a hyphen or an apostrophe fails the
-- capitalised-letters test and stays (never wrongly replaced); user text at the very start of a notice tied to that member that begins with the same word.
-- The manager-mode step (20261112024127) runs for one-word names too (its patterns are already anchored).
--
-- 1. NEW public.departed_name_stopwords() -> text[] (immutable, service_role only).
-- 2. scrub_departed_member_name_from_notifications() restated VERBATIM from
--    20261112024127_departed_member_scrub_manager_first_name.sql (trigger from 20261103022806 unchanged), changes
--    marked "CHANGED 20261112025718".
-- Replay-safe: CREATE OR REPLACE; grants restated by role name.
-- Proof: src/test/pglite/departedScrubOneWordNames.pglite.mjs. Sensitive: privacy (another member's name).

-- The words a one-word name must not be (CHANGED 20261112025718): every capitalised word a notice template in the migrations
-- or edge function starts a literal with (scanned by src/test/departedScrubOneWordNames.test.ts, which fails when a new one is missing),
-- plus month and weekday names. Immutable, no table read; not callable by clients.
CREATE OR REPLACE FUNCTION public.departed_name_stopwords()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT ARRAY[
    'About', 'Accept', 'Accepted', 'Account', 'Active', 'Admin', 'Affected', 'Agreed', 'All', 'Amount', 'An', 'Another', 'Answer', 'Apple',
    'Application', 'Approval', 'Approved', 'Apr', 'April', 'Arrival', 'Attachment', 'Aug', 'August', 'Auth', 'Back', 'Background', 'Ban', 'Bank',
    'Banned', 'Bonus', 'Both', 'Bring', 'Bundle', 'Business', 'Buyer', 'Cancel', 'Cancellation', 'Cancelled', 'Card', 'Carrier', 'Charge', 'Chargeback',
    'Charging', 'Check', 'Checkout', 'Choose', 'Claims', 'Clawback', 'Cleaning', 'Client', 'Closing', 'Confirm', 'Contact', 'Could', 'Couldn', 'Counter',
    'Credential', 'Crew', 'Cron', 'Custom', 'Daily', 'Dead', 'Dec', 'December', 'Declutter', 'Dedupe', 'Deliver', 'Delivered', 'Delivery', 'Deposit',
    'Did', 'Dispute', 'Disputed', 'Don', 'Donation', 'Download', 'Duplicate', 'Dy', 'Each', 'Earlier', 'Either', 'Elite', 'Email', 'Enjoy',
    'Escrow', 'Every', 'Exempt', 'Expired', 'Failed', 'Feb', 'February', 'Finding', 'Finish', 'Forwarding', 'Free', 'Fri', 'Friday', 'From',
    'Full', 'Gave', 'General', 'Geocoded', 'Gift', 'Give', 'Group', 'Guests', 'Half', 'Handover', 'Held', 'Helper', 'Helpr', 'Helprs',
    'Home', 'Homes', 'Identity', 'Idle', 'If', 'Instant', 'Insurance', 'Issue', 'It', 'Item', 'Its', 'Jan', 'January', 'Job',
    'Jul', 'July', 'Jun', 'June', 'Lapsed', 'Late', 'Lease', 'Let', 'License', 'Listing', 'Listings', 'Live', 'Liveness', 'Lost',
    'Louisiana', 'Mar', 'March', 'Marketing', 'Materials', 'May', 'Meet', 'Membership', 'Meta', 'Missed', 'Mon', 'Monday', 'Money', 'Neither',
    'New', 'Next', 'No', 'Nobody', 'Nominatim', 'Not', 'Nothing', 'Notification', 'Nov', 'November', 'Now', 'Oct', 'October', 'Offer',
    'On', 'Only', 'Open', 'Order', 'Original', 'Others', 'Our', 'Owed', 'Ownership', 'Paid', 'Part', 'Partial', 'Pay', 'Payment',
    'Payout', 'Payouts', 'Permit', 'Persisted', 'Phone', 'Pick', 'Picked', 'Pickup', 'Platform', 'Please', 'Porch', 'Posted', 'Poster', 'Preorder',
    'Price', 'Problem', 'Prod', 'Profiles', 'Property', 'Public', 'Put', 'Quick', 'Quote', 'Quotes', 'Reading', 'Real', 'Recurring', 'Referral',
    'Refund', 'Refunded', 'Removed', 'Rent', 'Repair', 'Repeat', 'Report', 'Reported', 'Request', 'Reserved', 'Reset', 'Restriction', 'Return', 'Revision',
    'Rising', 'Road', 'Rows', 'Sale', 'Sales', 'Sat', 'Saturday', 'Save', 'Saved', 'Scheduled', 'See', 'Send', 'Sent', 'Sep',
    'Sept', 'September', 'Session', 'Set', 'Setup', 'Shipping', 'Shops', 'Signature', 'Silent', 'Sold', 'Some', 'Someone', 'Something', 'Start',
    'Stranded', 'Stripe', 'Subscription', 'Sun', 'Sunday', 'Support', 'Take', 'Tap', 'Taxable', 'Taxed', 'Tenancy', 'Tenant', 'Test', 'Thank',
    'Thanks', 'That', 'The', 'These', 'They', 'This', 'Thu', 'Thursday', 'Time', 'Tip', 'Trade', 'Transfer', 'Try', 'Tue',
    'Tuesday', 'Under', 'Unread', 'Unrecorded', 'Untagged', 'Upcoming', 'User', 'Verification', 'Verified', 'Verify', 'Visit', 'Visits', 'Wait', 'Waiting',
    'We', 'Wed', 'Wednesday', 'When', 'Where', 'Work', 'You', 'Your',
    -- Spanish edge-function titles/messages on main (lander 11-12, the guard's scan after rebasing onto #4427):
    'Enter', 'Escriba', 'Recibimos', 'Se', 'Toque'
  ]::text[];
$fn$;
REVOKE ALL ON FUNCTION public.departed_name_stopwords() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.departed_name_stopwords() TO service_role;

CREATE OR REPLACE FUNCTION public.scrub_departed_member_name_from_notifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_full text := btrim(coalesce(OLD.full_name, ''));
  v_name text;
  v_rx text;
  v_one_word boolean; -- CHANGED 20261112025718: the departed member's name is one word.
  v_first text; -- CHANGED 20261112024127: the first word of member_display_name, as declutter_manager_first_name says it.
  v_esc text;        -- CHANGED 20261112024127: v_first, regex-escaped.
  v_rx_share text;   -- CHANGED 20261112024127: "You earned $X from <First>'s sale of".
  v_rx_split text;   -- CHANGED 20261112024127: "· $X to <First> (10%) · $Y".
BEGIN
  -- CHANGED 20261112025718: a ONE-WORD name ("Rose") is scrubbed too, but only where it cannot be an ordinary word: at least 2
  -- letters, capitalised, not one of the capitalised words notice templates start with or a month/weekday name
  -- (public.departed_name_stopwords(); src/test/departedScrubOneWordNames.test.ts rebuilds that list from the
  -- migrations), and only at the START of a title or message (whole word, case-sensitive, not followed by an initial),
  -- which is where every template puts a name. Before this, any one-word name returned here untouched.
  IF OLD.anonymized_at IS NOT NULL OR NEW.anonymized_at IS NULL OR v_full = '' THEN
    RETURN NEW;
  END IF;
  v_one_word := v_full !~ '\s';
  IF v_one_word AND (v_full !~ '^[[:upper:]][[:alpha:]]+$' OR v_full = ANY (public.departed_name_stopwords())) THEN
    RETURN NEW;
  END IF;
  -- Longest first: the full name, then its "First L." form.
  FOREACH v_name IN ARRAY ARRAY[v_full, public.member_display_name(OLD.full_name, NULL)] LOOP
    CONTINUE WHEN v_name IS NULL OR v_name = '';
    -- CHANGED 20261112025718: a one-word name matches only at the start, not followed by an initial.
    v_rx := CASE WHEN v_one_word THEN '^' ELSE '\m' END
            || regexp_replace(v_name, '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g') || '(?!\w)'
            || CASE WHEN v_one_word THEN '(?! \w\.)' ELSE '' END;
    UPDATE public.notifications n
       -- CHANGED 20261112005443: also capitalised after a sentence end ("No money changes hands. A former member ...").
       SET title   = regexp_replace(regexp_replace(regexp_replace(n.title, '^' || v_rx, 'A former member'),
                       '([.!?]\s+)' || v_rx, '\1A former member', 'g'), v_rx, 'a former member', 'g'),
           message = regexp_replace(regexp_replace(regexp_replace(n.message, '^' || v_rx, 'A former member'),
                       '([.!?]\s+)' || v_rx, '\1A former member', 'g'), v_rx, 'a former member', 'g')
     WHERE n.user_id IS DISTINCT FROM OLD.user_id
       AND (coalesce(n.title, '') ~ v_rx OR coalesce(n.message, '') ~ v_rx)
       -- CHANGED 20261112005443: a job notice tied to the departed member as before, OR (Declutter) a notice with no
       -- job whose link is a Declutter page, sent to someone who traded with the departed member on Declutter.
       AND ((n.job_id IS NOT NULL
       AND (EXISTS (SELECT 1 FROM public.jobs j
                     WHERE j.id = n.job_id AND OLD.user_id IN (j.customer_id, j.helper_id))
         OR EXISTS (SELECT 1 FROM public.applications a
                     WHERE a.job_id = n.job_id AND a.helper_id = OLD.user_id)
         OR EXISTS (SELECT 1 FROM public.group_job_helpers g
                     WHERE g.job_id = n.job_id AND g.helper_id = OLD.user_id)
         -- Q2331 review (lh-authz-rls, 11-03): a series Helpr is a party to the series parent through these
         -- rows, not through jobs/applications/group_job_helpers, so "Bea T. gave up <date>" (job_id = the
         -- parent) left her name in the poster's bell. purge_user_data deletes none of them before 4e.
         OR EXISTS (SELECT 1 FROM public.recurring_visit_releases r
                     WHERE r.parent_job_id = n.job_id AND r.helper_id = OLD.user_id)
         OR EXISTS (SELECT 1 FROM public.series_date_offers o
                     WHERE o.parent_job_id = n.job_id AND o.helper_id = OLD.user_id)
         OR EXISTS (SELECT 1 FROM public.series_visit_holds h
                     WHERE h.parent_job_id = n.job_id AND h.helper_id = OLD.user_id)))
         OR (n.job_id IS NULL
             AND coalesce(n.link, '') LIKE '/declutter%'
             AND (EXISTS (SELECT 1 FROM public.declutter_offers o
                           WHERE (o.buyer_id = OLD.user_id AND o.seller_id = n.user_id)
                              OR (o.seller_id = OLD.user_id AND o.buyer_id = n.user_id))
               OR EXISTS (SELECT 1 FROM public.declutter_swap_offers s
                           WHERE (s.buyer_id = OLD.user_id AND s.seller_id = n.user_id)
                              OR (s.seller_id = OLD.user_id AND s.buyer_id = n.user_id))
               OR EXISTS (SELECT 1 FROM public.declutter_cart_items c
                           WHERE (c.buyer_id = OLD.user_id AND c.seller_id = n.user_id)
                              OR (c.seller_id = OLD.user_id AND c.buyer_id = n.user_id))
               OR EXISTS (SELECT 1 FROM public.declutter_orders d
                           WHERE (d.buyer_id = OLD.user_id AND d.seller_id = n.user_id)
                              OR (d.seller_id = OLD.user_id AND d.buyer_id = n.user_id))
               OR EXISTS (SELECT 1 FROM public.declutter_bundle_requests b
                           WHERE (b.buyer_id = OLD.user_id AND b.seller_id = n.user_id)
                              OR (b.seller_id = OLD.user_id AND b.buyer_id = n.user_id))
               OR EXISTS (SELECT 1 FROM public.declutter_free_requests f
                           WHERE (f.requester_id = OLD.user_id AND f.seller_id = n.user_id)
                              OR (f.seller_id = OLD.user_id AND f.requester_id = n.user_id)))))
       AND NOT (coalesce(n.link, '') LIKE '/admin%'
                AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = n.user_id AND ur.role = 'admin'));
  END LOOP;
  -- CHANGED 20261112024127: Declutter manager-mode notices name the other side by FIRST NAME only ("Ann listed "Lamp" for you",
  -- "Ann is managing your Declutter", "Ann stopped managing ..."; declutter_manager_first_name, 20261101181005), which
  -- neither form above matches. Only these exact places are rewritten, in a Declutter notice (no job, link
  -- '/declutter%') sent to a member who has a declutter_manager_grants row with the departed member on the other side
  -- (seller or manager, any status; purge_user_data deletes no grant before step 4e):
  --   * the first name at the very START of the title or message, not followed by an initial ("Ann O." is someone
  --     else: the departed member's own "Ann S." was already rewritten by the loop above) -> "A former member";
  --   * the manager's share notice "You earned $X from Ann's sale of ..." (20261109224952) -> "from a former member's";
  --   * the seller's handover split "... · $X to Ann (10%) · $Y to you." (20261109224952) -> "to a former member".
  v_first := split_part(coalesce(public.member_display_name(OLD.full_name, NULL), ''), ' ', 1);
  IF v_first <> '' THEN
    v_esc := regexp_replace(v_first, '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g');
    v_rx := '^' || v_esc || '(?!\w)(?! \w\.)';
    v_rx_share := '(You earned \$[0-9.]+ from )' || v_esc || '(?=''s sale of )';
    v_rx_split := '( · \$[0-9.]+ to )' || v_esc || '(?=( \([0-9]+%\))? · \$)';
    UPDATE public.notifications n
       SET title   = regexp_replace(n.title, v_rx, 'A former member'),
           message = regexp_replace(regexp_replace(regexp_replace(n.message, v_rx, 'A former member'),
                       v_rx_share, '\1a former member'), v_rx_split, '\1a former member', 'g')
     WHERE n.user_id IS DISTINCT FROM OLD.user_id
       AND (coalesce(n.title, '') ~ v_rx OR coalesce(n.message, '') ~ v_rx
            OR coalesce(n.message, '') ~ v_rx_share OR coalesce(n.message, '') ~ v_rx_split)
       AND n.job_id IS NULL
       AND coalesce(n.link, '') LIKE '/declutter%'
       AND EXISTS (SELECT 1 FROM public.declutter_manager_grants g
                    WHERE (g.seller_id = OLD.user_id AND g.manager_id = n.user_id)
                       OR (g.manager_id = OLD.user_id AND g.seller_id = n.user_id));
  END IF;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.scrub_departed_member_name_from_notifications() FROM PUBLIC, anon, authenticated;
