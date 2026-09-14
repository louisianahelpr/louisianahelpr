/**
 * The weekly storage orphan sweep deletes files. These pin the three rules
 * that stand between "orphan" and "delete" (owner, 2026-09-14):
 *   - the owning row must be absent on TWO reads at least 10 min apart;
 *   - nothing younger than 7 days is touched;
 *   - over 50 orphans, or over 5% of a bucket, deletes nothing.
 * Plus the identity-document rule and the path schemes from
 * docs/audit/storage-audit-2026-09-14.md, including the real prod shapes.
 */
import { describe, it, expect } from "vitest";
import {
  checkCaps,
  identityDocumentDeletable,
  orphanReason,
  selectOrphans,
} from "../../scripts/lib/storageOrphans.mjs";

const U_LIVE = "76b07824-9b41-4741-a4c4-4f8de362f682";
const U_GONE = "b0f6ebec-ab03-40fe-a33c-3cc69ed05f7e";
const J_LIVE = "fde2605b-1111-4111-8111-111111111111";
const J_GONE = "a5eed000-0000-4000-8000-000000000001";
const DAY = 24 * 60 * 60_000;
const NOW = Date.parse("2026-09-14T12:00:00Z");
const OLD = new Date(NOW - 30 * DAY).toISOString();

type World = {
  readAt: number;
  profileUserIds: Set<string>;
  authUserIds: Set<string>;
  jobIds: Set<string>;
  attachmentRefs: string[];
};
function world(over: Partial<World> = {}): World {
  return {
    readAt: NOW - 11 * 60_000,
    profileUserIds: new Set([U_LIVE]),
    authUserIds: new Set([U_LIVE]),
    jobIds: new Set([J_LIVE]),
    attachmentRefs: [],
    ...over,
  };
}
const obj = (bucket: string, name: string, createdAt = OLD, size = 100) => ({ bucket, name, size, createdAt });

describe("orphanReason — path schemes", () => {
  const w = world({ attachmentRefs: [`${J_LIVE}/${U_LIVE}/ref.png`] });
  it.each([
    ["avatars", `${U_GONE}/avatar.png`, "user gone"],
    ["avatars", `${U_LIVE}/avatar.png`, null],
    ["user-documents", `${U_GONE}/credentials/license-1.png`, "user gone"],
    ["id-documents", `${U_LIVE}/id-document-1.png`, null],
    ["application-attachments", `${U_LIVE}/${J_GONE}/1-a.png`, "job gone"],
    ["application-attachments", `${U_LIVE}/${J_LIVE}/1-a.png`, null],
    ["proof-photos", `${J_GONE}/after-1.png`, "job gone"],
    ["proof-photos", `${J_LIVE}/after-1.png`, null],
    // A live user's folder in a job-keyed bucket: owner exists, never deleted.
    ["proof-photos", `${U_LIVE}/e2e-proof-test.jpg`, null],
    ["proof-photos", `${U_LIVE}/disputes/${J_GONE}/x.png`, "job gone"],
    // Evidence that outlives its uploader is never swept for "user gone".
    ["job-photos", `${U_GONE}/reviews/x.png`, null],
    ["proof-photos", `${U_GONE}/disputes/${J_LIVE}/x.png`, null],
    ["message-attachments", `${J_GONE}/${U_LIVE}/x-upload.png`, "job gone"],
    ["message-attachments", `${J_LIVE}/${U_LIVE}/ref.png`, null],
    ["message-attachments", `${J_LIVE}/${U_LIVE}/unref.png`, "unreferenced"],
    ["message-attachments", `voice-notes/${J_GONE}/${U_LIVE}/v.webm`, "job gone"],
    ["social-posts", "anything.png", null],
    ["avatars", "not-a-uuid/avatar.png", null],
  ])("%s %s -> %s", (bucket, name, expected) => {
    expect(orphanReason(bucket, name, w)).toBe(expected);
  });

  it("matches an attachment stored as a full signed URL", () => {
    const path = `${J_LIVE}/${U_LIVE}/signed.png`;
    const w2 = world({ attachmentRefs: [`https://x.supabase.co/storage/v1/object/sign/message-attachments/${path}?token=abc`] });
    expect(orphanReason("message-attachments", path, w2)).toBeNull();
  });
});

