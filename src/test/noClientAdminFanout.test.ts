/**
 * Q308: create-notification refuses a non-admin caller sending to an admin
 * (403 before Q223, 400 for non-admin free text since), so a client loop over
 * user_roles admins calling createNotification can never deliver. Two such
 * loops (decline offer, no-show) sat in src/ reporting a failure on every run
 * while admins received nothing. Admin notices belong in the server path that
 * owns the event (the consequence ladders page the ban review themselves).
 *
 * Class check: no non-test file under src/ both reads admins from user_roles
 * and calls createNotification.
 *
 * @mutate src/components/job-card/activityActions/useOfferHandlers.ts | import { notifyJobParty } from "@/lib/notifications"; | import { notifyJobParty, createNotification } from "@/lib/notifications";\nconst _q308 = () => supabase.from("user_roles").select("user_id").eq("role", "admin").then(() => createNotification({} as never));
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const SRC = resolve(__dirname, "..");
const walk = (d: string): string[] =>
  readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    if (statSync(p).isDirectory()) return n === "test" ? [] : walk(p);
    return /\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
  });
const files = walk(SRC);

describe("no client fan-out to admins through create-notification (Q308)", () => {
  it("walks src/", () => {
    expect(files.length).toBeGreaterThan(200);
  });

  it("no file reads user_roles admins and calls createNotification", () => {
    const offenders = files.filter((f) => {
      const s = blankComments(readFileSync(f, "utf8"));
      return /from\(\s*["']user_roles["']\s*\)[\s\S]{0,200}?eq\(\s*["']role["']\s*,\s*["']admin["']\s*\)/.test(s) && /\bcreateNotification\s*\(/.test(s);
    });
    expect(offenders.map((f) => f.slice(SRC.length + 1))).toEqual([]);
  });
});
