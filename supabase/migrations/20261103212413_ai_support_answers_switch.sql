-- AI help on support requests (owner 2026-11-03 3:30 PM: "integrate AI into support/help requests, because some
-- you can easily answer or Claude can"; Builder 70 via the lead). Created 'testers' (a switch is never born
-- 'everyone'); 20261103214000 turns it on for everyone right after (owner rule 2026-10-25 via the lead). The switch
-- stays as the off button in Admin -> Settings.
--
-- Gates the support-ai-answer edge function (requireFeature for the verified caller) and, in the app, the
-- suggested answer on /support (Support.tsx) and the "Suggest a reply" button in Admin Support
-- (SupportReply.tsx), both useFeature("ai_support_answers"). No table, no RPC: nothing the AI writes is stored,
-- and it sends nothing (the admin sends through admin-support-reply as before).
INSERT INTO public.feature_switches (key, audience, description)
VALUES ('ai_support_answers', 'testers',
        'Claude suggests an answer from the Help Center before a support ticket is sent, and drafts a reply in Admin Support for the admin to edit and send')
ON CONFLICT (key) DO NOTHING;
