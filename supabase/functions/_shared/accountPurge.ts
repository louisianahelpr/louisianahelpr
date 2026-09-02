/**
 * Account deletion, in one place, for all three callers.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 * There are three ways an account leaves this platform — the user asks
 * (`delete-own-account`), an admin removes them (`admin-delete-user`), or the
 * abandoned-signup cron sweeps them (`cleanup-abandoned-accounts`) — and until
 * now all three did the same one thing: call `auth.admin.deleteUser` and hope.
 *
 * Measured against prod on 2026-08-31, that one call:
 *   * FAILED for 10 of 31 accounts with a raw `23503`, which the user saw as
 *     `violates foreign key constraint "jobs_helper_id_fkey"`;
 *   * left the deleted user's **government ID scan** in `id-documents/<uid>/`
 *     and their avatar in the PUBLIC `avatars` bucket, still returning HTTP 200
 *     to an anonymous fetch;
 *   * left a message reading "my address is 123 Elm St, call 555-0142" in
 *     `messages` with a dangling `sender_id` (that table has no FK at all);
 *   * never cancelled the Stripe subscription, so a deleted account kept
 *     billing.
 *
 * Having three copies of a fix this shaped is how the `job_status` enum bug
 * survived in `admin-delete-user` for a day after `delete-own-account` was
 * fixed. So there is one implementation, here.
 *
 * ── Ordering, and why it is this order ──────────────────────────────────────
 * A half-deleted account is worse than either end state, so the steps are
 * ordered such that EVERY intermediate state is coherent and a retry from any
 * point lands in the same place:
 *
 *   1. Cancel Stripe billing.   Failing later must not leave money moving.
 *   2. Purge identity storage.  The ID scan and avatar are the highest-harm
 *                               artifacts; they go before anything can block.
 *   3. purge_user_data() RPC.   One transaction: erases PII rows, redacts the
 *                               profile and the funded jobs, stamps the payout
 *                               ledger. All-or-nothing.
 *   4. auth.admin.deleteUser.   FK CASCADE / SET NULL finishes the job.
 *
 * If step 4 fails, the account is already stripped of every identifying field
 * and every stored document, and re-running lands on the same result — rather
 * than a user who saw an error and still has their licence on our servers.
 * Every step is individually idempotent.
 */

/**
 * Structural, not `SupabaseClient`.
 *
 * The three callers do not agree on a specifier — `delete-own-account` and
 * `admin-delete-user` construct their client from `npm:@supabase/supabase-js@2`,
 * this file was originally typed against `https://esm.sh/@supabase/supabase-js@2`,
 * and TypeScript treats those as two unrelated classes even at identical
 * versions (`Property 'supabaseUrl' is protected but type ... is not a class
 * derived from ...`). Rather than force every caller onto one specifier — a
 * change with a real runtime footprint for a purely type-level complaint —
 * this declares only the surface actually used. It also documents that surface:
 * three methods, no more.
 *
 * The builder return types are deliberately `any`. Spelling them out
 * structurally made the checker try to reconcile PostgREST's builder generics
 * against a hand-written twin and it gave up with TS2589 ("Type instantiation
 * is excessively deep and possibly infinite"). The safety is not lost, only
 * moved: every awaited result below is annotated at the point of use with
 * `PostgrestLike` / `StorageListLike`, so the fields this file actually reads
 * are still checked. What `any` buys is that the boundary stops caring which
 * copy of the SDK a caller happens to hold.
 */
interface PurgeCapableClient {
  // deno-lint-ignore no-explicit-any
  from(table: string): any;
  // deno-lint-ignore no-explicit-any
  // deno-lint-ignore no-explicit-any
  rpc(fn: string, args: Record<string, unknown>): any;
  storage: {
    // deno-lint-ignore no-explicit-any
    from(bucket: string): any;
  };
}

/** The shape of every PostgREST/RPC result this file reads. */
interface PostgrestLike<T> {
  data: T | null;
  error: { message: string; code?: string } | null;
}
/** The shape of every Storage list/remove result this file reads. */
interface StorageListLike {
  data: { name: string }[] | null;
  error: { message: string } | null;
}

