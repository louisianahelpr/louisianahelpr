/*
 * CLASS GUARD (Q230): every notification PRODUCER the backend has is either
 * asserted by a journey leg or annotated uncovered with its reason — in both
 * directions.
 *
 * The instance: e2e/journeys/notifications/notifications.spec.ts said the legs
 * it could not drive were "annotated uncovered", yet direct offer, saved-search
 * match, job-match fan-out, tip and the cron notifications had neither an
 * annotation nor a leg. A promise in a comment is not coverage.
 *
 * The inventory is DERIVED FROM SOURCE (src/test/helpers/notificationProducers.ts:
 * every SQL function whose effective definition inserts into notifications,
 * every edge-function file that does, every create-notification template), so
 * a new producer fails here until it is registered in
 * e2e/journeys/notifications/producers.ts. A `driven` entry must name a spec
 * under e2e/journeys/ whose CODE (comments blanked) contains its evidence.
 */
// @mutate e2e/journeys/notifications/producers.ts |   "sql:notify_helper_on_tip": { driven: { spec: MONEY, evidence: "type=eq.financial_alerts" } },\n |
// @mutate e2e/journeys/04-money-outcomes.spec.ts | `type=eq.financial_alerts&job_id=eq.${jobId} | `type=eq.payment&job_id=eq.${jobId}
// @mutate e2e/journeys/notifications/notifications.spec.ts | `type=eq.new_offers&job_id=eq.${job.id}` | `type=eq.offers&job_id=eq.${job.id}`
// @mutate src/test/helpers/notificationProducers.ts | const viaHelper = /\binsertNotifications\s*\(/.test(code); | const viaHelper = false;
// @mutate e2e/journeys/notifications/notifications.spec.ts |     const open = uncoveredProducers(); |     const open: ReturnType<typeof uncoveredProducers> = [];
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { NOTIFICATION_PRODUCERS } from "../../e2e/journeys/notifications/producers";
import { blankComments } from "./helpers/blankNonCode";
import { edgeProducers, notificationProducerInventory, sqlProducers, templateProducers } from "./helpers/notificationProducers";

const ROOT = resolve(__dirname, "..", "..");
const code = (rel: string) => blankComments(readFileSync(join(ROOT, rel), "utf8"));

describe("every notification producer is asserted by a journey or annotated uncovered (Q230)", () => {
  const inventory = notificationProducerInventory(ROOT);
  const registered = Object.keys(NOTIFICATION_PRODUCERS);

  it("derives a real inventory from source (cannot pass vacuously)", () => {
    // 2026-09-26: 42 SQL (= the 42 live functions whose pg_get_functiondef
    // inserts into notifications, name for name), 37 edge files, 12 templates.
    expect(sqlProducers(ROOT).length).toBeGreaterThan(38);
    expect(edgeProducers(ROOT).length).toBeGreaterThan(32);
    expect(templateProducers(ROOT).length).toBeGreaterThan(9);
    expect(inventory.length).toBeGreaterThan(85);
    // Each kind of producer the parser claims to find is found.
    expect(inventory).toContain("sql:notify_helper_on_tip"); // trigger function
    expect(inventory).toContain("sql:sweep_no_show_alerts"); // cron sweep
    expect(inventory).toContain("edge:create-payment"); // via insertNotifications(
    expect(inventory).toContain("edge:expiring-jobs-push"); // via .from("notifications").insert(
    expect(inventory).toContain("template:work_started");
  });

  it("every producer in source has a registry entry", () => {
    const missing = inventory.filter((p) => !(p in NOTIFICATION_PRODUCERS));
    expect(
      missing,
      "notification producers with no entry in e2e/journeys/notifications/producers.ts — assert the row in a journey " +
        "leg, or register it `uncovered` with the concrete reason it cannot run:\n  " + missing.join("\n  "),
    ).toEqual([]);
  });

  it("every registry entry is still a producer in source (two-way)", () => {
    const stale = registered.filter((p) => !inventory.includes(p));
    expect(stale, "entries for producers that no longer exist — remove them").toEqual([]);
  });

  it("a driven entry's spec is a journey and really asserts on its evidence", () => {
    const bad: string[] = [];
    for (const [producer, c] of Object.entries(NOTIFICATION_PRODUCERS)) {
      if (!("driven" in c)) continue;
      const { spec, evidence } = c.driven;
      if (!spec.startsWith("e2e/journeys/") || !existsSync(join(ROOT, spec))) bad.push(`${producer}: ${spec} is not a journey spec`);
      else if (!code(spec).includes(evidence)) bad.push(`${producer}: ${spec} no longer contains ${evidence}`);
    }
    expect(bad).toEqual([]);
  });

  it("every uncovered entry carries a concrete reason, and the notifications journey announces them", () => {
    for (const [producer, c] of Object.entries(NOTIFICATION_PRODUCERS)) {
      if ("uncovered" in c) expect(c.uncovered.length, `${producer}: give the concrete reason`).toBeGreaterThan(40);
    }
    const spec = code("e2e/journeys/notifications/notifications.spec.ts");
    expect(spec, "notifications.spec.ts no longer announces the uncovered producers").toMatch(/const open = uncoveredProducers\(\);/);
    expect(spec).toMatch(/annotations\.push\(\{ type: "uncovered"/);
  });
});
