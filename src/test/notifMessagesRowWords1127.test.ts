/**
 * Polish audit 11-27 #65 (~/.lh-shots/polish-audit-1127/FINDINGS.md, home-account/tab-notifications--in-390--2.png):
 * Notifications settings read group "Messages" then row "Messages", and the row's line split "2 / h" across two
 * lines. The row is now "New messages", and every number + short unit in a row's line (15 min, 2 h) is held together with
 * a no-break space, in English and Spanish. Inventory: every row of the notification settings and its two words.
 *
 * @mutate src/components/notificationPreferences/constants.tsx | key: "messages", emailKey: "email_messages", label: "New messages", | key: "messages", emailKey: "email_messages", label: "Messages",
 * @mutate src/lib/i18n/enNotifPrefs.ts | reminder at 15\u00a0min and 2\u00a0h if | reminder at 15 min and 2 h if
 * @mutate src/lib/i18n/esNotifPrefs.ts | a los 15\u00a0min y a las 2\u00a0h si | a los 15 min y a las 2 h si
 */
import { describe, expect, it } from "vitest";
import { rows as jobRows, declutterRows, shopsRows } from "@/components/notificationPreferences/constants";
import { enNotifPrefs } from "@/lib/i18n/enNotifPrefs";
import { esNotifPrefs } from "@/lib/i18n/esNotifPrefs";

const rows = [...jobRows, ...declutterRows, ...shopsRows];
const lines = [
  ...rows.map((r) => [`row ${r.key}`, r.description ?? ""] as const),
  ...Object.entries(enNotifPrefs).map(([k, v]) => [`en ${k}`, v] as const),
  ...Object.entries(esNotifPrefs).map(([k, v]) => [`es ${k}`, v] as const),
];

describe("#65: the Messages row's words", () => {
  it("reads every row and word (inventory floor)", () => {
    expect(rows.length).toBeGreaterThan(10);
    expect(lines.length).toBeGreaterThan(40);
  });
  it("the row under the Messages group is New messages, not Messages again", () => {
    const m = rows.find((r) => r.key === "messages");
    expect(m?.group).toBe("Messages");
    expect(m?.label).toBe("New messages");
    expect(enNotifPrefs["np.l.messages"]).toBe("New messages");
  });
  it.each(lines)("%s keeps each number with its short unit", (_k, line) => {
    expect(line).not.toMatch(/\d (?:min|h|hr)\b/);
  });
});
