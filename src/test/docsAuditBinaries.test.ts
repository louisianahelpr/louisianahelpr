// Q1306: audit output must not keep growing the repo (.git was 485 MB on
// 2026-10-04). Screenshots and other binary evidence go to ~/.lh-shots (the
// CLAUDE.md rule for visual evidence), never under docs/audit. The files
// already tracked there are listed below, EXACTLY: a new binary under
// docs/audit fails, and so does an entry whose file was removed (lower the
// list in the same commit). Rewriting history to drop the old ones is not
// worth it (OPEN.md Q1306).
//
// The inventory is the git index (`git ls-files docs/audit`), so a file that is
// only on disk (untracked evidence, a local run) is not counted.
//
// @mutate src/test/helpers/docsAuditBinaries.ts | export const AUDIT_BINARY = /\.(png | export const AUDIT_BINARY = /\.(nomatchpng
import { describe, it, expect } from "vitest";
import { AUDIT_BINARY, trackedAuditFiles } from "./helpers/docsAuditBinaries";

const tracked = trackedAuditFiles();
const binaries = tracked.filter((f) => AUDIT_BINARY.test(f)).sort();

// @two-way src/test/docsAuditBinaries.test.ts:stale entry: no longer tracked
const LEGACY_AUDIT_BINARIES: readonly string[] = [
  "docs/audit/launch-2026-09/lanes/e2e/shots/ghost-job-after-1440-dark.png",
  "docs/audit/launch-2026-09/lanes/e2e/shots/ghost-job-after-375-light.png",
  "docs/audit/launch-2026-09/lanes/e2e/shots/ghost-job-before-1440-dark.png",
  "docs/audit/launch-2026-09/lanes/e2e/shots/ghost-job-before-375-light.png",
  "docs/audit/launch-2026-09/lanes/e2e/shots/unfunded-cancel-dialog-375.png",
  "docs/audit/launch-2026-09/lanes/e2e/shots/unfunded-cancel-toast-375.png",
  "docs/audit/launch-2026-09/lanes/lh-state-matrix/shots/019-browse-guest-phone-light.png",
  "docs/audit/launch-2026-09/lanes/lh-state-matrix/shots/081-customer-dashboard-phone-light.png",
  "docs/audit/launch-2026-09/lanes/lh-state-matrix/shots/avail-before.png",
  "docs/audit/launch-2026-09/lanes/lh-state-matrix/shots/crop-081-customer-dashboard-phone-light.png",
  "docs/audit/launch-2026-09/lanes/lh-state-matrix/shots/sheet-live-375L.png",
  "docs/audit/loading-states/customer_dashboard.loaded.png",
  "docs/audit/loading-states/customer_dashboard.loading.png",
  "docs/audit/loading-states/customer_messages.loaded.png",
  "docs/audit/loading-states/customer_messages.loading.png",
  "docs/audit/loading-states/skel-probe-after/customer_profile_tab_gift_card.loaded.png",
  "docs/audit/loading-states/skel-probe-after/customer_profile_tab_gift_card.loading.png",
  "docs/audit/loading-states/skel-probe-after/customer_profile_tab_pets.loaded.png",
  "docs/audit/loading-states/skel-probe-after/customer_profile_tab_pets.loading.png",
  "docs/audit/loading-states/skel-probe-after/customer_profile_tab_work_record.loaded.png",
  "docs/audit/loading-states/skel-probe-after/customer_profile_tab_work_record.loading.png",
  "docs/audit/loading-states/skel-probe/customer_profile_tab_gift_card.loaded.png",
  "docs/audit/loading-states/skel-probe/customer_profile_tab_gift_card.loading.png",
  "docs/audit/loading-states/skel-probe/customer_profile_tab_pets.loaded.png",
  "docs/audit/loading-states/skel-probe/customer_profile_tab_pets.loading.png",
  "docs/audit/loading-states/skel-probe/customer_profile_tab_work_record.loaded.png",
  "docs/audit/loading-states/skel-probe/customer_profile_tab_work_record.loading.png",
  "docs/audit/shots/referral-code-input/before.png",
  "docs/audit/visual-notes-2026-09-14/vn-1-after-vn1-detail-375.webp",
  "docs/audit/visual-notes-2026-09-14/vn-1-before-vn1-detail-375.webp",
  "docs/audit/visual-notes-2026-09-14/vn-12-after-public-profile-1440.webp",
  "docs/audit/visual-notes-2026-09-14/vn-12-before-public-profile-1440.webp",
  "docs/audit/visual-notes-2026-09-14/vn-13-after-public-profile-1440.webp",
  "docs/audit/visual-notes-2026-09-14/vn-14-after-vn14-hallie-375.webp",
  "docs/audit/visual-notes-2026-09-14/vn-14-before-vn14-hallie-375.webp",
  "docs/audit/visual-notes-2026-09-14/vn-15-after-vn15-reviews-375.webp",
  "docs/audit/visual-notes-2026-09-14/vn-15-before-vn15-reviews-375.webp",
  "docs/audit/visual-notes-2026-09-14/vn-16-after-vn16-profile-375.webp",
  "docs/audit/visual-notes-2026-09-14/vn-16-before-vn16-profile-375.webp",
  "docs/audit/visual-notes-2026-09-14/vn-17-after-public-profile-1440.webp",
  "docs/audit/visual-notes-2026-09-14/vn-18-after-jobs-confirmed-1440.webp",
  "docs/audit/visual-notes-2026-09-14/vn-18-before-jobs-confirmed-1440.webp",
  "docs/audit/visual-notes-2026-09-14/vn-19-after-jobs-working-1440.webp",
  "docs/audit/visual-notes-2026-09-14/vn-19-before-jobs-needsyou-1440-dresser.webp",
  "docs/audit/visual-notes-2026-09-14/vn-2-after-applied-detail-1440.webp",
  "docs/audit/visual-notes-2026-09-14/vn-2-before-applied-detail-1440.webp",
  "docs/audit/visual-notes-2026-09-14/vn-20-after-vn20-map-1440-dresser.webp",
  "docs/audit/visual-notes-2026-09-14/vn-20-before-vn20-map-1440-dresser.webp",
  "docs/audit/visual-notes-2026-09-14/vn-21-after-jobs-375-ontheway.webp",
  "docs/audit/visual-notes-2026-09-14/vn-21-before-jobs-375-ontheway.webp",
  "docs/audit/visual-notes-2026-09-14/vn-22-after-vn22-posts-1440-expanded.webp",
  "docs/audit/visual-notes-2026-09-14/vn-22-before-vn22-posts-1440-expanded.webp",
  "docs/audit/visual-notes-2026-09-14/vn-23-after-vn23-disputed-1440.webp",
  "docs/audit/visual-notes-2026-09-14/vn-23-before-vn23-disputed-1440.webp",
  "docs/audit/visual-notes-2026-09-14/vn-24-after-vn24-support-1440.webp",
  "docs/audit/visual-notes-2026-09-14/vn-24-before-vn24-support-1440.webp",
  "docs/audit/visual-notes-2026-09-14/vn-25-after-chat3-1440.webp",
  "docs/audit/visual-notes-2026-09-14/vn-25-before-chat-1440.webp",
  "docs/audit/visual-notes-2026-09-14/vn-26-after-myposts-done-1440.webp",
  "docs/audit/visual-notes-2026-09-14/vn-27-after-myposts-done-1440.webp",
  "docs/audit/visual-notes-2026-09-14/vn-28-after-jobs-working-1440.webp",
  "docs/audit/visual-notes-2026-09-14/vn-29-after-vn29-done-1440.webp",
  "docs/audit/visual-notes-2026-09-14/vn-29-before-vn29-done-1440.webp",
  "docs/audit/visual-notes-2026-09-14/vn-3-after-earn-375-final.webp",
  "docs/audit/visual-notes-2026-09-14/vn-3-before-earn-1440-final.webp",
  "docs/audit/visual-notes-2026-09-14/vn-30-after-vn30-review-375.webp",
  "docs/audit/visual-notes-2026-09-14/vn-31-after-myjobs-search-1440.webp",
  "docs/audit/visual-notes-2026-09-14/vn-31-before-myjobs-search-1440.webp",
  "docs/audit/visual-notes-2026-09-14/vn-32-after-frame-02-381ms.webp",
  "docs/audit/visual-notes-2026-09-14/vn-32-before-frame-03-674ms.webp",
  "docs/audit/visual-notes-2026-09-14/vn-33-after-fix-after-375.webp",
  "docs/audit/visual-notes-2026-09-14/vn-33-before-dbg-after-1440.webp",
  "docs/audit/visual-notes-2026-09-14/vn-34-after-jobs-working-1440.webp",
  "docs/audit/visual-notes-2026-09-14/vn-35-after-messages-search-1440.webp",
  "docs/audit/visual-notes-2026-09-14/vn-35-before-messages-search-1440.webp",
  "docs/audit/visual-notes-2026-09-14/vn-36-after-profile-reviews-1440.webp",
  "docs/audit/visual-notes-2026-09-14/vn-36-before-profile-reviews-1440.webp",
  "docs/audit/visual-notes-2026-09-14/vn-37-after-vn37-myposts-1440.webp",
  "docs/audit/visual-notes-2026-09-14/vn-37-before-vn37-reviews-1440.webp",
  "docs/audit/visual-notes-2026-09-14/vn-38-after-edit-profile-1440-zip.webp",
  "docs/audit/visual-notes-2026-09-14/vn-38-before-edit-profile-1440-zip.webp",
  "docs/audit/visual-notes-2026-09-14/vn-4-after-linkpresentation-share-preview.webp",
  "docs/audit/visual-notes-2026-09-14/vn-40-after-vn40-after-save-1440.webp",
  "docs/audit/visual-notes-2026-09-14/vn-41-after-sched-jobs-1440.webp",
  "docs/audit/visual-notes-2026-09-14/vn-41-before-sched-jobs-1440.webp",
  "docs/audit/visual-notes-2026-09-14/vn-42-after-saved-helpers-1440.webp",
  "docs/audit/visual-notes-2026-09-14/vn-42-before-saved-helpers-1440.webp",
  "docs/audit/visual-notes-2026-09-14/vn-43-after-gift-card-1440-occasion.webp",
  "docs/audit/visual-notes-2026-09-14/vn-43-before-gift-card-1440-occasion.webp",
  "docs/audit/visual-notes-2026-09-14/vn-44-after-vn44-plus-375.webp",
  "docs/audit/visual-notes-2026-09-14/vn-44-before-vn44-plus-375.webp",
  "docs/audit/visual-notes-2026-09-14/vn-45-after-referrals-breakdown-1440.webp",
  "docs/audit/visual-notes-2026-09-14/vn-46-notifications-1440-bottom.png",
  "docs/audit/visual-notes-2026-09-14/vn-46-notifications-375-bottom.png",
  "docs/audit/visual-notes-2026-09-14/vn-47-after-datarights-signedin-375.webp",
  "docs/audit/visual-notes-2026-09-14/vn-47-before-datarights-signedin-1440.webp",
  "docs/audit/visual-notes-2026-09-14/vn-48-after-postjob-1440-photo.webp",
  "docs/audit/visual-notes-2026-09-14/vn-48-before-postjob-1440-photo.webp",
  "docs/audit/visual-notes-2026-09-14/vn-49-after-postjob-1440-photo.webp",
  "docs/audit/visual-notes-2026-09-14/vn-5-after-browse-search-1440.webp",
  "docs/audit/visual-notes-2026-09-14/vn-5-before-browse-search-1440.webp",
  "docs/audit/visual-notes-2026-09-14/vn-51-after-postjob-recurring-375.webp",
  "docs/audit/visual-notes-2026-09-14/vn-53-after-vn53-picker-roundtrip-1440.webp",
  "docs/audit/visual-notes-2026-09-14/vn-53-before-vn53-picker-roundtrip-1440.webp",
  "docs/audit/visual-notes-2026-09-14/vn-54-after-profile-business-name-pending-vs-verified-375.webp",
  "docs/audit/visual-notes-2026-09-14/vn-55-after-vn55-address-375.webp",
  "docs/audit/visual-notes-2026-09-14/vn-55-before-vn55-address-375.webp",
  "docs/audit/visual-notes-2026-09-14/vn-6-after-browse-recents-1440.webp",
  "docs/audit/visual-notes-2026-09-14/vn-6-before-browse-recents-1440.webp",
  "docs/audit/visual-notes-2026-09-14/vn-7-after-browse-filters-tall-1920.webp",
  "docs/audit/visual-notes-2026-09-14/vn-7-before-browse-filters-tall-1920.webp",
  "docs/audit/visual-notes-2026-09-14/vn-8-after-browse-filters-tall-1920.webp",
  "docs/audit/visual-notes-2026-09-14/vn10-1440-fallback-detail.jpg",
  "docs/audit/visual-notes-2026-09-14/vn10-1440-pin-not-in-list.jpg",
  "docs/audit/visual-notes-2026-09-14/vn11-375-before.jpg",
  "docs/audit/visual-notes-2026-09-14/vn11-375-denied.jpg",
  "docs/audit/visual-notes-2026-09-14/vn11-375-granted.jpg",
  "docs/audit/visual-notes-2026-09-14/vn11-375-rationale.jpg",
  "docs/audit/visual-notes-2026-09-14/vn9-1440-dark-preview.jpg",
  "docs/audit/visual-notes-2026-09-14/vn9-1440-light-preview.jpg",
  "docs/audit/visual-notes-2026-09-14/vn9-375-light-preview.jpg",
];

describe("Q1306: no new binary audit output under docs/audit", () => {
  it("inventory: docs/audit is listed from the git index (floor)", () => {
    expect(tracked.length).toBeGreaterThan(100);
    expect(binaries.length).toBeGreaterThan(50);
  });

  it("no binary under docs/audit beyond the legacy list (screenshots go to ~/.lh-shots)", () => {
    const legacy = new Set(LEGACY_AUDIT_BINARIES);
    expect(binaries.filter((f) => !legacy.has(f))).toEqual([]);
  });

  it("every legacy entry is still tracked (stale entry: no longer tracked -> remove it from the list)", () => {
    const now = new Set(binaries);
    expect(LEGACY_AUDIT_BINARIES.filter((f) => !now.has(f))).toEqual([]);
  });
});