/**
 * Buckets holding media that identifies the PERSON. These are erased.
 *
 * Deliberately NOT in this list: `job-photos`, `proof-photos`,
 * `message-attachments` and `business-documents`. Those are keyed by job or
 * business, not by user, and they are evidence attached to a record that
 * survives — a completed job, a settled dispute. Deleting them would destroy
 * the counterparty's evidence to satisfy this user's request, which is the
 * same mistake as cascading their reviews away.
 */
const IDENTITY_BUCKETS = [
  "avatars",
  "id-documents",
  "user-documents",
  "profile-videos",
  "application-attachments",
] as const;

export interface PurgeStep {
  step: string;
  ok: boolean;
  detail: string;
}

export interface PurgeOutcome {
  ok: boolean;
  steps: PurgeStep[];
  /** Human, actionable message when ok === false. Safe to show a user. */
  userMessage?: string;
  /**
   * Why it failed, when the caller needs to treat one cause differently.
   *
   * `rpc_not_deployed` exists for the deploy-lag window: migrations ship on
   * merge to main, so there is a period where this edge function is live and
   * `purge_user_data` is not. Everything correctly refuses to delete during
   * it — but that is a DEFERRAL, not a fault, and the abandoned-accounts cron
   * would otherwise report a page-worthy error for every candidate it skipped
   * on the day of the deploy. A cron that cries wolf once teaches everyone to
   * ignore it the next time.
   */
  reason?: "rpc_not_deployed" | "storage_failed" | "database_failed" | "stripe_failed";
}

/**
 * The job states that mean a counterparty still has work, money or a claim in
 * flight. Deleting either party here strands the other one.
 *
 * ⚠️ Every value MUST be a real member of the `job_status` enum:
 *   open | accepted | in_progress | completed | cancelled |
 *   revision_requested | disputed | pending_approval
 * Postgres rejects the WHOLE query with 22P02 "invalid input value for enum
 * job_status" if any listed value is not a member — and because every caller
 * fails closed on that error, ONE bad value makes deletion return 500 for
 * EVERY user, including users with no jobs at all. That is exactly what
 * happened: the list carried `arrived` (a `job_tracking.status` value) and
 * `awaiting` (which exists nowhere).
 */
const LIVE_STATUS_FILTER =
  "status.in.(accepted,in_progress,revision_requested,disputed)," +
  "payment_status.in.(escrow,payout_pending)";

export interface ActiveWorkResult {
  /** False means we could not determine it — the caller must fail closed. */
  ok: boolean;
  /** True when the account is party to live work and must not be deleted. */
  active: boolean;
  detail?: string;
}

/**
 * Is this account party to an in-flight job or holding money in escrow?
 *
 * ── Why this lives here rather than in each caller ──────────────────────────
 * `delete-own-account` and `admin-delete-user` each carried their own copy of
 * this guard, with a comment in one of them promising they were "kept
 * byte-identical so the two guards cannot drift again". They had already
 * drifted: the enum bug above was fixed in one and left in the other for a
 * day, during which admin deletion returned 500 for every target. A comment is
 * not a mechanism. One implementation is.
 *
 * ── Why it takes two queries ────────────────────────────────────────────────
 * A GROUP job's roster lives in `group_job_helpers`, not in `jobs.helper_id` —
 * only the lead helper is ever written to the job row. So a second, third or
 * fourth helper on a live, escrow-funded group job looked completely job-free
 * to the single-table version of this check and could delete their account
 * mid-job, leaving the poster short-handed with the money still held and no
 * party left to release it to. The roster is read first, then its job ids are
 * tested against the same live-status filter, so the two paths cannot disagree
 * about what "live" means.
 */
