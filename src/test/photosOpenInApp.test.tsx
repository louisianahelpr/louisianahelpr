/**
 * Owner 11-13 (iPhone app, reviewing Yusef's completed "Mow and Weed Eat" job): "When I clicked the picture it took me
 * out of the app. That shouldn't happen." The Helpr's photo was an `<a href={signedUrl} target="_blank">`, so iOS
 * opened the raw supabase.co signed URL in a Safari sheet with an address bar. A photo now opens the app's own viewer
 * (PhotoLightbox, via useInAppPhotoViewer), and a signed photo URL is never a link a user can carry out of the app.
 *
 * Two halves:
 *   1. SOURCE SCAN (whole of src/, tests excluded): no JSX link with a data-driven href wraps an image, and no
 *      window.open / openExternalUrl is handed a signed photo URL. The few file links that stay (documents a phone
 *      opens in its own viewer) are listed in LEFT_ALONE with the reason.
 *   2. BEHAVIOUR: on the poster's job-done review and the before/after gallery, tapping a photo opens the in-app viewer
 *      (a dialog with the photo, its alt text and a Close button), and no link to the signed URL exists.
 *
 * Owner 11-15 (web, admin user page): "I don't like how when I click a picture it takes me out of the website into
 * Supabase." The admin avatar, the Documents tab's avatar and portfolio photos, the credential preview, the support
 * screenshot, ID/permit photos and a member's own credential photos all opened the storage URL in a new tab. Two more
 * shapes are now caught: a link around an AVATAR, a link whose href is a photo's URL whatever it wraps, and any
 * document opener (openSignedDocument, window.open of a signed URL) that does not first send a photo
 * (isBrowserImagePath) to the in-app viewer. PDFs still open in a tab: the app has no document viewer.
 *
 * @mutate src/components/jobDone/JobDoneSummary.tsx |               onClick={() => openPhoto(i)} |               onClick={() => {}}
 * @mutate src/components/PhotoProofDialog.tsx | onClick={() => openPhoto(beforeUrls.length + i)}> | onClick={() => {}}>
 * @mutate src/components/admin/userDetail/DetailHeader.tsx | {avatarSrc ? ( | {avatarSrc ? (<a href={avatarSrc}><UserAvatar src={avatarSrc} /></a>) : avatarSrc ? (
 * @mutate src/components/admin/userDetail/DocumentsTab.tsx | onClick={() => openPortfolioPhoto(i)} | onClick={() => {}}
 * @mutate src/components/admin/userDetail/DocumentsTab.tsx | onClick={() => avatarViewer.show(avatarSrc, "Profile picture, original upload")} | onClick={() => {}}
 * @mutate src/components/admin/userDetail/DocumentsTab.tsx | if (isBrowserImagePath(path)) await showSigned(sign, fileName | if (false) await showSigned(sign, fileName
 * @mutate src/components/admin/AdminCredentialQueue.tsx | if (isBrowserImagePath(path)) { | if (false) {
 * @mutate src/components/admin/AdminCredentialQueue.tsx | onClick={() => show(signedUrl, "Credential document")} | onClick={() => window.open(signedUrl, "_blank")}
 * @mutate src/components/admin/AdminSupport.tsx | if (isBrowserImagePath(path)) await showSigned(sign, "Screenshot | if (false) await showSigned(sign, "Screenshot
 * @mutate src/components/admin/settings/RentalsOwnershipCard.tsx | if (isBrowserImagePath(path)) { void showSigned( | if (false) { void showSigned(
 * @mutate src/components/admin/ShopsPaperworkCard.tsx | if (isBrowserImagePath(path)) { | if (false) {
 * @mutate src/components/profile/CredentialsTab.tsx | if (isBrowserImagePath(path)) { | if (false) {
 * @mutate src/components/AttachmentLink.tsx | if (isBrowserImagePath(path)) { | if (false) {
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import ts from "typescript";
import { render, screen, fireEvent, within, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readdirSync } from "./helpers/trackedFiles";

const SRC = resolve(__dirname, "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "test") continue;
      walk(p, out);
    } else if (/\.tsx$/.test(name) && !/\.(test|spec)\.tsx$/.test(name)) out.push(p);
  }
  return out;
}

const IMAGE_TAG = /^(img|picture|[A-Za-z]*(Img|Image|Photo|Thumb|Avatar))$/;
const SIGNED_ARG = /signed|thumb|photo|avatar|screenshot|src\b|srcs\[|DocumentUrl|FileUrl/i;
/** An href that is a photo's own URL, whatever the link wraps (DocumentsTab's "Open original" was text). */
const PHOTO_HREF = /avatar|photo|image|thumb|screenshot|signed|storage|publicUrl/i;
/** An in-app route, not a file: a profile link around an avatar is fine. */
const IN_APP_HREF = /^([A-Za-z.]*Path\(|`\/|"\/)/;
/** Every opener this many files deep is checked; a parser that silently reads nothing stays red. */
let openersChecked = 0;

/** `file::what` for every photo that opens outside the app. */
function photoEscapes(source: string, fileName: string): string[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: string[] = [];
  const text = (n: ts.Node) => n.getText(sf).replace(/\s+/g, " ").trim();
  const tagName = (n: ts.JsxOpeningLikeElement) => n.tagName.getText(sf);
  const hasImage = (n: ts.Node): boolean => {
    let found = false;
    const v = (c: ts.Node) => {
      if (found) return;
      if ((ts.isJsxOpeningElement(c) || ts.isJsxSelfClosingElement(c)) && IMAGE_TAG.test(tagName(c))) { found = true; return; }
      ts.forEachChild(c, v);
    };
    ts.forEachChild(n, v);
    return found;
  };
  /** True when `fn` itself sends a photo to the in-app viewer first: it calls isBrowserImagePath(…). */
  const routesPhotos = (fn: ts.Node): boolean => {
    let found = false;
    const v = (c: ts.Node) => {
      if (found) return;
      if (ts.isCallExpression(c) && c.expression.getText(sf) === "isBrowserImagePath") { found = true; return; }
      ts.forEachChild(c, v);
    };
    v(fn);
    return found;
  };
  const enclosingFn = (n: ts.Node): ts.Node | undefined => {
    let p: ts.Node | undefined = n.parent;
    while (p && !ts.isArrowFunction(p) && !ts.isFunctionExpression(p) && !ts.isFunctionDeclaration(p) && !ts.isMethodDeclaration(p)) p = p.parent;
    return p;
  };
  const fnName = (fn: ts.Node | undefined): string => {
    if (!fn) return "top level";
    if (ts.isFunctionDeclaration(fn) && fn.name) return fn.name.getText(sf);
    if (fn.parent && ts.isVariableDeclaration(fn.parent)) return fn.parent.name.getText(sf);
    if (fn.parent && ts.isJsxExpression(fn.parent) && ts.isJsxAttribute(fn.parent.parent)) return `${fn.parent.parent.name.getText(sf)} handler`;
    return "an inline function";
  };
  const visit = (node: ts.Node) => {
    // <a href={data}> … <img/ProofPhotoImg/FallbackImg/OptimizedImage/UserAvatar …> … </a>, or <a href={photo URL}>text</a>
    if (ts.isJsxElement(node) && tagName(node.openingElement) === "a") {
      const href = node.openingElement.attributes.properties.find((p) => ts.isJsxAttribute(p) && p.name.getText(sf) === "href") as ts.JsxAttribute | undefined;
      const init = href?.initializer;
      if (init && ts.isJsxExpression(init) && init.expression && !ts.isStringLiteral(init.expression)) {
        const h = text(init.expression);
        if (!IN_APP_HREF.test(h)) {
          if (hasImage(node)) out.push(`${fileName}::<a href={${h}}> around a photo`);
          else if (PHOTO_HREF.test(h)) out.push(`${fileName}::<a href={${h}}> to a photo's URL`);
        }
      }
    }
    if (ts.isCallExpression(node)) {
      const callee = text(node.expression).replace(/\?\./g, ".");
      const arg = node.arguments[0];
      // openSignedDocument(…) / window.open(signed…) / openExternalUrl(photo…): a photo must be routed to the viewer first.
      const opensFile = callee === "openSignedDocument"
        || ((/(^|\.)window\.open$/.test(callee) || callee === "openExternalUrl") && !!arg && SIGNED_ARG.test(text(arg)));
      if (opensFile) {
        openersChecked++;
        const fn = enclosingFn(node);
        if (!fn || !routesPhotos(fn)) {
          out.push(callee === "openSignedDocument"
            ? `${fileName}::openSignedDocument in ${fnName(fn)} with no photo route`
            : `${fileName}::${callee}(${text(arg)}) with no photo route`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** Left alone on purpose, with why. A stale entry fails, so this list can't rot into a blanket pass. */
const LEFT_ALONE: Record<string, string> = {
  // Empty since 11-15: every photo opens in the in-app viewer. A PDF opener passes on its own (it routes photos
  // first); add an entry here only with the reason, and the owner's word if it is a photo.
};

function scan() {
  const all: string[] = [];
  for (const f of walk(SRC)) all.push(...photoEscapes(readFileSync(f, "utf8"), f.slice(SRC.length + 1)));
  return all;
}

describe("source scan: no photo opens outside the app", () => {
  const found = scan();

  it("no link or window.open hands a photo's URL to Safari", () => {
    expect(found.filter((k) => !(k in LEFT_ALONE))).toEqual([]);
  });

  it("every LEFT_ALONE entry still exists", () => {
    expect(Object.keys(LEFT_ALONE).filter((k) => !found.includes(k))).toEqual([]);
  });

  it("read the file openers it exists for (inventory floor)", () => {
    // 11-15: AttachmentLink, CredentialsTab, DocumentsTab, AdminCredentialQueue, AdminSupport, RentalsOwnershipCard,
    // ShopsPaperworkCard (+ MessageAttachment's PDF opener is not signed-named). A walker that reads nothing fails here.
    expect(openersChecked).toBeGreaterThan(6);
  });

  it("is RED on the shapes that shipped", () => {
    const shipped = [
      // PhotoProofDialog before 11-13 (the owner's tap)
      `<a key={url ?? i} href={afterSrcs[i] ?? undefined} target="_blank" rel="noopener noreferrer"><ProofPhotoImg insideControl src={afterSrcs[i]} alt="" /></a>`,
      // DeclutterProblemSides
      `<a key={k} href={u} target="_blank" rel="noreferrer"><FallbackImg src={u} alt="" /></a>`,
      // JobCardPhotoStrip
      `<a href={openableDocumentUrl(url) ?? undefined} target="_blank"><OptimizedImage src={url} /></a>`,
      // AttachmentLink thumb
      `const f = () => window.open(signed, "_blank", "noopener,noreferrer");`,
      // Admin DetailHeader before 11-15 (the owner's click)
      `<a href={openableDocumentUrl(viewProfile.avatar_url) ?? undefined} target="_blank"><UserAvatar src={viewProfile.avatar_url} /></a>`,
      // Admin DocumentsTab "Open original" before 11-15: a text link to the avatar file
      `<a href={openableDocumentUrl(viewProfile.avatar_url) ?? undefined} target="_blank">Open original</a>`,
      // AdminSupport screenshot before 11-15
      `const open = async () => { await openSignedDocument({ open: (url, target) => window.open(url, target), sign, toastError }); };`,
      // ShopsPaperworkCard before 11-15
      `const view = async (path) => { window.open(await permitDocumentUrl(path), "_blank", "noopener,noreferrer"); };`,
    ];
    for (const s of shipped) expect(photoEscapes(`const X = () => (${s.startsWith("const") ? "null" : s}); ${s.startsWith("const") ? s : ""}`, "x.tsx"), s).toHaveLength(1);
  });
});

// ── Behaviour ──────────────────────────────────────────────────────────────────────────────────────────────────────
const SIGNED = (p: string) => `https://fncmgoasalhdgfwzhsqa.supabase.co/storage/v1/object/sign/job-photos/${p}?token=abc`;
vi.mock("@/hooks/useProofPhotoUrls", () => ({
  useProofPhotoUrls: (v: string[]) => v.map((p) => (p ? SIGNED(p) : null)),
  PENDING_PHOTO_SRC: "data:,",
}));
const JOB = {
  title: "Mow and Weed Eat", helper_id: "h", budget: 40, status: "completed", payment_status: "released", is_group_job: false,
  helpers_needed: 1, urgent_fee: null, helper_fee_flat_cents: 70, helper_fee_percent: 5, platform_fee_amount: null, disputed_at: null,
  dispute_status: null, payout_scheduled_at: null, proof_before_urls: ["j/before.jpg"], proof_after_urls: ["j/after.jpg"],
};
vi.mock("@/integrations/supabase/client", () => {
  const chain = (rows: unknown) => {
    const c: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "order", "limit"]) c[m] = () => c;
    c.maybeSingle = async () => ({ data: rows, error: null });
    c.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok);
    return c;
  };
  return { supabase: { from: (t: string) => chain(t === "jobs" ? JOB : []), rpc: async () => ({ data: null, error: null }) } };
});
vi.mock("@/lib/payoutSetupQueries", () => ({ fetchPayoutStatus: async () => ({ payouts_enabled: true, connected: true }), payoutStatusQueryOptions: {} }));
vi.mock("@/hooks/usePayoutSetupPaused", () => ({ usePayoutSetupPaused: () => false }));
vi.mock("@/hooks/useAgeGate", () => ({ useAgeGate: () => ({ underAge: false, explain: vi.fn(), gatedProps: () => ({}) }) }));

import { JobDoneSummary } from "@/components/jobDone/JobDoneSummary";
import { PhotoProofDialog } from "@/components/PhotoProofDialog";

const noSignedLink = () => {
  for (const a of Array.from(document.querySelectorAll("a"))) expect(a.getAttribute("href") ?? "").not.toMatch(/supabase\.co|\/storage\//);
};

describe("tapping a job photo opens the in-app viewer", () => {
  it("the poster's job-done review", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><MemoryRouter><JobDoneSummary jobId="j" side="poster" otherName="Yusef A." viewerId="p" /></MemoryRouter></QueryClientProvider>);
    const after = await screen.findByRole("button", { name: "Open the after photo" });
    noSignedLink();
    fireEvent.click(after);
    const viewer = screen.getByRole("dialog", { name: "Photo viewer" });
    const img = within(viewer).getByAltText("After photo of Mow and Weed Eat") as HTMLImageElement;
    expect(img.src).toBe(SIGNED("j/after.jpg"));
    expect(within(viewer).getByText("2 / 2")).toBeTruthy();
    fireEvent.click(within(viewer).getByRole("button", { name: "Close photo viewer" }));
    expect(screen.queryByRole("dialog", { name: "Photo viewer" })).toBeNull();
    cleanup();
  });

  it("the before/after gallery (JobProofPhotos -> PhotoProofDialog)", () => {
    render(<PhotoProofDialog open onOpenChange={() => {}} beforeUrls={["b.jpg"]} afterUrls={["a1.jpg", "a2.jpg"]} />);
    noSignedLink();
    fireEvent.click(screen.getByRole("button", { name: "Open after photo 2" }));
    const viewer = screen.getByRole("dialog", { name: "Photo viewer" });
    expect((within(viewer).getByAltText("After photo 2") as HTMLImageElement).src).toBe(SIGNED("a2.jpg"));
    expect(within(viewer).getByText("3 / 3")).toBeTruthy();
    expect(within(viewer).getByRole("button", { name: "Close photo viewer" })).toBeTruthy();
    cleanup();
  });
});

