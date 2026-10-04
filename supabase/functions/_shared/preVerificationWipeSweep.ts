// Q447 (owner decision 2026-10-04): the storage half of the pre-verification
// takeover wipe.
//
// When the real owner of an email address takes over an account whose email
// was never verified (a provider sign-in, GoTrue's linking path), the
// database trigger zz_wipe_on_provider_takeover clears everything typed into
// the account before verification and records the stored objects in
// public.pre_verification_wipes (migration 20261004194257). Storage rows
// cannot be deleted from SQL (storage.protect_delete), so this sweep removes
// them through the Storage API: per pending wipe it asks
// pre_verification_wipe_objects(p_wipe_id) for the objects that still exist
// UNCHANGED since the wipe (a new avatar the real owner uploaded under the
// same key is never returned), removes them, then stamps storage_done_at.
// A failed removal leaves the row pending (retried next run) and is reported.
//
// ZERO imports, so a unit test can load it with a fake client.

export interface WipeSweepClient {
  from(table: "pre_verification_wipes"): {
    select(cols: string): {
      is(col: "storage_done_at", v: null): {
        is(col: "error", v: null): {
          order(col: "wiped_at", o: { ascending: boolean }): {
            limit(n: number): PromiseLike<{ data: { id: string }[] | null; error: { message: string } | null }>;
          };
        };
        not(col: "error", op: "is", v: null): {
          order(col: "wiped_at", o: { ascending: boolean }): {
            limit(n: number): PromiseLike<{ data: { id: string; user_id: string; error: string }[] | null; error: { message: string } | null }>;
          };
        };
      };
    };
    update(v: { storage_done_at: string }): {
      eq(col: "id", id: string): {
        select(cols: "id"): PromiseLike<{ data: { id: string }[] | null; error: { message: string } | null }>;
      };
    };
  };
  rpc(
    fn: "pre_verification_wipe_objects",
    args: { p_wipe_id: string },
  ): PromiseLike<{ data: { bucket: string; name: string }[] | null; error: { message: string } | null }>;
  storage: {
    from(bucket: string): { remove(paths: string[]): PromiseLike<{ error: { message: string } | null }> };
  };
}

export interface WipeSweepResult {
  wipes: number;
  removed: number;
  done: number;
  /** Wipes the database trigger could not run (pre_verification_wipes.error), still unacknowledged. */
  failedWipes: number;
  failures: string[];
}

/** Drain up to `maxWipes` pending pre-verification wipes. Never throws. */
export async function drainPreVerificationWipes(
  client: WipeSweepClient,
  opts: { maxWipes?: number; dryRun?: boolean; now?: () => string } = {},
): Promise<WipeSweepResult> {
  const out: WipeSweepResult = { wipes: 0, removed: 0, done: 0, failedWipes: 0, failures: [] };
  const now = opts.now ?? (() => new Date().toISOString());

  // A wipe the trigger could not run left the takeover's typed data in place
  // and recorded why in pre_verification_wipes.error (it must never break the
  // sign-in). Nothing else reads that column, so every such row is a failure
  // of this run until an operator handles it (finishes the wipe, then stamps
  // storage_done_at): a cron defect each day, not a silent row (lh-authz-rls
  // review of Q447, 2026-10-04).
  const { data: failed, error: failedErr } = await client
    .from("pre_verification_wipes")
    .select("id, user_id, error")
    .is("storage_done_at", null)
    .not("error", "is", null)
    .order("wiped_at", { ascending: true })
    .limit(50);
  if (failedErr) {
    out.failures.push(`failed wipes read: ${failedErr.message}`);
  } else {
    for (const f of failed ?? []) {
      out.failedWipes++;
      out.failures.push(`wipe ${f.id} for user ${f.user_id} did not run: ${f.error}`);
    }
  }
  const { data: pending, error } = await client
    .from("pre_verification_wipes")
    .select("id")
    .is("storage_done_at", null)
    .is("error", null)
    .order("wiped_at", { ascending: true })
    .limit(opts.maxWipes ?? 50);
  if (error) {
    out.failures.push(`pending wipes read: ${error.message}`);
    return out;
  }
  for (const w of pending ?? []) {
    out.wipes++;
    const { data: objects, error: objErr } = await client.rpc("pre_verification_wipe_objects", { p_wipe_id: w.id });
    if (objErr) {
      out.failures.push(`wipe ${w.id} objects read: ${objErr.message}`);
      continue;
    }
    const byBucket = new Map<string, string[]>();
    for (const o of objects ?? []) byBucket.set(o.bucket, [...(byBucket.get(o.bucket) ?? []), o.name]);
    if (opts.dryRun) {
      out.removed += (objects ?? []).length;
      continue;
    }
    let ok = true;
    for (const [bucket, names] of byBucket) {
      const { error: rmErr } = await client.storage.from(bucket).remove(names);
      if (rmErr) {
        ok = false;
        out.failures.push(`wipe ${w.id} remove from ${bucket}: ${rmErr.message}`);
      } else {
        out.removed += names.length;
      }
    }
    if (!ok) continue;
    // A null error is not a write: count the row the stamp actually moved.
    const { data: stamped, error: stampErr } = await client
      .from("pre_verification_wipes")
      .update({ storage_done_at: now() })
      .eq("id", w.id)
      .select("id");
    if (stampErr || !stamped || stamped.length !== 1) {
      out.failures.push(`wipe ${w.id} done stamp: ${stampErr?.message ?? "matched 0 rows"}`);
    } else {
      out.done++;
    }
  }
  return out;
}
