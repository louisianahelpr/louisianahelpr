/**
 * Design audit area 10 #3 (11-18): the 25 Days sponsor admin (/admin/sponsors) had no rail or ⌘K row, and the four
 * stage previews were stray buttons on Reports (Messages, sign-up) and Jobs (job page) plus a card in Settings.
 * Now: "25 Days" under Engagement (a real /admin view that goes to /admin/sponsors), "Stage previews" under System
 * listing all four, and no preview button left on Reports or Jobs.
 *
 * @mutate src/components/admin/adminNavGroups.tsx |       { id: "sponsors", label: "25 Days", icon: CalendarHeart },\n |
 * @mutate src/components/admin/adminNavGroups.tsx |       { id: "previews", label: "Stage previews", icon: MonitorPlay },\n |
 * @mutate src/pages/admin/Admin.tsx |       case "sponsors": return <Navigate to="/admin/sponsors" replace />; |       case "sponsors": return null;
 * @mutate src/components/admin/AdminStagePreviews.tsx |   { href: "/admin/preview/onboarding", | //
 * @mutate src/components/admin/AdminJobs.tsx |     <AdminViewShell>\n      { |     <AdminViewShell>\n      <a href="/admin/preview/job">Preview</a>\n      {
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { adminNavGroups } from "@/components/admin/adminNavGroups";
import { STAGE_PREVIEWS } from "@/components/admin/AdminStagePreviews";
import { blankComments } from "./helpers/blankNonCode";

const read = (p: string) => blankComments(readFileSync(join(process.cwd(), p), "utf8"));
const group = (title: string) => adminNavGroups.find((g) => g.title === title)?.items.map((i) => i.id) ?? [];

describe("25 Days and Stage previews have menu rows (design audit area 10 #3)", () => {
  it("the rail lists both, in Engagement and System", () => {
    expect(adminNavGroups.flatMap((g) => g.items).length).toBeGreaterThan(20);
    expect(group("Engagement")).toContain("sponsors");
    expect(group("System")).toContain("previews");
  });

  it("both are real /admin views; 25 Days goes to its own route", () => {
    const admin = read("src/pages/admin/Admin.tsx");
    expect(admin).toMatch(/sponsors: "25 Days"/);
    expect(admin).toMatch(/previews: "Stage previews"/);
    expect(admin).toMatch(/case "sponsors": return <Navigate to="\/admin\/sponsors" replace \/>;/);
    expect(admin).toMatch(/case "previews": return <AdminStagePreviews \/>;/);
  });

  it("Stage previews lists every /admin/preview route App.tsx serves", () => {
    const app = read("src/App.tsx");
    const routes = [...app.matchAll(/path="(\/admin\/preview\/[a-z]+)"/g)].map((m) => m[1]);
    expect(routes.length).toBeGreaterThanOrEqual(4);
    expect(STAGE_PREVIEWS.map((p) => p.href).sort()).toEqual([...routes].sort());
  });

  it("no stray preview button is left on Reports or Jobs", () => {
    for (const p of ["src/components/admin/AdminReports.tsx", "src/components/admin/AdminJobs.tsx"]) {
      const src = read(p);
      expect(src.length, p).toBeGreaterThan(1000);
      expect(src, p).not.toMatch(/\/admin\/preview\//);
    }
  });
});
