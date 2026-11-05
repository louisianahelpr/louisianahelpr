/**
 * Q2037 faces (lead decision 2026-11-04): a job notice carries the member who caused it
 * (notifications.actor_id, 20261104060659) and the bell shows that member's photo or initials in place of the
 * type icon. CLASS, in the NEWEST definitions: (1) one BEFORE INSERT trigger stamps auth.uid() as the actor only
 * on a job notice, never for the recipient or an admin, and overwrites any actor a member passed (no forged
 * faces), nor across a block either way; (2) the purge's anonymized_at stamp clears the departed member's actor_id; both functions are definers
 * with EXECUTE revoked from PUBLIC, anon, authenticated; (3) the bell row renders the face when the actor is
 * known and the type icon otherwise, and the panel hands each row its face.
 * Backend proof: src/test/pglite/notificationActorFace.pglite.mjs (15 PASS x3; NEW_MIGRATION=skip FAILs; the pre-review body fails the 3 block-and-settle cases).
 *
 * @mutate supabase/migrations/20261104060659_notification_actor_face.sql |      AND NOT public.has_role(v_uid, 'admin')\n |      AND true\n
 * @mutate supabase/migrations/20261104060659_notification_actor_face.sql |                          OR (b.blocker_id = NEW.user_id AND b.blocked_id = v_uid)) THEN |                          OR false) THEN
 * @mutate supabase/migrations/20261104060659_notification_actor_face.sql |   UPDATE public.notifications SET actor_id = NULL WHERE actor_id = OLD.user_id; |   NULL;
 * @mutate supabase/migrations/20261104060659_notification_actor_face.sql | REVOKE ALL ON FUNCTION public.notifications_stamp_actor() FROM PUBLIC, anon, authenticated; | REVOKE ALL ON FUNCTION public.notifications_stamp_actor() FROM PUBLIC;
 * @mutate src/components/notificationPanel/NotificationLeading.tsx |   if (n.actor_id && face) { |   if (false) {
 * @mutate src/components/NotificationPanelView.tsx | <NotificationLeading n={n} face={n.actor_id ? faces.get(n.actor_id) : undefined} /> | <NotificationLeading n={n} face={undefined} />
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { render } from "@testing-library/react";
import { readdirSync } from "./helpers/trackedFiles";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { NotificationLeading } from "@/components/notificationPanel/NotificationLeading";
import type { Notification } from "@/components/notificationPanel/types";

const REPO = resolve(__dirname, "..", "..");
const MIG = join(REPO, "supabase", "migrations");
const DEFS = effectiveDefs(MIG);
const FILES = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();
const body = (fn: string) => blankSqlComments(DEFS.get(fn)?.stmt ?? "");
function newestStatement(re: RegExp): string {
  for (let i = FILES.length - 1; i >= 0; i--) {
    const all = [...blankSqlComments(readFileSync(join(MIG, FILES[i]), "utf8")).matchAll(re)];
    if (all.length) return all[all.length - 1][0];
  }
  return "";
}

const row = (over: Partial<Notification> = {}): Notification => ({
  id: "n1", user_id: "me", title: "Hal H. applied", message: "", type: "application", read: false, link: null,
  job_id: "j1", created_at: "2026-11-04T06:00:00Z", ...over,
});

describe("job notices show the face of the member who caused them (Q2037)", () => {
  it("reads a real inventory", () => {
    expect(DEFS.size).toBeGreaterThan(500);
    expect(FILES.length).toBeGreaterThan(500);
  });

  it("one BEFORE INSERT trigger stamps the caller, only on job notices, never the recipient or an admin", () => {
    const b = body("notifications_stamp_actor");
    expect(b).toMatch(/SECURITY DEFINER/i);
    expect(b).toMatch(/v_uid uuid := auth\.uid\(\)/);
    expect(b).toMatch(/NEW\.job_id IS NOT NULL\s+AND v_uid IS DISTINCT FROM NEW\.user_id\s+AND NOT public\.has_role\(v_uid, 'admin'\)\s+AND NOT EXISTS \(SELECT 1 FROM public\.user_blocks b[\s\S]*?\) THEN\s+NEW\.actor_id := v_uid;\s+ELSE\s+NEW\.actor_id := NULL;/);
    // a block either way hides the face (block_user_and_settle must not say who blocked whom; authz review 11-04)
    expect(b).toMatch(/b\.blocker_id = v_uid AND b\.blocked_id = NEW\.user_id/);
    expect(b).toMatch(/b\.blocker_id = NEW\.user_id AND b\.blocked_id = v_uid/);
    const trig = newestStatement(/CREATE TRIGGER\s+trg_notifications_stamp_actor[\s\S]*?;/gi);
    expect(trig).toMatch(/BEFORE INSERT ON public\.notifications/i);
    const revoke = newestStatement(/REVOKE ALL ON FUNCTION public\.notifications_stamp_actor\(\) FROM[^;]*;/gi);
    expect(revoke).toMatch(/PUBLIC, anon, authenticated/);
  });

  it("the purge clears the departed member's face", () => {
    const b = body("clear_departed_member_notification_actor");
    expect(b).toMatch(/UPDATE public\.notifications SET actor_id = NULL WHERE actor_id = OLD\.user_id/);
    const trig = newestStatement(/CREATE TRIGGER\s+trg_profiles_clear_notification_actor[\s\S]*?;/gi);
    expect(trig).toMatch(/AFTER UPDATE OF anonymized_at ON public\.profiles/i);
    const revoke = newestStatement(/REVOKE ALL ON FUNCTION public\.clear_departed_member_notification_actor\(\) FROM[^;]*;/gi);
    expect(revoke).toMatch(/PUBLIC, anon, authenticated/);
  });

  it("a row with a known actor shows their face, not the type icon", () => {
    const { container } = render(<NotificationLeading n={row({ actor_id: "hal" })} face={{ name: "Hal H.", avatarUrl: null }} />);
    expect(container.querySelector("[data-notif-face]")).not.toBeNull();
    expect(container.querySelector("[data-notif-tint]")).toBeNull();
    expect(container.textContent).toContain("HH");
  });

  it("a row with no actor, or an unreadable one, keeps the type icon", () => {
    for (const el of [
      render(<NotificationLeading n={row()} face={undefined} />).container,
      render(<NotificationLeading n={row({ actor_id: "gone" })} face={undefined} />).container,
    ]) {
      expect(el.querySelector("[data-notif-tint]")).not.toBeNull();
      expect(el.querySelector("[data-notif-face]")).toBeNull();
    }
  });

  it("the panel hands every row its face", () => {
    // Q806 (2026-11-05): the model reads the faces, the view hands them to each row.
    const model = blankComments(readFileSync(join(REPO, "src/components/NotificationPanel.tsx"), "utf8"));
    const src = blankComments(readFileSync(join(REPO, "src/components/NotificationPanelView.tsx"), "utf8"));
    expect(model).toMatch(/const faces = useNotificationFaces\(notifications\);/);
    expect(src).toMatch(/<NotificationLeading n=\{n\} face=\{n\.actor_id \? faces\.get\(n\.actor_id\) : undefined\} \/>/);
  });
});
