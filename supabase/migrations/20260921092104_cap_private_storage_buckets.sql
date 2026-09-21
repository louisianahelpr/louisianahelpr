-- Four private buckets accepted a file of ANY size and ANY type.
--
-- Measured on prod 2026-09-21 while proving `storageBucketLimits` able to fail:
--
--   application-attachments   file_size_limit NULL   allowed_mime_types NULL
--   id-documents              NULL                   NULL
--   proof-photos              NULL                   NULL
--   user-documents            NULL                   NULL
--
-- `message-attachments` is ALSO private and carries both caps (5 MB, an explicit
-- type list), so this is an oversight rather than a policy decision about private
-- buckets. `storageBucketLimits` only judges buckets that end up `public`, so it
-- was green on all four.
--
-- WHAT IT ALLOWED. Any authenticated caller holding an INSERT policy on these
-- buckets could upload an executable, or a file large enough to eat the
-- free-tier storage quota. Not world-readable, which is why it is a cost and
-- malware-hosting exposure rather than a disclosure one.
--
-- THE LIMITS ARE DELIBERATELY LOOSER THAN THE CLIENT, so nothing legitimate
-- breaks. Every one of these surfaces already refuses more than 5 MB in the
-- browser:
--   Profile.tsx:452             id-documents            5 MB + jpeg/png/webp/pdf
--   SupportInline.tsx:143       user-documents          5 MB
--   AppliedJobsTab.tsx:161      application-attachments 5 MB
--   DisputeDialog.tsx:359       proof-photos            accept="image/*"
-- A 10 MB server cap is twice the client's ceiling: a user who somehow gets past
-- the client is still bounded, and no existing upload path can exceed it.
--
-- image/heic is included wherever a camera roll is the source — an iPhone photo
-- arrives as HEIC, and `Profile.tsx:508` records that a previous looser
-- `startsWith("image/")` check was TIGHTENED for exactly this reason, so the
-- server list has to admit what the client now sends.

update storage.buckets
   set file_size_limit    = 10485760,  -- 10 MB
       allowed_mime_types = array['image/jpeg','image/png','image/webp','image/heic','application/pdf']
 where id in ('id-documents', 'user-documents', 'application-attachments')
   and public is not true;

-- proof-photos is camera evidence for a dispute: images only, no documents.
update storage.buckets
   set file_size_limit    = 10485760,  -- 10 MB
       allowed_mime_types = array['image/jpeg','image/png','image/webp','image/heic']
 where id = 'proof-photos'
   and public is not true;
