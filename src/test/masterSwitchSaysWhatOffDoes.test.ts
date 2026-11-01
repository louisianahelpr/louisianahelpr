/**
 * AUD31-47 (audit 10-31, Admin > Notifications): the master switches read "All In-App — Mutes every push below."
 * and "All Email — Mutes every email below." beside switches that are ON while push and email are SENT
 * (`checked={allPushOn}`), so an ON switch read as "mute". The member's own email master had the same tooltip.
 * Every master switch line now says what Off does, and the push one is named "push", the channel it controls.
 *
 * @mutate src/components/admin/AdminNotifications.tsx | Off mutes every push below. | Mutes every push below.
 * @mutate src/components/admin/AdminNotifications.tsx | Off mutes every email below. | Mutes every email below.
 * @mutate src/components/admin/AdminNotifications.tsx |                   All push |                   All In-App
 * @mutate src/components/NotificationPreferences.tsx | title="Off mutes every email below. | title="Mutes every email below.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { blankComments } from "@/test/helpers/blankNonCode";

const FILES = ["src/components/admin/AdminNotifications.tsx", "src/components/NotificationPreferences.tsx"];
const code = (f: string) => blankComments(readFileSync(f, "utf8"));

describe("AUD31-47: a master switch that is ON while sending says what Off does", () => {
  it("no master line says 'Mutes every ...' on its own", () => {
    // Floor (vacuity scan): both real files were read (16 KB + 44 KB on 10-31), so an empty read can't pass.
    for (const f of FILES) expect(code(f).length, f).toBeGreaterThan(5_000);
    const lines = FILES.flatMap((f) => [...code(f).matchAll(/[^\n]*Mutes every[^\n]*/g)].map((m) => `${f}: ${m[0].trim()}`));
    expect(lines).toEqual([]);
    const said = FILES.flatMap((f) => [...code(f).matchAll(/Off mutes every (push|email) below\./g)].map((m) => m[1]));
    expect(said.sort()).toEqual(["email", "email", "push"]);
  });

  it("the admin push master is named for push, not In-App", () => {
    const admin = code(FILES[0]);
    expect(admin).not.toMatch(/All In-App/);
    expect(admin).toMatch(/>\s*All push\s*</);
    expect(admin).toMatch(/>\s*All email\s*</);
  });
});