/**
 * The id reaches a PostgREST `.or()` filter STRING, a storage list prefix and an
 * RPC argument. Only `admin-delete-user` took its id from a request body, and
 * only `admin-delete-user` validated it — which put the check in one caller
 * rather than in the module that builds the filter. Nothing is exploitable
 * today; this is so it stays that way when a fourth caller appears.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function findActiveWork(
  admin: PurgeCapableClient,
  userId: string,
): Promise<ActiveWorkResult> {
  if (!UUID_RE.test(userId)) {
    console.error("[accountPurge] findActiveWork called with a non-UUID id");
    return { ok: false, active: false, detail: "userId is not a UUID" };
  }
  // 1. Jobs where this user is the poster or the (lead) helper.
  //    `.or(...).or(...)` ANDs the two clauses: (I'm a party) AND (it's live).
  const direct: PostgrestLike<{ id: string }[]> = await admin
    .from("jobs")
    .select("id")
    .or(`customer_id.eq.${userId},helper_id.eq.${userId}`)
    .or(LIVE_STATUS_FILTER)
    .limit(1);

  if (direct.error) {
    console.error(`[accountPurge] active-job check failed for ${userId}:`, direct.error.message);
    return { ok: false, active: false, detail: direct.error.message };
  }
  if (direct.data && direct.data.length > 0) {
    return { ok: true, active: true, detail: `job ${direct.data[0].id}` };
  }

  // 2. Group-job rosters. Read the memberships, then test THOSE jobs.
  // 201, not 200: a page that comes back FULL is indistinguishable from a page
  // that was truncated, and silently truncating this read would hand back
  // "no live work" for a helper whose live group job happened to fall off the
  // end. Reading one more than the cap makes truncation detectable, and the
  // branch below fails closed on it rather than guessing.
  const ROSTER_CAP = 200;
  const roster: PostgrestLike<{ job_id: string }[]> = await admin
    .from("group_job_helpers")
    .select("job_id")
    .eq("helper_id", userId)
    .limit(ROSTER_CAP + 1);

  if (roster.error) {
    // A missing table is not a reason to refuse a deletion forever, but any
    // other failure is — we cannot prove the account is safe to remove.
    if (/does not exist|42P01|PGRST205/i.test(`${roster.error.code ?? ""} ${roster.error.message}`)) {
      return { ok: true, active: false, detail: "group_job_helpers absent" };
    }
    console.error(`[accountPurge] roster check failed for ${userId}:`, roster.error.message);
    return { ok: false, active: false, detail: roster.error.message };
  }

  const rosterRows = roster.data ?? [];
  if (rosterRows.length > ROSTER_CAP) {
    console.error(`[accountPurge] roster read for ${userId} hit the ${ROSTER_CAP}-row cap`);
    return {
      ok: false,
      active: false,
      detail: `group roster exceeded ${ROSTER_CAP} rows — cannot prove the account is free of live work`,
    };
  }

  const jobIds = [...new Set(rosterRows.map((r) => r.job_id).filter(Boolean))];
  if (jobIds.length === 0) return { ok: true, active: false };

  const grouped: PostgrestLike<{ id: string }[]> = await admin
    .from("jobs")
    .select("id")
    .in("id", jobIds)
    .or(LIVE_STATUS_FILTER)
    .limit(1);

  if (grouped.error) {
    console.error(`[accountPurge] group-job check failed for ${userId}:`, grouped.error.message);
    return { ok: false, active: false, detail: grouped.error.message };
  }
  if (grouped.data && grouped.data.length > 0) {
    return { ok: true, active: true, detail: `group job ${grouped.data[0].id}` };
  }

  return { ok: true, active: false };
}

/**
 * Cancel any live Stripe subscription so a deleted account stops billing.
 *
 * Best-effort by design, and that is a deliberate trade-off rather than a
 * swallowed error: if Stripe is unreachable we would rather complete the
 * deletion (the legally-required act) and leave a loud log line than refuse to
 * delete someone's account because a third party is down. The failure is
 * recorded in the returned steps, never dropped.
 */
