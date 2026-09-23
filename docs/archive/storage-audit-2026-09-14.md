> historical, superseded by docs/OPEN.md ([link](../OPEN.md)). Archived 2026-09-23 by Q165: nothing in it was still true and unqueued; findings checked against the source at 9a0582ecf.

# Supabase Storage audit — 2026-09-14

Report only. **Nothing was deleted.** Prod project `fncmgoasalhdgfwzhsqa`.

## Method

- Listed every object in the ten app buckets through the Storage API with the service-role key
  (`POST /storage/v1/object/list/<bucket>`, one folder level per call, 100 per page, 250 ms
  between calls). Size is `metadata.size`.
- Owning rows read once over PostgREST (`profiles id,user_id` = 60, `jobs id` = 245,
  `messages attachment_url not null` = 13) plus the auth admin user list (60 users).
- 111 requests total, no timeouts. The script is paced and aborts the run on any 20 s timeout.
- An object is an **orphan** when the row its path names no longer exists. Path schemes were read
  from the upload code:

| Bucket | Path scheme (upload site) | Owner checked |
| --- | --- | --- |
| `avatars` | `<userId>/avatar.<ext>` (`src/lib/avatarStorage.ts`, `complete-signup`), `<userId>/portfolio/<id>.<ext>` (`src/lib/portfolioStorage.ts`) | user |
| `id-documents` | `<userId>/id-document-<ts>.<ext>` (`uploadProfileFiles.ts`), `<userId>/id-<ts>.<ext>` (`Profile.tsx`) | user |
| `user-documents` | `<userId>/credentials/<kind>-<ts>.<ext>` (`CredentialsTab.tsx`), `<userId>/support/<ts>.<ext>` (`SupportInline.tsx`) | user |
| `profile-videos` | `<userId>/...` (bucket migration `20260702060000`) | user |
| `application-attachments` | `<helperId>/<jobId>/<ts>-<rand>.<ext>` (`useApplyFlow.ts`, `AppliedJobsTab.tsx`) | helper, then job |
| `proof-photos` | `<jobId>/<type>-<ts>-<rand>.<ext>` (`PhotoProof.tsx`), `<jobId>/revisions/...` (`CompletionChoiceSheet.tsx`), `<userId>/disputes/<jobId>/...` (`DisputeDialog.tsx`) | job (or user + job) |
| `job-photos` | `<jobId>/<ts>-<rand>.<ext>`, `<jobId>/scope-video.<ext>` (`useJobMediaUpload.ts`), `<userId>/reviews/...` (`ReviewForm.tsx`) | job (or user) |
| `message-attachments` | `<jobId>/<senderId>/<uuid>-<name>`, `voice-notes/<jobId>/<senderId>/<uuid>.<ext>` (`src/lib/messageAttachments.ts`) | job, then a `messages.attachment_url` referencing the path |
| `business-documents` | `<businessId>/...` (storage policy in `20260425235407`) | business — `public.businesses` no longer exists |
| `social-posts` | admin uploads, no owner convention (`20260419014532`) | none |

## Per bucket

| Bucket | Objects | Bytes | Orphans | Orphan bytes | Orphan reason | Example path |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| `user-documents` | 7 | 9,133,222 (8.7 MB) | 3 | 5,857 | user gone ×3 | `b0f6ebec-…/credentials/license-1787616796656.png` |
| `avatars` | 18 | 6,434,773 (6.1 MB) | 14 | 5,911,735 (5.6 MB) | user gone ×14 | `f53663b1-…/avatar.png` (orphan) |
| `application-attachments` | 2 | 3,584,642 (3.4 MB) | 2 | 3,584,642 | job gone ×2 | `76b07824-…/a5eed000-0000-4000-8000-000000000001/1787169573274-y83i4hi2nyg.png` |
| `id-documents` | 1 | 810,107 (0.8 MB) | 0 | 0 | — | `76b07824-…/id-document-1777828268516.png` |
| `message-attachments` | 19 | 721,712 (0.7 MB) | 6 | 720,568 | job gone ×5, unreferenced ×1 | `a22c2df1-…/71c56dfb-…/3e30e9e2-…-attachment.png` (unreferenced) |
| `proof-photos` | 19 | 624,176 (0.6 MB) | 7 | 605,240 | job gone ×7 | `d4e482f7-…/after-1788574783728-x86qvmaoz6o.png` (orphan) |
| `job-photos` | 29 | 22,098 | 0 | 0 | — | `fde2605b-…/1789269018867-udzi1ud6iwr.png` |
| `social-posts` | 0 | 0 | 0 | 0 | — | — |
| `business-documents` | 0 | 0 | 0 | 0 | — | — |
| `profile-videos` | 0 | 0 | 0 | 0 | — | — |
| **Total** | **95** | **21,330,730 (20.3 MB)** | **32** | **10,828,042 (10.3 MB)** | | |

Free tier storage is 1 GB, so the ten buckets use about 2% of it. About half the bytes are orphans.

## Findings

1. **14 of 18 avatars belong to users that no longer exist (5.6 MB, public bucket).** The account
   purge (`supabase/functions/_shared/accountPurge.ts`) sweeps `avatars`, `id-documents`,
   `user-documents`, `profile-videos` and `application-attachments` under `<userId>/`. So these
   objects came from users removed some other way (SQL deletes of seed/test users, or deletions from
   before the purge existed). Either way nothing sweeps them now. `avatars` is public, so these are
   still-served photos of deleted accounts.
2. **3 `user-documents` objects (credential scans) for users that no longer exist.** Same cause as
   finding 1. The bytes are small, but these are identity documents.
3. **Job-keyed evidence outlives deleted jobs:** 7 `proof-photos`, 5 `message-attachments` and
   2 `application-attachments`. The purge keeps job-keyed media on purpose (it is the other
   party's evidence), but that reasoning only holds while the job row exists. Once the job is gone
   nothing can reach these objects. `a5eed000-0000-4000-8000-000000000001` is a seed-pattern job
   id, so these are probably test fixtures deleted without their media.
4. **1 message attachment whose job still exists but no message points to it.** Most likely an
   upload whose message insert failed, or a deleted message. Message deletion (`Messages.tsx`
   `deleteMessage`) removes the row and not the object.
5. `business-documents` is empty and its owner table `public.businesses` is gone (PGRST205): the
   bucket is dead. `social-posts` and `profile-videos` are also empty.

## Weekly measurement

`scripts/supabase-usage-check.mjs` (workflow `supabase-usage.yml`) now sizes bucket storage the
same way: every bucket, paced at 250 ms, capped at 400 calls. A capped or failed listing reports
UNMEASURED and never a partial sum. Before this change the report said bucket storage was
unmeasured.

Open follow-ups are tracked in `docs/OPEN.md`.
