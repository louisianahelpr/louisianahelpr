/**
 * Q1996: "Connect calendar" said "Calendar connected" even when the first sync it had just run failed (measured on
 * prod 2026-10-17: str-ical-sync answered 200 with results[0].error "We couldn't load that calendar feed...", while
 * the card under the toast already read "Sync failed"). The add mutation now READS the first sync's answer, and the
 * toast says the calendar was saved but couldn't be read yet.
 *
 * @mutate src/pages/profile/StrSettings.tsx |           if (res.ok) syncError = firstSyncError(await res.json()); |           if (res.ok) await res.json();
 * @mutate src/pages/profile/StrSettings.tsx |       toast(connectedToastText(saved.syncError)); |       toast(connectedToastText(null));
 * @mutate src/pages/profile/strSettings/strSettingsHelpers.ts |   return syncError ? `Calendar saved, but we couldn't read it yet: ${syncError}` : "Calendar connected"; |   return "Calendar connected";
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { connectedToastText, firstSyncError } from "@/pages/profile/strSettings/strSettingsHelpers";

const page = blankComments(readFileSync(resolve(__dirname, "../pages/profile/StrSettings.tsx"), "utf8")).replace(/\s+/g, " ");

describe("Connect calendar reads its first sync (Q1996)", () => {
  it("a failed first sync is not a plain success", () => {
    const failed = { synced: 1, results: [{ connection_id: "c1", error: "We couldn't load that calendar feed. Check the link." }] };
    const err = firstSyncError(failed);
    expect(err).toBe("We couldn't load that calendar feed. Check the link.");
    expect(connectedToastText(err)).toBe("Calendar saved, but we couldn't read it yet: We couldn't load that calendar feed. Check the link.");
    expect(connectedToastText(err)).not.toBe("Calendar connected");
  });

  it("a good first sync, or no answer at all, says Calendar connected", () => {
    expect(connectedToastText(firstSyncError({ synced: 1, results: [{ connection_id: "c1", turnovers_imported: 2 }] }))).toBe("Calendar connected");
    for (const body of [null, {}, { results: [] }, { results: [{ error: "  " }] }, { results: [{ error: 42 }] }, "oops"]) {
      expect(firstSyncError(body), JSON.stringify(body)).toBeNull();
    }
  });

  it("the add mutation reads the answer and the toast uses it", () => {
    expect(page.length).toBeGreaterThan(2000);
    expect(page).toContain("if (res.ok) syncError = firstSyncError(await res.json());");
    expect(page).toContain("return { ...data, syncError };");
    expect(page).toContain("toast(connectedToastText(saved.syncError));");
    expect(page).not.toContain('toast("Calendar connected")');
  });
});