// ── Behaviour, admin user page (owner 11-15) ───────────────────────────────────────────────────────────────────────
import { DetailHeader } from "@/components/admin/userDetail/DetailHeader";
import { DocumentsTab } from "@/components/admin/userDetail/DocumentsTab";
import { Tabs } from "@/components/ui/tabs";
import type { Profile } from "@/components/admin/adminUserHelpers";

const AVATAR = "https://fncmgoasalhdgfwzhsqa.supabase.co/storage/v1/object/public/avatars/u/face.jpg";
const PORTFOLIO = "https://fncmgoasalhdgfwzhsqa.supabase.co/storage/v1/object/public/portfolio/u/deck.png";
const PDF = "https://example.com/resume.pdf";
const PROFILE = {
  user_id: "u", full_name: "Yusef Abdi", email: "y@example.com", avatar_url: AVATAR,
  portfolio_urls: [PORTFOLIO, PDF], application_count: 1,
} as unknown as Profile;

describe("tapping an admin-side member photo opens the in-app viewer (owner 11-15)", () => {
  it("the user page header avatar", () => {
    render(<DetailHeader viewProfile={PROFILE} setEditEmailProfile={() => {}} />);
    noSignedLink();
    fireEvent.click(screen.getByRole("button", { name: "Open Yusef Abdi's profile photo" }));
    const viewer = screen.getByRole("dialog", { name: "Photo viewer" });
    expect((within(viewer).getByAltText("Yusef Abdi's profile photo") as HTMLImageElement).src).toBe(AVATAR);
    cleanup();
  });

  it("the Documents tab: avatar original and a portfolio photo; a PDF stays a document link", () => {
    render(<Tabs value="documents"><DocumentsTab viewProfile={PROFILE} /></Tabs>);
    noSignedLink();
    fireEvent.click(screen.getByRole("button", { name: "Open original" }));
    let viewer = screen.getByRole("dialog", { name: "Photo viewer" });
    expect((within(viewer).getByAltText("Profile picture, original upload") as HTMLImageElement).src).toBe(AVATAR);
    fireEvent.click(within(viewer).getByRole("button", { name: "Close photo viewer" }));
    fireEvent.click(screen.getByRole("button", { name: "Open portfolio item 1" }));
    viewer = screen.getByRole("dialog", { name: "Photo viewer" });
    expect((within(viewer).getByAltText("Portfolio item 1") as HTMLImageElement).src).toBe(PORTFOLIO);
    expect(Array.from(document.querySelectorAll("a")).some((a) => a.getAttribute("href") === PDF)).toBe(true);
    cleanup();
  });
});
