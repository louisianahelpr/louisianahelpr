/**
 * Q2709 "nothing hand-made" (Declutter packet, Builder 2, 2026-11-06; lead: convert ONLY what stays look-identical).
 * Declutter's hidden photo pickers (Sell photos, bunch photos and per-item add, wanted photo, problem photos,
 * handover proof, return drop-off and receipt) were hand-made <input type="file" className="sr-only"> (one
 * "peer sr-only"); they are the shared HiddenFileInput now. Nothing visible can change: the class SET is the
 * hand-made one, the input stays type=file and focusable, and every caller keeps its own accept / capture /
 * multiple / tabIndex / handlers (uploadMimeParity still reads each accept= at the call site).
 * Post a job (packet 2, same day): the photo grid, first-photo tile and video tile pickers.
 * Profile (packet 3): Edit profile photo and the profile gate (CompleteProfile) required photo.
 * Jobs (packet 4): the applied job card's "Add cert or work sample" picker.
 * The rest (packet 5): dispute evidence (2), Helpr Guarantee, sign-up photo, send-a-quote photos, rentals (2).
 *
 * @mutate src/components/ui/HiddenFileInput.tsx | className={peer ? "peer sr-only" : "sr-only"} | className={peer ? "peer hidden" : "hidden"}
 * @mutate src/components/ui/HiddenFileInput.tsx | <input ref={ref} type="file" | <input ref={ref}
 * @mutate src/components/declutter/DeclutterBunchPhotos.tsx | <HiddenFileInput id={addId} accept="image/*" multiple peer | <HiddenFileInput id={addId} accept="image/*" multiple
 * @mutate src/components/declutter/DeclutterSellPhotos.tsx | <HiddenFileInput id="sell-files" accept="image/*" multiple | <HiddenFileInput id="sell-files" accept="image/*"
 * @mutate src/components/postjob/detailsSection/VideoScope.tsx | <HiddenFileInput accept="video/*" | <HiddenFileInput accept="image/*"
 * @mutate src/pages/auth/CompleteProfile.tsx |                   id="avatar"\n                  accept="image/*" |                   accept="image/*"
 * @mutate src/pages/jobs/appliedJobCard/PendingApplicationSection.tsx |             <HiddenFileInput |             <input type="file" className="sr-only"
 * @mutate src/components/DisputeDialog.tsx | <HiddenFileInput accept="image/*" multiple onChange={handleFileChange} /> | <input type="file" accept="image/*" multiple onChange={handleFileChange} className="sr-only" />
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { HiddenFileInput } from "@/components/ui/HiddenFileInput";

// file -> how many hidden pickers it had (all now HiddenFileInput), and whether one was a peer of its label.
const FILES: Record<string, { n: number; peer?: boolean }> = {
  "src/components/declutter/DeclutterRefundReturn.tsx": { n: 2 },
  "src/components/declutter/DeclutterHandoverViews.tsx": { n: 1 },
  "src/components/declutter/DeclutterBunchPhotos.tsx": { n: 1, peer: true },
  "src/components/declutter/DeclutterProblemPhotos.tsx": { n: 1 },
  "src/components/declutter/DeclutterWantedViews.tsx": { n: 1 },
  "src/components/declutter/DeclutterBunchView.tsx": { n: 1 },
  "src/components/declutter/DeclutterSellPhotos.tsx": { n: 1 },
};

describe("Declutter's hidden photo pickers are the shared HiddenFileInput, class for class the hand-made look", () => {
  it("renders a type=file input with exactly sr-only (or peer sr-only), passing the caller's attributes", () => {
    const a = render(<HiddenFileInput id="a" accept="image/*" multiple tabIndex={-1} />).container.querySelector("input")!;
    expect(a.getAttribute("type")).toBe("file");
    expect(a.className).toBe("sr-only");
    expect(a.getAttribute("accept")).toBe("image/*");
    expect(a.multiple).toBe(true);
    expect(a.tabIndex).toBe(-1);
    const b = render(<HiddenFileInput id="b" accept="image/*" peer />).container.querySelector("input")!;
    expect(b.className.split(" ").sort()).toEqual(["peer", "sr-only"]);
  });

  it("every Declutter picker uses it, with its own accept=; none keeps a hand-made file input", () => {
    expect(Object.keys(FILES).length).toBeGreaterThan(6);
    for (const [f, { n, peer }] of Object.entries(FILES)) {
      const s = readFileSync(f, "utf8");
      expect(s, f).not.toMatch(/type="file"/);
      const tags = s.split("<HiddenFileInput").slice(1).map((t) => t.slice(0, t.indexOf("/>")));
      expect(tags.length, f).toBe(n);
      for (const t of tags) expect(t, f).toMatch(/\baccept="image\/\*"/);
      expect(tags.some((t) => /\speer\s/.test(t)), f).toBe(Boolean(peer));
    }
    expect(readFileSync("src/components/declutter/DeclutterSellPhotos.tsx", "utf8")).toContain('<HiddenFileInput id="sell-files" accept="image/*" multiple ');
  });

  it("Profile (packet 3): the Edit profile photo and the profile gate's required photo use it, input named on the gate", () => {
    const edit = readFileSync("src/components/profile/profileEditForm/PhotoNameSection.tsx", "utf8");
    expect(edit).not.toMatch(/type="file"/);
    expect(edit).toContain('<HiddenFileInput accept="image/*" onChange={handlePick} disabled={avatarUploading} />');
    const gate = readFileSync("src/pages/auth/CompleteProfile.tsx", "utf8");
    expect(gate).not.toMatch(/type="file"/);
    const tag = gate.slice(gate.indexOf("<HiddenFileInput"), gate.indexOf("/>", gate.indexOf("<HiddenFileInput")));
    expect(tag).toContain('id="avatar"');
    expect(tag).toContain("aria-label={avatarPreview");
  });

  it("Jobs (packet 4): an applied job's 'Add cert or work sample' picker uses it, photos and PDFs", () => {
    const s = readFileSync("src/pages/jobs/appliedJobCard/PendingApplicationSection.tsx", "utf8");
    expect(s).not.toMatch(/type="file"/);
    const at = s.indexOf("<HiddenFileInput");
    expect(at).toBeGreaterThan(-1);
    expect(s.slice(at, s.indexOf("onChange", at))).toContain('accept="image/*,application/pdf"');
  });

  it("the rest (packet 5): dispute, guarantee, sign-up, quote and rentals pickers use it; no sr-only file input is left", () => {
    const REST: Record<string, string> = {
      "src/components/DisputeDialog.tsx": 'accept="image/*"',
      "src/components/DisputeTimelineDialog.tsx": 'accept="image/*"',
      "src/components/guarantee/HelprGuaranteePanel.tsx": "accept=",
      "src/pages/auth/signup/SignupStep2.tsx": "accept=",
      "src/pages/quotes/SendQuotePage.tsx": 'accept="image/*"',
      "src/components/rentals/LandlordIdReview.tsx": "accept=",
      "src/components/rentals/listings/editorParts.tsx": "accept=",
    };
    expect(Object.keys(REST).length).toBeGreaterThan(6);
    for (const [f, accept] of Object.entries(REST)) {
      const s = readFileSync(f, "utf8");
      expect(s, f).not.toMatch(/type="file"/);
      const at = s.indexOf("<HiddenFileInput");
      expect(at, f).toBeGreaterThan(-1);
      expect(s.slice(at, s.indexOf("/>", at)), f).toContain(accept);
    }
  });

  it("Post a job (packet 2): the photo and video pickers inside their dashed tiles use it too", () => {
    const POST: Record<string, string> = {
      "src/components/postjob/detailsSection/PhotoReorderGrid.tsx": 'accept="image/*"',
      "src/components/postjob/detailsSection/PhotoUpload.tsx": 'accept="image/*"',
      "src/components/postjob/detailsSection/VideoScope.tsx": 'accept="video/*"',
    };
    expect(Object.keys(POST).length).toBeGreaterThan(2);
    for (const [f, accept] of Object.entries(POST)) {
      const s = readFileSync(f, "utf8");
      expect(s, f).not.toMatch(/type="file"/);
      const tags = s.split("<HiddenFileInput").slice(1).map((t) => t.slice(0, t.indexOf("/>")));
      expect(tags.length, f).toBe(1);
      expect(tags[0], f).toContain(accept);
    }
  });
});
