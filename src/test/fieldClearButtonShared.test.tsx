/**
 * Q2709 "nothing hand-made" (Admin packet, Builder 2, 2026-11-06; lead: convert ONLY what stays look-identical).
 * The admin search fields' "Clear search" ✕ (command palette, notification logs, referrals, users, settings user
 * search) were hand-made <button>s with one class set; they are the shared FieldClearButton now. Look-identical by
 * construction: the rendered class SET equals the hand-made literal (CSS does not read class order), type stays
 * "button", and each caller keeps its handlers (focus kept on press: onMouseDown preventDefault).
 *
 * @mutate src/components/ui/FieldClearButton.tsx | !min-h-0 !min-w-0 h-7 w-7 ctl-exit | h-7 w-7 ctl-exit
 * @mutate src/components/ui/FieldClearButton.tsx |     <button ref={ref} type="button" {...props} |     <button ref={ref} {...props}
 * @mutate src/components/admin/AdminUsers.tsx |               className="right-1.5" |               className="right-2"
 * @mutate src/components/admin/settings/AdminUserSearchField.tsx |           onMouseDown={(e) => e.preventDefault()} |           onMouseDown={() => undefined}
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { FieldClearButton } from "@/components/ui/FieldClearButton";

const set = (cls: string) => [...new Set(cls.split(/\s+/).filter(Boolean))].sort();
const HAND_MADE =
  "absolute right-1.5 top-1/2 -translate-y-1/2 !min-h-0 !min-w-0 h-7 w-7 ctl-exit inline-flex items-center justify-center text-muted-foreground hover:text-foreground ctl-tint btn-press transition";
const FILES = [
  "src/components/admin/AdminCommandPalette.tsx",
  "src/components/admin/AdminNotificationLogs.tsx",
  "src/components/admin/AdminReferrals.tsx",
  "src/components/admin/AdminUsers.tsx",
  "src/components/admin/settings/AdminUserSearchField.tsx",
];

describe("the admin search ✕ is the shared FieldClearButton, class for class the hand-made look", () => {
  it("renders the hand-made class set with the caller's inset, as type=button", () => {
    const b = render(<FieldClearButton aria-label="Clear search" className="right-1.5">x</FieldClearButton>).container.querySelector("button")!;
    expect(set(b.className)).toEqual(set(HAND_MADE));
    expect(b.getAttribute("type")).toBe("button");
    // It is centred by -translate-y-1/2, so its only press class is btn-press, whose :active rule keeps the translate
    // (pressKeepsTranslate.test.ts; these Xs left that file's hand-made inventory with this conversion).
    expect(b.className.split(/\s+/).filter((c) => /press/.test(c))).toEqual(["btn-press"]);
  });

  it("every admin search field uses it with right-1.5 and keeps focus on press; none keeps the hand-made ✕", () => {
    for (const f of FILES) {
      const s = readFileSync(f, "utf8");
      expect(s, f).not.toContain("!min-h-0 !min-w-0 h-7 w-7 ctl-exit");
      const at = s.indexOf("<FieldClearButton\n");
      expect(at, f).toBeGreaterThan(-1);
      const end = s.indexOf('className="right-1.5"', at);
      expect(end, f).toBeGreaterThan(at);
      const tag = s.slice(at, end + 'className="right-1.5"'.length);
      expect(tag, f).toContain('aria-label="Clear search"');
      expect(tag, f).toContain("onMouseDown={(e) => e.preventDefault()}");
      expect(tag, f).toContain('className="right-1.5"');
    }
  });
});