async function cancelStripeSubscription(
  admin: PurgeCapableClient,
  userId: string,
  steps: PurgeStep[],
): Promise<void> {
  const secret = Deno.env.get("STRIPE_SECRET_KEY");
  if (!secret) {
    steps.push({ step: "stripe", ok: true, detail: "no STRIPE_SECRET_KEY configured — skipped" });
    return;
  }

  // `stripe_subscription_id` / `stripe_customer_id` arrived in
  // 20260901011254_stripe_subscription_linkage_and_tier_lockdown.sql. Until
  // that migration lands in every environment the columns may not exist, and
  // PostgREST answers 42703/PGRST204 for the WHOLE select — which would take
  // the entire deletion down with it. Ask for them separately and degrade.
  let subscriptionId: string | null = null;
  const linkage: PostgrestLike<{ stripe_subscription_id: string | null }> = await admin
    .from("profiles")
    .select("stripe_subscription_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (linkage.error) {
    // Not fatal: an older schema simply has no subscription pointer to read.
    steps.push({
      step: "stripe",
      ok: true,
      detail: `subscription linkage unreadable (${linkage.error.code ?? "?"}: ${linkage.error.message}) — nothing to cancel`,
    });
    return;
  }
  subscriptionId = linkage.data?.stripe_subscription_id ?? null;

  if (!subscriptionId) {
    steps.push({ step: "stripe", ok: true, detail: "no active subscription on file" });
    return;
  }

  try {
    const Stripe = (await import("https://esm.sh/stripe@18.5.0")).default;
    const stripe = new Stripe(secret, { apiVersion: "2025-08-27.basil" });
    await stripe.subscriptions.cancel(subscriptionId);
    steps.push({ step: "stripe", ok: true, detail: `cancelled ${subscriptionId}` });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Already-cancelled and already-deleted are SUCCESS for our purposes:
    // the goal is "this account is not billing", and it isn't. Treating them
    // as failures would make a retry permanently un-completable.
    if (/No such subscription|already canceled|already cancelled/i.test(msg)) {
      steps.push({ step: "stripe", ok: true, detail: `already cancelled (${subscriptionId})` });
      return;
    }
    console.error(`[accountPurge] Stripe cancel failed for ${userId}:`, msg);
    steps.push({ step: "stripe", ok: false, detail: `cancel failed: ${msg}` });
  }
}

/**
 * Delete every object under `<userId>/` in each identity bucket.
 *
 * Idempotent: a second run lists nothing and removes nothing. Note that
 * `storage.remove()` returns `{ data: [], error: null }` for paths that do not
 * exist — a null error here genuinely does not mean anything was removed,
 * which is why the count comes from the LIST, not from the remove.
 */
/**
 * Every FILE under a prefix, recursing into sub-prefixes.
 *
 * Supabase Storage has no real directories: `list(prefix)` returns one row per
 * immediate child, and a sub-prefix comes back as a pseudo-row with `id: null`
 * and no metadata. That distinction is load-bearing here, because
 * `remove(["<uid>/portfolio"])` — a prefix, not an object — deletes nothing
 * and still answers `{ error: null }`.
 *
 * A flat, non-recursive version of this shipped and was doubly wrong. It never
 * erased anything nested, and three of the five identity buckets nest:
 *   avatars/<uid>/portfolio/…                 (usePortfolio.ts)
 *   user-documents/<uid>/credentials/…        (CredentialsTab.tsx)
 *   user-documents/<uid>/support/…            (SupportInline.tsx)
 *   application-attachments/<uid>/<jobId>/…   (AppliedJobsTab.tsx)
 * And because the verification re-list then still saw the untouched folder, it
 * reported failure — permanently, for anyone who had ever uploaded a portfolio
 * photo or a credential. The flat objects beside it (the avatar, the ID scan)
 * WERE deleted first, so every retry left the account further half-purged
 * while still telling the user to try again. Recursing fixes both halves.
 */