describe("two-read rule", () => {
  const objects = [obj("avatars", `${U_GONE}/avatar.png`)];

  it("an owner that reappears on the second read is NOT deleted", () => {
    const first = world();
    const second = world({ readAt: NOW, profileUserIds: new Set([U_LIVE, U_GONE]) });
    const r = selectOrphans({ objects, first, second, now: NOW });
    expect(r.orphans).toHaveLength(0);
    expect(r.skippedSecondRead).toHaveLength(1);
  });

  it("absent on both reads 10+ min apart IS an orphan", () => {
    const r = selectOrphans({ objects, first: world(), second: world({ readAt: NOW }), now: NOW });
    expect(r.error).toBeNull();
    expect(r.orphans.map((o) => o.name)).toEqual([`${U_GONE}/avatar.png`]);
  });

  it("reads under 10 minutes apart select nothing", () => {
    const r = selectOrphans({ objects, first: world({ readAt: NOW - 60_000 }), second: world({ readAt: NOW }), now: NOW });
    expect(r.orphans).toHaveLength(0);
    expect(r.error).toMatch(/10 min/);
  });
});

describe("age floor", () => {
  it("never touches an object younger than 7 days", () => {
    const objects = [
      obj("avatars", `${U_GONE}/avatar.png`, new Date(NOW - 6 * DAY).toISOString()),
      obj("proof-photos", `${J_GONE}/after-1.png`, new Date(NOW - 8 * DAY).toISOString()),
    ];
    const r = selectOrphans({ objects, first: world(), second: world({ readAt: NOW }), now: NOW });
    expect(r.orphans.map((o) => o.bucket)).toEqual(["proof-photos"]);
    expect(r.skippedYoung.map((o) => o.bucket)).toEqual(["avatars"]);
  });

  it("an unreadable created_at counts as young", () => {
    const r = selectOrphans({ objects: [obj("avatars", `${U_GONE}/a.png`, "garbage")], first: world(), second: world({ readAt: NOW }), now: NOW });
    expect(r.orphans).toHaveLength(0);
  });
});

describe("identity documents", () => {
  it("are kept while the owner is in auth.users even without a profile", () => {
    const w = world({ profileUserIds: new Set(), authUserIds: new Set([U_GONE]) });
    expect(identityDocumentDeletable("id-documents", `${U_GONE}/id-1.png`, w)).toBe(false);
    expect(orphanReason("user-documents", `${U_GONE}/credentials/l.png`, w)).toBeNull();
  });
  it("are kept while the owner has a profile even without an auth row", () => {
    const w = world({ profileUserIds: new Set([U_GONE]), authUserIds: new Set() });
    expect(identityDocumentDeletable("user-documents", `${U_GONE}/credentials/l.png`, w)).toBe(false);
  });
});

describe("caps", () => {
  const many = (bucket: string, n: number) => Array.from({ length: n }, (_, i) => obj(bucket, `${J_GONE}/${i}.png`));

  it("over 50 orphans trips the cap", () => {
    const objects = many("proof-photos", 2000);
    const r = checkCaps({ orphans: objects.slice(0, 51), objects });
    expect(r.tripped).toBe(true);
    expect(r.reasons.join()).toMatch(/50-file cap/);
  });

  it("50 orphans at under 5% of the bucket does not", () => {
    const objects = many("proof-photos", 2000);
    expect(checkCaps({ orphans: objects.slice(0, 50), objects }).tripped).toBe(false);
  });

  it("over 5% of one bucket trips the cap", () => {
    const objects = many("avatars", 18);
    const r = checkCaps({ orphans: objects.slice(0, 1), objects });
    expect(r.tripped).toBe(true);
    expect(r.reasons.join()).toMatch(/avatars: 1 of 18/);
  });

  it("exactly 5% does not", () => {
    const objects = many("avatars", 20);
    expect(checkCaps({ orphans: objects.slice(0, 1), objects }).tripped).toBe(false);
  });
});
