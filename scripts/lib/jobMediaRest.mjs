/**
 * Node twin of supabase/functions/_shared/jobMedia.ts, over the Storage REST
 * API, for scripts that delete jobs or users on prod (prod-seed teardown, the
 * E2E lifecycle sweeper). Those scripts were how most of the 2026-09-14 orphans
 * were made: they removed rows and auth users and left the files.
 *
 * Contract: call BEFORE the row delete (storage RLS for a non-service caller
 * checks the job still exists). Never throws; failures are returned and
 * printed, and the row delete goes ahead. The weekly storage-orphan-sweep is
 * the net for whatever this misses.
 *
 * jobMediaPrefixes must stay identical to the Deno version; the parity test in
 * src/test/storageDeletionPaths.test.ts compares them.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function jobMediaPrefixes(job) {
  if (!UUID_RE.test(job.id)) return [];
  const parties = [...new Set([job.customer_id, job.helper_id, ...(job.party_ids ?? [])])].filter(
    (p) => typeof p === "string" && UUID_RE.test(p),
  );
  return [
    { bucket: "job-photos", prefix: job.id },
    { bucket: "proof-photos", prefix: job.id },
    { bucket: "message-attachments", prefix: job.id },
    { bucket: "message-attachments", prefix: `voice-notes/${job.id}` },
    ...parties.map((p) => ({ bucket: "proof-photos", prefix: `${p}/disputes/${job.id}` })),
    ...parties.map((p) => ({ bucket: "application-attachments", prefix: `${p}/${job.id}` })),
  ];
}

/** Everything stored under a user's own folder, in every bucket that has one. */
export function userStoragePrefixes(userId) {
  if (!UUID_RE.test(userId)) return [];
  return ["avatars", "id-documents", "user-documents", "profile-videos", "application-attachments", "proof-photos", "job-photos"].map(
    (bucket) => ({ bucket, prefix: userId }),
  );
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(base, headers, method, path, body) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20_000);
  try {
    const h = new Headers(headers);
    h.set("content-type", "application/json");
    const res = await fetch(`${base}/storage/v1${path}`, {
      method,
      headers: h,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctl.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path} -> HTTP ${res.status} ${text.slice(0, 120)}`);
    return text ? JSON.parse(text) : null;
  } finally {
    clearTimeout(timer);
    await sleep(250);
  }
}

async function listUnder(base, headers, bucket, prefix) {
  const found = [];
  const stack = [prefix];
  let calls = 0;
  while (stack.length) {
    const current = stack.pop();
    for (let offset = 0; ; offset += 100) {
      if (++calls > 200) throw new Error(`listing ${bucket}/${prefix} exceeded 200 calls`);
      const rows = await call(base, headers, "POST", `/object/list/${bucket}`, { prefix: current, limit: 100, offset });
      for (const r of rows ?? []) {
        const full = `${current}/${r.name}`;
        if (r.id === null) stack.push(full);
        else found.push(full);
      }
      if (!rows || rows.length < 100) break;
    }
  }
  return found;
}

/** Remove every object under the given prefixes. Never throws. */
export async function removePrefixes({ base, headers, prefixes, source = "storage-cleanup" }) {
  let removed = 0;
  const failures = [];
  // Prod load: list each bucket's top level ONCE and skip every prefix whose
  // first folder is not there, instead of one list call per job per bucket.
  const roots = new Map();
  const rootOf = async (bucket) => {
    if (!roots.has(bucket)) {
      const names = new Set();
      for (let offset = 0; ; offset += 100) {
        const rows = await call(base, headers, "POST", `/object/list/${bucket}`, { prefix: "", limit: 100, offset });
        for (const r of rows ?? []) names.add(r.name);
        if (!rows || rows.length < 100) break;
        if (offset > 20_000) throw new Error(`top level of ${bucket} exceeded 20k entries`);
      }
      roots.set(bucket, names);
    }
    return roots.get(bucket);
  };
  for (const { bucket, prefix } of prefixes) {
    try {
      if (!(await rootOf(bucket)).has(prefix.split("/")[0])) continue;
      const paths = await listUnder(base, headers, bucket, prefix);
      if (paths.length === 0) continue;
      const res = await call(base, headers, "DELETE", `/object/${bucket}`, { prefixes: paths });
      const n = Array.isArray(res) ? res.length : 0;
      removed += n;
      if (n < paths.length) failures.push(`${bucket}/${prefix}: removed ${n} of ${paths.length}`);
    } catch (e) {
      const msg = String(e?.message || e);
      if (/Bucket not found/i.test(msg)) continue;
      failures.push(`${bucket}/${prefix}: ${msg}`);
    }
  }
  if (failures.length) console.warn(`[${source}] storage removal incomplete (${removed} removed): ${failures.join("; ")}`);
  return { removed, failures };
}

/** The object path inside `message-attachments` from a stored attachment_url. */
export function messageAttachmentPath(url) {
  if (!url) return null;
  const marker = "/message-attachments/";
  const i = url.indexOf(marker);
  const raw = i >= 0 ? url.slice(i + marker.length).split("?")[0] : url;
  if (!raw || /^https?:/i.test(raw)) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** Remove chat attachments by their stored attachment_url values. Never throws. */
export async function removeMessageAttachmentsRest({ base, headers, attachmentUrls, source = "storage-cleanup" }) {
  const paths = [...new Set(attachmentUrls.map(messageAttachmentPath).filter(Boolean))];
  if (paths.length === 0) return { removed: 0, failures: [] };
  try {
    const res = await call(base, headers, "DELETE", "/object/message-attachments", { prefixes: paths });
    const n = Array.isArray(res) ? res.length : 0;
    const failures = n < paths.length ? [`message-attachments: removed ${n} of ${paths.length}`] : [];
    if (failures.length) console.warn(`[${source}] ${failures[0]}`);
    return { removed: n, failures };
  } catch (e) {
    const msg = `message-attachments: ${String(e?.message || e)}`;
    console.warn(`[${source}] storage removal failed: ${msg}`);
    return { removed: 0, failures: [msg] };
  }
}

export function removeJobMediaRest({ base, headers, jobs, source }) {
  return removePrefixes({ base, headers, prefixes: jobs.flatMap(jobMediaPrefixes), source });
}

export function removeUserStorageRest({ base, headers, userIds, source }) {
  return removePrefixes({ base, headers, prefixes: userIds.flatMap(userStoragePrefixes), source });
}