async function listAllObjects(
  admin: PurgeCapableClient,
  bucket: string,
  prefix: string,
): Promise<string[]> {
  const found: string[] = [];
  const queue: string[] = [prefix];
  // Depth is bounded by the paths above (<uid>/<folder>/<file>); the guard is
  // for a malformed tree, not a legitimate one.
  let visited = 0;

  while (queue.length > 0 && visited < 500) {
    const current = queue.shift()!;
    visited++;
    const { data, error }: StorageListLike = await admin.storage
      .from(bucket)
      .list(current, { limit: 1000 });
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) continue;

    for (const entry of data) {
      const path = `${current}/${entry.name}`;
      // `id === null` marks a sub-prefix rather than a stored object.
      if ((entry as { id?: string | null }).id == null) {
        queue.push(path);
      } else {
        found.push(path);
      }
    }

    // A full page means there may be more; Storage caps `list` at 1000 and
    // silently truncates rather than erroring, so say so instead of reporting
    // a clean purge over an unread remainder.
    if (data.length >= 1000) {
      throw new Error(
        `listing ${bucket}/${current} hit the 1000-object page limit — refusing to claim a complete purge`,
      );
    }
  }

  if (queue.length > 0) {
    throw new Error(`listing ${bucket}/${prefix} exceeded the traversal bound`);
  }
  return found;
}

async function purgeIdentityStorage(
  admin: PurgeCapableClient,
  userId: string,
  steps: PurgeStep[],
  extraPaths: { bucket: string; paths: string[] }[] = [],
): Promise<boolean> {
  let allOk = true;
  let totalRemoved = 0;
  const failures: string[] = [];

  const targets: { bucket: string; paths: string[] }[] = [];

  for (const bucket of IDENTITY_BUCKETS) {
    try {
      targets.push({ bucket, paths: await listAllObjects(admin, bucket, userId) });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // A missing bucket is fine (environments differ); a real failure is not.
      if (/not found|does not exist/i.test(msg)) continue;
      console.error(`[accountPurge] list ${bucket}/${userId} failed:`, msg);
      failures.push(`${bucket}: ${msg}`);
      allOk = false;
    }
  }
  // Objects that are NOT under a <uid>/ prefix and so cannot be discovered by
  // listing — currently the user's chat attachments, which live under
  // <job_id>/<sender_id>/ and are reachable only via messages.attachment_url.
  targets.push(...extraPaths);

  for (const { bucket, paths } of targets) {
    if (paths.length === 0) continue;

    const { error: rmErr }: { error: { message: string } | null } =
      await admin.storage.from(bucket).remove(paths);
    if (rmErr) {
      console.error(`[accountPurge] remove ${paths.length} from ${bucket} failed:`, rmErr.message);
      failures.push(`${bucket}: ${rmErr.message}`);
      allOk = false;
      continue;
    }
    totalRemoved += paths.length;
  }

  // Verify by re-listing rather than trusting the null error. This is the
  // storage twin of the "a null error does not mean the write happened" rule,
  // and it matters here because these are government ID scans.
  for (const bucket of IDENTITY_BUCKETS) {
    try {
      const left = await listAllObjects(admin, bucket, userId);
      if (left.length > 0) {
        failures.push(`${bucket}: ${left.length} object(s) still present after remove`);
        allOk = false;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/not found|does not exist/i.test(msg)) continue;
      failures.push(`${bucket}: could not verify removal (${msg})`);
      allOk = false;
    }
  }

  steps.push({
    step: "storage",
    ok: allOk,
    detail: allOk
      ? `removed ${totalRemoved} object(s)`
      : `removed ${totalRemoved}, failures: ${failures.join("; ")}`,
  });
  return allOk;
}

/**
 * The database half: one transactional RPC, defined in
 * 20260901033011_account_deletion_retention_policy.sql.
 */
