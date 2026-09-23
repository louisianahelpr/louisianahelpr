import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { HelperWorkPhotos } from "@/components/profile/HelperWorkPhotos";

/**
 * Guards the surface that makes profile work photos worth uploading.
 *
 * `profiles.portfolio_urls` had an uploader (Edit Profile → Recent work) and
 * was even SELECTed by useUserProfileData, but NOTHING rendered it — so the
 * photos were admin-visible only and every helper re-attached the same files
 * on every application instead. If this section stops rendering, the apply
 * step's removed file picker leaves helpers with no way to show their work.
 *
 * 2026-09-21, vacuity burn-down: the two render tests below were the whole
 * guard, and both render the component DIRECTLY. Deleting the one line in
 * `UserProfile.tsx` that MOUNTS it — the exact regression the paragraph above
 * describes, and the state the feature shipped in for months — left this file
 * GREEN, 2/2. That is class (b), mount-wiring, the same shape as
 * `posterConfirmationBadge`. The mount is now asserted, over the PARSED
 * module rather than its text, so neither a comment naming the component nor
 * a bare `import` of it can satisfy it: only a real JSX element can.
 */
const USER_PROFILE = "src/pages/UserProfile.tsx";

/** Component names `rel` actually RENDERS as JSX (imports and comments excluded). */
function renderedComponents(rel: string): Set<string> {
  const abs = path.resolve(__dirname, "../..", rel);
  const sf = ts.createSourceFile(
    abs,
    readFileSync(abs, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const out = new Set<string>();
  const visit = (node: ts.Node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(sf).split(".")[0];
      if (/^[A-Z]/.test(tag)) out.add(tag);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

describe("HelperWorkPhotos is mounted", () => {
  it("UserProfile renders it — the section a poster actually sees", () => {
    const rendered = renderedComponents(USER_PROFILE);
    // Floor: an empty/failed parse must not pass by describing nothing.
    expect(rendered.size).toBeGreaterThan(20);
    expect(
      rendered.has("HelperWorkPhotos"),
      `${USER_PROFILE} no longer renders <HelperWorkPhotos>: uploaded work photos ` +
        `become admin-visible only again, and the apply step has no file picker.`,
    ).toBe(true);
  });
});

describe("HelperWorkPhotos", () => {
  it("renders each uploaded photo for posters to see", () => {
    render(
      <HelperWorkPhotos
        urls={["https://example.test/a.jpg", "https://example.test/b.jpg"]}
      />,
    );
    const imgs = screen.getAllByRole("img");
    expect(imgs).toHaveLength(2);
    expect(imgs[0]).toHaveAttribute("src", "https://example.test/a.jpg");
    expect(screen.getByText(/recent work/i)).toBeTruthy();
  });

  it("renders nothing when the helper has uploaded no photos", () => {
    const { container } = render(<HelperWorkPhotos urls={[]} />);
    expect(container.firstChild).toBeNull();
  });
});

// Shown able to fail 2026-09-21.
// 1. The MOUNT — the regression this guard was written for and could not see
//    before today (deleting this line left it 2/2 green).
// @mutate src/pages/UserProfile.tsx | <HelperWorkPhotos urls={profile.portfolio_urls ?? []} /> |
// 2. The component's own empty contract: an empty portfolio must render
//    NOTHING, not a bare "Recent Work" heading over an empty grid.
// @mutate src/components/profile/HelperWorkPhotos.tsx | if (!urls \|\| urls.length === 0) return null; | if (!urls) return null;

// complete-signup once wrote bare PRIVATE storage paths into portfolio_urls;
// on the public profile those were broken images. Only displayable URLs render.
describe("HelperWorkPhotos renders only displayable URLs", () => {
  it("drops bare storage paths and unsafe schemes, keeps https", () => {
    render(
      <HelperWorkPhotos
        urls={["abc-uid/123-x.jpg", "javascript:alert(1)", "https://cdn.example/ok.jpg"]}
      />,
    );
    const imgs = screen.getAllByRole("img");
    expect(imgs).toHaveLength(1);
    expect(imgs[0].getAttribute("src")).toBe("https://cdn.example/ok.jpg");
  });

  it("renders nothing when no URL is displayable", () => {
    const { container } = render(<HelperWorkPhotos urls={["abc-uid/123-x.jpg"]} />);
    expect(container.textContent).toBe("");
  });
});
