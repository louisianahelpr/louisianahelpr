-- 25 Days of Louisiana Giveaways: reminder words for the new entry method (owner 2026-11-21, Sat ~7 PM, via the lead).
-- Owner: "All the rules will be on Facebook not our website." The entry method changed the same night: each day is its
-- own entry, explained on that day's Facebook post. The reminders seeded by 20261119200128 said the opposite ("Enter
-- once for a chance at all 25 days", "One entry covers every day left"), so they are reworded. They still never say HOW
-- people enter (no share/tag/follow steps): the push opens /25days, which points at the Facebook post.
--
-- Prod read 2026-11-21 (execute_sql, read-only): all seven rows still hold the 20261119200128 words (updated_at
-- 2026-11-20 00:00:39Z), none sent yet (the first is due 2026-11-30 18:00 Louisiana time).
-- Each UPDATE only touches a row whose message is still the old seeded text, so a row the owner has since edited keeps
-- her words, and a replay changes nothing. last_chance ("Last chance! Only a few days of giveaways left") stays as is.
-- MONEY: none. AUTHZ: none (data only, service_role table). REPLAY-SAFE: guarded UPDATEs.
-- Proof: src/test/pglite/giveawayReminders.pglite.mjs (applied 3x) and src/test/giveawayReminders.test.tsx.

UPDATE public.giveaway_reminders
   SET message = '🎄 25 Days of Louisiana Giveaways starts tomorrow! A new giveaway every day. Tap for details.',
       updated_at = now()
 WHERE key = 'starts_tomorrow'
   AND message = '🎄 25 Days of Louisiana Giveaways starts tomorrow! Enter once for a chance at all 25 days. Tap to see how.';

UPDATE public.giveaway_reminders
   SET message = 'It''s here! Enter today''s Louisiana giveaway. There''s a new one every day through December 25 🎁',
       updated_at = now()
 WHERE key = 'its_here'
   AND message = 'It''s here! Enter once and you''re in for all 25 days of Louisiana giveaways 🎁';

UPDATE public.giveaway_reminders
   SET message = 'It''s not too late! Enter today''s 25 Days of Louisiana Giveaways for a chance to win.',
       updated_at = now()
 WHERE key IN ('not_too_late_dec5', 'not_too_late_dec10', 'not_too_late_dec15', 'not_too_late_dec19')
   AND message = 'It''s not too late! Enter our 25 Days of Louisiana Giveaways. One entry covers every day left.';
