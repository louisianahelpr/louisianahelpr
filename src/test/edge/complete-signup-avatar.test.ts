/**
 * `complete-signup` — the superseded avatar object goes AFTER the row, or not
 * at all.
 *
 * THE BUG THESE PIN (prod, 2026-09-15). This function uploaded the new avatar,
 * immediately swept every other `avatar.*` in the folder, and only then ran
 * five early returns and the profile UPDATE. Any of those failing left
 * `profiles.avatar_url` naming an object the function itself had just deleted —
 * the row and the bucket disagreeing, a 400 on every screen that rendered that
 * member (22 of them in press-every-control that night).
 *
 * The UPDATE's own failure modes are not theoretical here. It is the write that
 * sets `approval_status: "approved"`, it already has a zero-row guard because a
 * missing profile row is reachable on the JWT path, and an UPDATE matching zero
 * rows answers `{ data: [], error: null }` — indistinguishable from success if
 * you only read `error`.
 *
 * So the sweep now runs only after that UPDATE is CONFIRMED, and it keeps two
 * names: the object this call uploaded, and whatever `avatar_url` names at the
 * instant before the delete (a replacement racing in from the app).
 *
 * These execute the real function through the edge harness; the double stands
 * in for Supabase only, and its bucket is a real key set, so "did the old
 * object survive?" is answered by the same `list()` the function makes.
 */
//
// Registered mutations - each turns this guard RED on its own:
//   (1) sweeping on the uploaded name alone deletes the object a racing
//   replacement already moved the row onto; (2) filtering the UPDATE on `id`
//   instead of `user_id` matches zero rows on prod and silently leaves the
//   account unapproved.
// @mutate supabase/functions/complete-signup/index.ts | rowName && rowName !== avatarObjectName ? [avatarObjectName, rowName] : avatarObjectName, | avatarObjectName,
// @mutate supabase/functions/complete-signup/index.ts | .update(updateData)\n      .eq("user_id", userId)\n      .or( | .update(updateData)\n      .eq("id", userId)\n      .or(
import { describe, it, expect, beforeEach, afterEach, type MockInstance } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";
import { stubSignupCapRead } from "./mocks/signupCapFetch";

const USER_ID = "11111111-1111-1111-1111-111111111111";
const AVATARS = `${USER_ID}`;
/** Whatever bytes — the double stores the key, not the image. */
const PNG_BASE64 = "AAAAAAAA";

async function load(): Promise<EdgeHarness> {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
  });
  return loadEdgeFunction("complete-signup");
}

/** A fresh, never-signed-in account inside the 30-minute completion window. */
function seedFreshSignup() {
  scenario.adminUsers = {
    [USER_ID]: {
      email: "new@test.com",
      email_confirmed_at: null,
      created_at: new Date().toISOString(),
      last_sign_in_at: null,
    } as unknown as { email?: string; email_confirmed_at?: string | null },
  };
  scenario.reads.profiles = {
    rows: [
      {
        bio: null,
        approval_status: "pending",
        full_name: "Dana R",
        location: "Baton Rouge",
        user_id: USER_ID,
      },
    ],
  };
  scenario.writeSelectRows.profiles = [{ user_id: USER_ID }];
}

/** What `profiles.avatar_url` answers on the post-update re-read. */
function rowNames(avatarUrl: string | null) {
  (scenario.reads.profiles.selectOverrides ??= []).push({
    includes: "avatar_url",
    result: { rows: [{ avatar_url: avatarUrl }] },
  });
}

function signupBody(overrides: Record<string, unknown> = {}) {
  return {
    userId: USER_ID,
    location: "Baton Rouge",
    zipCode: "70802",
    parish: "East Baton Rouge",
    phone: "(225) 555-0142",
    ageAttested: true,
    termsAccepted: true,
    avatarBase64: PNG_BASE64,
    avatarContentType: "image/png",
    ...overrides,
  };
}

const objects = () => [...scenario.storage.objects].sort();

