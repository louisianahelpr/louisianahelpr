import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { toast } from "sonner";
import { applyToastPolicy, confirmConsequential } from "./toastPolicy";

/**
 * A CONSEQUENTIAL CONFIRMATION MUST ACTUALLY RENDER.
 *
 * Owner ruling, 2026-09-12: "re-enable success toasts for consequential actions
 * only". The failure this guards against is not hypothetical, it is the bug
 * that prompted the ruling: `Reset link sent to ${email}` was written at the
 * call site in SecurityTab and rendered NOTHING, because the policy no-ops
 * `toast.success`. It read as live code for weeks. Pressing "Email me a
 * password reset link" really sent the email and told the user nothing.
 *
 * So these tests drive the REAL sonner store — not a spy, which would hide
 * whether the path was live — and assert the toast is in the list the
 * <Toaster /> renders from.
 */
// `getToasts()` returns `ToastT | ToastToDismiss`; only the former carries a
// title and type, so narrow before reading them.
const active = () =>
  toast
    .getToasts()
    .filter((t): t is Extract<typeof t, { title?: unknown }> => "title" in t)
    .map((t) => ({ id: t.id, title: String(t.title ?? ""), type: "type" in t ? t.type : undefined }));

describe("confirmConsequential", () => {
  beforeAll(() => {
    // Exactly as main.tsx does at boot.
    applyToastPolicy();
  });

  afterEach(() => {
    for (const t of active()) toast.dismiss(t.id);
  });

  it("renders after the policy has suppressed toast.success", () => {
    confirmConsequential("Reset link sent to someone@example.com.");
    const shown = active();
    expect(shown.map((t) => t.title), "the consequential confirmation never reached the store").toContain(
      "Reset link sent to someone@example.com.",
    );
  });

  it("keeps SUCCESS styling rather than arriving as a neutral announcement", () => {
    confirmConsequential("Dispute settled.");
    const t = active().find((x) => x.title === "Dispute settled.");
    expect(t, "not rendered").toBeTruthy();
    // It renders through the captured real `toast.success`, so the type is
    // success — the tinted check icon — not the bare callable's neutral type.
    expect(t?.type).toBe("success");
  });

  it("does NOT re-enable ordinary success toasts — trivial saves stay silent", () => {
    // The other half of the ruling. If this starts rendering, the policy has
    // been switched off wholesale rather than narrowed.
    toast.success("Saved.");
    expect(active().map((t) => t.title)).not.toContain("Saved.");
  });

  it("survives the policy being applied twice (hot reload, repeated setup)", () => {
    // A second apply must not capture the already-suppressed wrapper as the
    // "real" renderer — which would silently turn every consequential
    // confirmation back into a no-op.
    applyToastPolicy();
    confirmConsequential("Membership status refreshed.");
    expect(active().map((t) => t.title)).toContain("Membership status refreshed.");
  });
});

describe("the consequential call sites still use it", () => {
  // Derived from the source, not a hand list of what should be there. These are
  // the confirmations the audit found silently suppressed; if one is quietly
  // reverted to `toast.success`, it goes dark again with no other test noticing.
  const SITES: Array<[string, string]> = [
    ["src/components/profile/SecurityTab.tsx", "Reset link sent to"],
    ["src/components/profile/SecurityTab.tsx", "to confirm your new address"],
    ["src/components/profile/SubscriptionTab.tsx", "Membership status refreshed."],
    ["src/components/activity/postedJobCard/PostedJobActions.tsx", "Dispute resolved — payment released"],
    ["src/components/activity/appliedJobCard/DisputedSection.tsx", "the payment is off hold"],
    ["src/components/admin/AdminDisputes.tsx", "Dispute settled"],
  ];

  for (const [file, phrase] of SITES) {
    it(`${file.split("/").pop()} confirms "${phrase}" through confirmConsequential`, () => {
      const src = readFileSync(join(process.cwd(), file), "utf8");
      const at = src.indexOf(phrase);
      expect(at, `"${phrase}" is gone from ${file}`).toBeGreaterThan(-1);
      // The nearest toast call BEFORE the phrase must be the consequential one.
      const before = src.slice(Math.max(0, at - 400), at);
      const lastConsequential = before.lastIndexOf("confirmConsequential(");
      const lastSuppressed = before.lastIndexOf("toast.success(");
      expect(
        lastConsequential > lastSuppressed,
        `${file}: "${phrase}" is emitted through toast.success again, which the policy suppresses — it will render nothing`,
      ).toBe(true);
    });
  }

  it("nothing outside toastPolicy captures the real toast.success for itself", () => {
    // One sanctioned bypass. A second hand-rolled one would be an unreviewed
    // hole in the policy.
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) { walk(full); continue; }
        if (!/\.(ts|tsx)$/.test(name) || /\.test\./.test(name) || full.endsWith("toastPolicy.ts")) continue;
        if (/realSuccess|=\s*toast\.success\s*;/.test(readFileSync(full, "utf8"))) offenders.push(full);
      }
    };
    walk(join(process.cwd(), "src"));
    expect(offenders).toEqual([]);
  });
});