async function purgeDatabaseRows(
  admin: PurgeCapableClient,
  userId: string,
  steps: PurgeStep[],
): Promise<{ ok: boolean; notDeployed: boolean }> {
  const { data, error }: PostgrestLike<Record<string, number | string>> =
    await admin.rpc("purge_user_data", { p_user_id: userId });

  if (error) {
    // PGRST202 = the function is not in the schema cache yet. Migrations
    // auto-deploy on merge, so there is a window where the edge function is
    // live and the RPC is not. Say so truthfully instead of failing opaquely.
    if (error.code === "PGRST202") {
      console.error("[accountPurge] purge_user_data not deployed yet:", error.message);
      steps.push({
        step: "database",
        ok: false,
        detail: "purge_user_data RPC not deployed yet (PGRST202) — deferring, not failing",
      });
      return { ok: false, notDeployed: true };
    }
    console.error(`[accountPurge] purge_user_data failed for ${userId}:`, error.message);
    steps.push({ step: "database", ok: false, detail: `${error.code ?? "?"}: ${error.message}` });
    return { ok: false, notDeployed: false };
  }

  // A null `error` does NOT mean the write happened — the RPC returns a
  // per-step row-count report precisely so the caller never has to infer it.
  if (!data || typeof data !== "object") {
    steps.push({
      step: "database",
      ok: false,
      detail: "purge_user_data returned no report — treating as not-run",
    });
    return { ok: false, notDeployed: false };
  }

  steps.push({ step: "database", ok: true, detail: JSON.stringify(data) });
  return { ok: true, notDeployed: false };
}

/**
 * The storage paths this user's chat attachments occupy.
 *
 * `message-attachments` is keyed `<job_id>/<sender_id>/<file>`, so the user's
 * own uploads are NOT under a `<uid>/` prefix and no amount of listing will
 * find them. The only pointer is `messages.attachment_url`, and
 * `purge_user_data()` deletes those rows — so this has to run BEFORE the RPC
 * or the files are stranded in storage permanently with nothing left to
 * locate them by. That ordering is the whole reason this function exists
 * separately from the bucket sweep.
 *
 * Read-only and repeatable: on a retry after the rows are already gone it
 * simply returns nothing, and the objects it would have named are gone too.
 */
async function collectMessageAttachments(
  admin: PurgeCapableClient,
  userId: string,
  steps: PurgeStep[],
): Promise<string[]> {
  const res: PostgrestLike<{ attachment_url: string | null }[]> = await admin
    .from("messages")
    .select("attachment_url")
    .eq("sender_id", userId)
    .not("attachment_url", "is", null);

  if (res.error) {
    // Not fatal on its own, but it MUST be visible: proceeding would delete
    // the message rows and orphan whatever they pointed at.
    console.error(`[accountPurge] could not read message attachments for ${userId}:`, res.error.message);
    steps.push({
      step: "message_attachments",
      ok: false,
      detail: `read failed (${res.error.code ?? "?"}: ${res.error.message})`,
    });
    return [];
  }

  const paths: string[] = [];
  let rejected = 0;
  for (const row of res.data ?? []) {
    const url = row.attachment_url;
    if (!url) continue;
    // Stored either as a bare object path or as a full public/signed URL.
    const marker = "/message-attachments/";
    const idx = url.indexOf(marker);
    const raw = idx >= 0 ? url.slice(idx + marker.length).split("?")[0] : url;
    if (!raw) continue;

    // `decodeURIComponent` throws URIError on a malformed `%` escape, and
    // `attachment_url` is client-supplied text. Uncaught, one bad row threw out
    // of this function, out of purgeAccount, and permanently 500'd that user's
    // own account deletion with no way for them to proceed.
    let path: string;
    try {
      path = decodeURIComponent(raw);
    } catch {
      path = raw;
    }

    // The path MUST be `<job_id>/<this user's id>/<file>`.
    //
    // Without this check the removal list was whatever a client had written
    // into `attachment_url`, handed to `storage.remove()` under the
    // SERVICE-ROLE key — which bypasses the storage RLS that otherwise confines
    // a user to their own folder. The `messages` INSERT policy validates
    // `sender_id` and job participation but never the URL, so a user could
    // plant `<other_job>/<other_user>/<file>` in a message they legitimately
    // sent and destroy another party's dispute evidence on the way out.
    // Deleting your account must not be a primitive for deleting someone
    // else's files.
    const segments = path.split("/");
    if (segments.length < 3 || segments[1] !== userId) {
      console.error(
        `[accountPurge] refusing out-of-scope attachment path for ${userId}: ${path.slice(0, 120)}`,
      );
      rejected++;
      continue;
    }
    paths.push(path);
  }
  steps.push({
    step: "message_attachments",
    ok: true,
    detail: rejected > 0
      ? `${paths.length} attachment path(s) queued, ${rejected} rejected as out-of-scope`
      : `${paths.length} attachment path(s) queued for removal`,
  });
  return paths;
}

