/**
 * Which dispute evidence URLs the app will render as a link + image.
 *
 * Evidence is stored as strings a party supplied, and it renders in the admin
 * console and in the other party's dialog. Anything else — an attacker host, a
 * `javascript:` URL, a legacy value — is withheld and counted, never rendered.
 * The server-side twin is public.dispute_evidence_url_ok (widened to match by
 * migration 20260922172945).
 *
 * TWO shapes are trusted, and NEITHER can name a host this project does not own:
 *
 *  A. Legacy — a SIGNED proof-photos object URL whose origin is this project's
 *     Supabase origin, and whose object path sits under `<uuid>/disputes/<uuid>/`
 *     (since Q398, 2026-09-25). The origin check stops a foreign host; the path
 *     pin stops a URL to a proof-photos object the uploader can still overwrite
 *     or delete (anything outside the folder 20260925141905 makes immutable).
 *
 *  B. Current — the bare storage PATH `<uploader>/disputes/<job>/<file>`, which
 *     is what the writers store now (a signed URL carries an `exp` and 400s a
 *     year later; see src/lib/proofPhotoStorage.ts). A path is trusted on a
 *     STRICTER basis than a URL, not a looser one: it has no scheme and no
 *     authority component, so it cannot address anything outside this project —
 *     the only thing that ever resolves it is
 *     `supabase.storage.from("proof-photos").createSignedUrl(path)` against this
 *     project's own client, i.e. one object inside this project's own private
 *     bucket. And the shape is pinned to the same two uuid segments the server
 *     validator pins, so it must additionally sit under `<uuid>/disputes/<uuid>/`
 *     — the same folder the legacy URL branch is now pinned to.
 *
 *     Everything that could smuggle a foreign host into a "path" is excluded by
 *     the anchors: a leading `/` or `//host/...` fails `^<uuid>`, a `scheme:`
 *     fails it too (`:` is not a uuid character), and `?`/`#`/`\` are barred
 *     from the filename segment. `..` cannot appear because a uuid segment
 *     cannot be `..` and the filename segment excludes `/`.
 */

/**
 * The two pinned uuid segments, exactly as public.dispute_evidence_url_ok pins
 * them — and CASE-SENSITIVE, as that validator's `~` is. Storage object names
 * are case-sensitive and the immutability policies (20260925141905) exclude
 * only the literal `disputes` folder, so `<uid>/DISPUTES/<job>/…` is an object
 * its uploader can still overwrite or delete; trusting it here would show the
 * admin evidence that can change after they looked (Q398). The uuids are the
 * lower-case text form Postgres prints (`uuid::text`).
 */
const EVIDENCE_PATH_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/disputes\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[^/?#\\:]+$/;

/**
 * The legacy signed URL's object path, pinned to the same folder: branch A of
 * dispute_evidence_url_ok. Any other proof-photos object (a before/after proof
 * photo, an upper-case folder) is mutable by its uploader, so a legacy URL
 * naming one is withheld, not rendered (Q398).
 */
const LEGACY_SIGNED_PATH_RE =
  /^\/storage\/v1\/object\/sign\/proof-photos\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/disputes\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[^/]+$/;

export function isTrustedEvidenceUrl(url: string, supabaseUrl: string): boolean {
  // B. The storage path shape. Checked first and independently of `new URL()`,
  //    which THROWS on a bare path — that throw is exactly what used to count
  //    every path-shaped value as withheld and hide it from the deciding admin.
  if (EVIDENCE_PATH_RE.test(url)) return true;
  try {
    const u = new URL(url);
    const base = new URL(supabaseUrl);
    return (
      u.protocol === "https:" &&
      u.origin === base.origin &&
      LEGACY_SIGNED_PATH_RE.test(u.pathname) &&
      !u.pathname.includes("..")
    );
  } catch {
    // Not a parseable URL, so not a trusted one: withholding it IS the handling
    // (it is counted and shown as "not shown"), and a party's bad string is not
    // an app defect to report.
    return false;
  }
}

export function partitionEvidenceUrls(
  urls: readonly string[] | null | undefined,
  supabaseUrl: string = import.meta.env.VITE_SUPABASE_URL ?? "",
): { trusted: string[]; withheld: number } {
  const trusted: string[] = [];
  let withheld = 0;
  for (const url of urls ?? []) {
    if (typeof url === "string" && isTrustedEvidenceUrl(url, supabaseUrl)) trusted.push(url);
    else withheld++;
  }
  return { trusted, withheld };
}
