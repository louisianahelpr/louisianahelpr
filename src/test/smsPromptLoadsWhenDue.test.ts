/**
 * The phone prompt's dialog loads only once the server says it is due (B87, 11-01).
 *
 * Home mounts <SmsPhonePrompt moment="has_phone" /> lazily for every member. Its module imported the dialog
 * (Radix), SmsAlertsCard and lifecycleErrors' refusal words statically, so the lazy import's preload list made /home
 * fetch signed-in-pages, signed-in-deep and Radix (~150 KB gz) beside the dock, for members it never shows to (the
 * server answers due for a few). Now SmsPhonePrompt.tsx is the gate (switch + due read; the words load on a refusal)
 * and SmsPhonePromptDialog.tsx, loaded when due, is the dialog.
 *
 * @mutate src/components/notificationPreferences/SmsPhonePrompt.tsx | const SmsPhonePromptDialog = lazy(() => import("./SmsPhonePromptDialog")); | import SmsPhonePromptDialog from "./SmsPhonePromptDialog";
 * @mutate src/components/notificationPreferences/SmsPhonePrompt.tsx | const lifecycleErrors = () => loadModule(() => import("@/lib/lifecycleErrors")); | import * as lifecycleNow from "@/lib/lifecycleErrors";\nconst lifecycleErrors = async () => lifecycleNow;
 * @mutate src/components/notificationPreferences/SmsPhonePrompt.tsx |   if (!enabled \|\| due.data !== true) return null; |   if (!enabled) return null;
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";
import { staticReach } from "../../scripts/perf/bootReach.mjs";

const root = process.cwd();
const GATE = "src/components/notificationPreferences/SmsPhonePrompt.tsx";
/** What only the open dialog needs. */
const DIALOG_ONLY = ["src/lib/lifecycleErrors.ts", "src/components/notificationPreferences/SmsAlertsCard.tsx", "src/components/ui/dialog.tsx", "src/components/notificationPreferences/SmsPhonePromptDialog.tsx"];

describe("SmsPhonePrompt", () => {
  it("the gate's static reach holds none of the dialog's code", () => {
    const reach = new Set([...staticReach(root, [resolve(root, GATE)])].map((f) => f.replace(`${root}/`, "")));
    expect(reach.size).toBeGreaterThan(3);
    expect(DIALOG_ONLY.filter((f) => reach.has(f))).toEqual([]);
  });

  it("renders the dialog only when due", () => {
    const gate = blankComments(readFileSync(resolve(root, GATE), "utf8"));
    expect(gate).toContain('const SmsPhonePromptDialog = lazy(() => import("./SmsPhonePromptDialog"));');
    expect(gate).toContain("if (!enabled || due.data !== true) return null;");
    expect(gate).toContain("<SmsPhonePromptDialog moment={moment} />");
  });
});