/**
 * Run every pre-deletion step. Call this immediately before
 * `auth.admin.deleteUser`; see `describeDeleteError` for the failure of that
 * final call.
 */
export async function purgeAccount(
  admin: PurgeCapableClient,
  userId: string,
): Promise<PurgeOutcome> {
  const steps: PurgeStep[] = [];

  if (!UUID_RE.test(userId)) {
    return {
      ok: false,
      steps: [{ step: "input", ok: false, detail: "userId is not a UUID" }],
      reason: "database_failed",
      userMessage:
        "We couldn't finish removing your data. Please try again, and contact " +
        "admin@louisianahelpr.com if it keeps failing.",
    };
  }

  await cancelStripeSubscription(admin, userId, steps);
  // Read the chat-attachment paths BEFORE the RPC deletes the rows that name
  // them (see collectMessageAttachments).
  const attachmentPaths = await collectMessageAttachments(admin, userId, steps);
  const storageOk = await purgeIdentityStorage(admin, userId, steps, [
    { bucket: "message-attachments", paths: attachmentPaths },
  ]);
  const db = await purgeDatabaseRows(admin, userId, steps);
  const stripeOk = steps.find((s) => s.step === "stripe")?.ok !== false;
  const attachmentsOk = steps.find((s) => s.step === "message_attachments")?.ok !== false;

  // Storage is allowed to be the thing that stops us, and deliberately so: if
  // we cannot prove the ID document is gone, completing the deletion would
  // orphan it forever with no user left to ask about it. Better to refuse,
  // tell the truth, and let the retry succeed. The database step is the same —
  // deleting the auth row without it would strand PII in the no-FK tables.
  // The stripe step is part of the gate, not advisory. It used to be ignored
  // here: a genuine cancel failure let the deletion proceed, the `profiles`
  // row then CASCADEd away carrying `stripe_subscription_id` with it, and the
  // account billed forever with nothing left to remediate from. The delete
  // dialog now tells the user "your membership stops billing" — this is what
  // makes that sentence true rather than aspirational.
  if (!storageOk || !db.ok || !stripeOk || !attachmentsOk) {
    return {
      ok: false,
      steps,
      reason: db.notDeployed
        ? "rpc_not_deployed"
        : !stripeOk
        ? "stripe_failed"
        : !storageOk || !attachmentsOk
        ? "storage_failed"
        : "database_failed",
      userMessage:
        "We couldn't finish removing your data, so we've stopped rather than " +
        "leave your account half-deleted. Nothing is lost — please try again " +
        "in a few minutes, and contact admin@louisianahelpr.com if it keeps failing.",
    };
  }

  return { ok: true, steps };
}

/**
 * Turn a failure from `auth.admin.deleteUser` into something a person can act
 * on.
 *
 * The specific thing this replaces: the raw Postgres text
 *   update or delete on table "users" violates foreign key constraint
 *   "jobs_helper_id_fkey" on table "jobs"
 * was being passed straight through to the account-deletion dialog. That is a
 * permanent, unexplained refusal of a legally-required capability — the user
 * has no idea what it means and no way to proceed. After the retention-policy
 * migration a 23503 should be unreachable; if one ever appears again it means
 * a NEW foreign key was added without a delete rule, which is an us-problem,
 * so the message says so and routes the person to support rather than blaming
 * them or leaving them stuck.
 */
export function describeDeleteError(message: string): string {
  if (/23503|violates foreign key constraint/i.test(message)) {
    return (
      "Something on our side is holding a reference to your account, so we " +
      "couldn't finish deleting it. This is our bug, not something you did. " +
      "We've logged it — email admin@louisianahelpr.com and we'll complete " +
      "the deletion manually."
    );
  }
  return "We couldn't finish deleting your account. Please try again, or email admin@louisianahelpr.com.";
}
