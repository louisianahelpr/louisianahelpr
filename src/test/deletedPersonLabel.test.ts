/**
 * Q369 (owner, 2026-09-24): a person who deleted their account reads
 * "Former member" to users and "Deleted account" on admin screens, everywhere.
 *
 * Before this, eight surfaces each spelled it their own way ("Former Helpr",
 * "Deleted user", "Account deleted", "Deleted account", "Helpr"). The labels
 * now live in src/lib/deletedPerson.ts; this fails if any file under src/
 * spells one of the old variants as a string literal again, or if a surface
 * that renders a nullable person id stops using the shared label.
 */
// @mutate src/components/GroupJobHelpers.tsx | FORMER_MEMBER_LABEL | "Former Helpr"
// @mutate src/components/admin/AdminJobs.tsx | ADMIN_DELETED_ACCOUNT_LABEL | "Deleted user"
// @mutate src/components/activity/postedJobCard/steps/CompletedStep.tsx | || "Helpr" : FORMER_MEMBER_LABEL; | \|\| "Helpr" : "Helpr";
// @mutate src/pages/messages/messagesData/loadConversations.ts | FORMER_MEMBER_LABEL | "Deleted account"
// @mutate src/lib/deletedPerson.ts | = "Former member"; | = "Former Helpr";
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { ADMIN_DELETED_ACCOUNT_LABEL, FORMER_MEMBER_LABEL } from "@/lib/deletedPerson";

const SRC = join(__dirname, "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && !p.includes("integrations/supabase")) out.push(p);
  }
  return out;
}

const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");

describe("one label for a deleted person", () => {
  it("is Former member for users and Deleted account for admins", () => {
    expect(FORMER_MEMBER_LABEL).toBe("Former member");
    expect(ADMIN_DELETED_ACCOUNT_LABEL).toBe("Deleted account");
  });

  it("no file under src/ spells a deleted-person label as a literal", () => {
    const bad = /["'`](Former Helpr|Former member|Deleted user|Deleted account|Account deleted)["'`]/;
    const hits = walk(SRC)
      .filter((f) => !f.endsWith(join("lib", "deletedPerson.ts")))
      .flatMap((f) =>
        readFileSync(f, "utf8")
          .split("\n")
          .map((l, i) => ({ l, i }))
          .filter(({ l }) => !/^\s*(\/\/|\*)/.test(l) && bad.test(l))
          .map(({ i }) => `${relative(SRC, f)}:${i + 1}`),
      );
    expect(hits).toEqual([]);
  });

  it("every surface that renders a nullable person id uses the shared label", () => {
    const users = [
      "components/GroupJobHelpers.tsx",
      "hooks/useActivityData.ts",
      "hooks/useProfileTabData.ts",
      "components/reviewPanel/ReviewList.tsx",
      "pages/userProfile/useUserProfileData.ts",
      "pages/giftCards/CreditCard.tsx",
      "pages/messages/messagesData/loadConversations.ts",
      "components/activity/postedJobCard/steps/CompletedStep.tsx",
      "components/activity/postedJobCard/steps/InProgressStep.tsx",
      "components/activity/postedJobCard/steps/DisputedStep.tsx",
    ];
    const admins = [
      "components/admin/AdminReferrals.tsx",
      "components/admin/AdminStalledJobs.tsx",
      "components/admin/AdminJobs.tsx",
      "components/admin/AdminReports.tsx",
      "components/admin/adminDisputes/DisputeCard.tsx",
    ];
    for (const f of users) expect(read(f), f).toMatch(/FORMER_MEMBER_LABEL[^,;\n]*[;,)\n}]/);
    for (const f of admins) expect(read(f), f).toContain("ADMIN_DELETED_ACCOUNT_LABEL");
  });

  it("a completed job's missing Helpr is a former member, not 'Helpr'", () => {
    expect(read("components/activity/postedJobCard/steps/CompletedStep.tsx")).toContain(
      '|| "Helpr" : FORMER_MEMBER_LABEL;',
    );
  });
});