describe("complete-signup — avatar row before avatar object", () => {
  let capRead: MockInstance<typeof fetch>;
  beforeEach(() => {
    resetEnv();
    resetSupabaseMock();
    resetSharedMocks();
    capRead = stubSignupCapRead();
  });
  afterEach(() => capRead.mockRestore());

  it("uploads, confirms the row, THEN retires the superseded object", async () => {
    seedFreshSignup();
    // The legacy orphan the old client-controlled key scheme could produce.
    scenario.storage.objects.add(`${AVATARS}/avatar.php`);
    rowNames(`https://x.supabase.co/storage/v1/object/public/avatars/${AVATARS}/avatar.png`);

    const fn = await load();
    const res = await fn.fetch(fn.request({ body: signupBody() }));
    expect(res.status).toBe(200);

    const update = scenario.writes.find((w) => w.table === "profiles" && w.op === "update");
    expect((update?.payload as Record<string, unknown>)?.avatar_url).toContain(
      `${AVATARS}/avatar.png`,
    );
    // …filtered on `user_id`, the column that actually holds the auth id.
    // `profiles.id` is a SEPARATE surrogate key, so `.eq("id", userId)` matches
    // ZERO rows on prod and answers `{ data: [], error: null }` — the account
    // is left unapproved and the avatar row never moves, with nothing thrown.
    // The mock resolves writes by TABLE, not by filter, so every other
    // assertion in this file passes with the wrong column; only this one sees
    // it (probe 2026-09-21: the swap left both complete-signup guards 12/12).
    expect(update?.filters).toEqual(
      expect.arrayContaining([{ op: "eq", column: "user_id", value: USER_ID }]),
    );
    expect(scenario.storage.removeCalls).toEqual([[`${AVATARS}/avatar.php`]]);
    expect(objects()).toEqual([`${AVATARS}/avatar.png`]);
  });

  it("a ZERO-ROW profile update deletes NOTHING", async () => {
    // `.update().select("user_id")` matching no row: `{ data: [], error: null }`.
    // The function 500s — and the previous photo must still be in the bucket,
    // because the row that names it was never moved.
    seedFreshSignup();
    scenario.writeSelectRows.profiles = [];
    scenario.storage.objects.add(`${AVATARS}/avatar.jpg`);

    const fn = await load();
    const res = await fn.fetch(fn.request({ body: signupBody() }));

    expect(res.status).toBe(500);
    expect(scenario.storage.removeCalls, "a zero-row update must delete nothing").toEqual([]);
    expect(scenario.storage.objects.has(`${AVATARS}/avatar.jpg`)).toBe(true);
  });

  it("a FAILED profile update deletes NOTHING", async () => {
    seedFreshSignup();
    scenario.writeErrors.profiles = { message: "deadlock detected", code: "40P01" };
    scenario.storage.objects.add(`${AVATARS}/avatar.jpg`);

    const fn = await load();
    const res = await fn.fetch(fn.request({ body: signupBody() }));

    expect(res.status).toBe(500);
    expect(scenario.storage.removeCalls).toEqual([]);
    expect(scenario.storage.objects.has(`${AVATARS}/avatar.jpg`)).toBe(true);
  });

  it("KEEPS the object the row names when it is not the one it uploaded", async () => {
    // A replacement raced in from the app between the UPDATE and the sweep, so
    // the row now names avatar.webp. Deleting it would orphan that row.
    seedFreshSignup();
    scenario.storage.objects.add(`${AVATARS}/avatar.webp`);
    scenario.storage.objects.add(`${AVATARS}/avatar.php`);
    rowNames(`https://x.supabase.co/storage/v1/object/public/avatars/${AVATARS}/avatar.webp?t=1`);

    const fn = await load();
    expect((await fn.fetch(fn.request({ body: signupBody() }))).status).toBe(200);

    expect(scenario.storage.removeCalls).toEqual([[`${AVATARS}/avatar.php`]]);
    expect(objects()).toEqual([`${AVATARS}/avatar.png`, `${AVATARS}/avatar.webp`]);
  });

  it("deletes nothing when the row cannot be re-read, and says so", async () => {
    // Unknown is never "clean" — the same rule the unreadable folder gets.
    seedFreshSignup();
    scenario.storage.objects.add(`${AVATARS}/avatar.php`);
    (scenario.reads.profiles.selectOverrides ??= []).push({
      includes: "avatar_url",
      result: { error: { message: "statement timeout", code: "57014" } },
    });

    const fn = await load();
    const res = await fn.fetch(fn.request({ body: signupBody() }));
    expect(res.status).toBe(200);

    expect(scenario.storage.removeCalls).toEqual([]);
    expect(scenario.storage.objects.has(`${AVATARS}/avatar.php`)).toBe(true);
    expect(((await res.json()) as { staleAvatarObjects?: string[] }).staleAvatarObjects).toEqual([
      `${AVATARS}/<profile row unreadable — nothing removed>`,
    ]);
  });

  it("hands back a superseded object that survived a silent delete", async () => {
    // RLS filtered the remove: `{ data: [], error: null }` and nothing gone.
    // The new photo is live and the row points at it, so the signup succeeds —
    // but the previous photo is still public and the caller is told.
    seedFreshSignup();
    scenario.storage.removeBehaviour = "silent-noop";
    scenario.storage.objects.add(`${AVATARS}/avatar.php`);
    rowNames(`https://x.supabase.co/storage/v1/object/public/avatars/${AVATARS}/avatar.png`);

    const fn = await load();
    const res = await fn.fetch(fn.request({ body: signupBody() }));
    expect(res.status).toBe(200);

    expect(((await res.json()) as { staleAvatarObjects?: string[] }).staleAvatarObjects).toEqual([
      `${AVATARS}/avatar.php`,
    ]);
    expect(scenario.storage.objects.has(`${AVATARS}/avatar.php`)).toBe(true);
  });

  it("never sweeps when the upload itself failed", async () => {
    // A provided photo that did not store is a 502 ("please try again") BEFORE
    // the profile update — so there is no new object, no row change, and
    // emphatically no delete of the photo the profile still points at.
    seedFreshSignup();
    scenario.storage.uploadError = { message: "storage unavailable" };
    scenario.storage.objects.add(`${AVATARS}/avatar.jpg`);

    const fn = await load();
    const res = await fn.fetch(fn.request({ body: signupBody() }));
    expect(res.status).toBe(502);

    expect(scenario.storage.removeCalls).toEqual([]);
    expect(objects()).toEqual([`${AVATARS}/avatar.jpg`]);
    expect(scenario.writes.some((w) => w.table === "profiles" && w.op === "update")).toBe(false);
  });

  it("refuses a type the bucket would reject before touching storage", async () => {
    seedFreshSignup();
    scenario.storage.objects.add(`${AVATARS}/avatar.jpg`);

    const fn = await load();
    const res = await fn.fetch(
      fn.request({ body: signupBody({ avatarContentType: "image/heic", avatarExt: "heic" }) }),
    );

    expect(res.status).toBe(400);
    expect(scenario.storage.removeCalls).toEqual([]);
    expect(objects()).toEqual([`${AVATARS}/avatar.jpg`]);
  });
});
