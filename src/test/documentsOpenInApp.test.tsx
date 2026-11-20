/**
 * Owner 2026-11-15: "add the PDF viewer too." Photos already opened in the app's own viewer (photosOpenInApp.test.tsx),
 * but tapping a PDF or another document (admin Documents tab, the credential queue, a member's own credentials, the
 * rentals ownership files, Shops permits, application and message attachments) still opened the raw Supabase URL in a
 * new tab. A document now opens in DocumentViewer (src/components/documents/DocumentViewer.tsx, through
 * useDocumentViewer): PDF pages drawn in the app, a picture or HEIC shown or a Download card, a Word file as a card
 * with Download. Leaving the app is only ever the viewer's own secondary action (Download, Open in new tab).
 *
 * Two halves:
 *   1. SOURCE SCAN (whole of src/, tests excluded), in every file that handles a stored file (it names a signer or a
 *      storage-URL helper): no openSignedDocument, no window.open / openExternalUrl / Browser.open of a data-driven
 *      URL, and no <a href> to a document's URL. Purchased Shops downloads stay downloads (LEFT_ALONE, with why).
 *   2. BEHAVIOUR: on the admin Documents tab a PDF opens the in-app viewer with Close, Download and Open in new tab,
 *      and no link to the file exists; a Word file shows the Download card; a HEIC the browser cannot draw falls back
 *      to the card inside the viewer.
 *
 * @mutate src/components/admin/userDetail/DocumentsTab.tsx | else await docs.showSigned(sign, fileName | else await openSignedDocument({ open: (url, target) => window.open(url, target), sign, toastError: (msg) => toast.error(msg) }); void (sign, fileName
 * @mutate src/components/admin/userDetail/DocumentsTab.tsx | onClick={() => onOpen(docUrl, fileName)} | onClick={() => window.open(docUrl, "_blank")}
 * @mutate src/components/admin/AdminCredentialQueue.tsx | await docs.showSigned(sign, documentName(path) | await openSignedDocument({ open: (url, target) => window.open(url, target), sign, toastError: (msg) => toast.error(msg) }); void (sign, documentName(path)
 * @mutate src/components/admin/AdminCredentialQueue.tsx | if (safe) docs.show(safe, "Credential document"); | if (safe) window.open(safe, "_blank", "noopener");
 * @mutate src/components/profile/CredentialsTab.tsx | docs.show(signed.signedUrl, label); | window.open(signed.signedUrl, "_blank", "noopener");
 * @mutate src/components/profile/CredentialsTab.tsx | if (safe) docs.show(safe, label); | if (safe) window.open(safe, "_blank", "noopener");
 * @mutate src/components/admin/settings/RentalsOwnershipCard.tsx | void docs.showSigned(sign, name | void openSignedDocument({ open: (url, target) => window.open(url, target), sign, toastError: (msg) => toast.error(msg) }); void (sign, name
 * @mutate src/components/admin/ShopsPaperworkCard.tsx | docs.show(await permitDocumentUrl(path), "Permit document"); | window.open(await permitDocumentUrl(path), "_blank", "noopener,noreferrer");
 * @mutate src/components/admin/AdminSupport.tsx | else await docs.showSigned(sign, "Screenshot the member attached" | else await openSignedDocument({ open: (url, target) => window.open(url, target), sign, toastError: (msg) => toast.error(msg) }); void (sign, "Screenshot the member attached"
 * @mutate src/components/AttachmentLink.tsx | await docs.showSigned(() => getAttachmentSignedUrl(url), filename | window.open(await getAttachmentSignedUrl(url) ?? "", "_blank"); void (() => getAttachmentSignedUrl(url), filename
 * @mutate src/components/MessageAttachment.tsx | docs.show(url, filename); | window.open(url, "_blank", "noopener,noreferrer");
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import ts from "typescript";
import { render, screen, fireEvent, within, cleanup } from "@testing-library/react";
import { readdirSync } from "./helpers/trackedFiles";

const SRC = resolve(__dirname, "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "test") continue;
      walk(p, out);
    } else if (/\.tsx?$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name) && !/\.d\.ts$/.test(name)) out.push(p);
  }
  return out;
}

/** A file that handles a stored file: it signs one, or turns a stored value into a URL. */
const DOC_SOURCES = new Set([
  "createSignedUrl", "createSignedUrls", "openSignedDocument", "openableDocumentUrl", "safeDocumentUrl",
  "permitDocumentUrl", "getAttachmentSignedUrl", "getMessageAttachmentSignedUrl", "getMessageAttachmentSignedUrls",
  "signedFileUrl", "digitalDownloadUrl",
]);
/** An href that is a stored file's URL. */
const DOC_HREF = /DocumentUrl|signed|attachment|permit|\bdocUrl|fileUrl/i;
/** A constant (SOS_SEARCH_URL) or an in-app route is not a stored file. */
const NOT_A_FILE = /^([A-Z][A-Z0-9_]*$|[A-Za-z.]*Path\(|`\/|"\/|`https:\/\/)/;
let docFilesRead = 0;

/** `file::what` for every document that opens outside the app. */
function documentEscapes(source: string, fileName: string): string[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const text = (n: ts.Node) => n.getText(sf).replace(/\s+/g, " ").trim();
  let isDocFile = false;
  const ids = (n: ts.Node) => {
    if (isDocFile) return;
    if (ts.isIdentifier(n) && DOC_SOURCES.has(n.text)) { isDocFile = true; return; }
    ts.forEachChild(n, ids);
  };
  ids(sf);
  if (!isDocFile) return [];
  docFilesRead++;
  const out: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const callee = text(node.expression).replace(/\?\./g, ".");
      const arg = node.arguments[0];
      if (callee === "openSignedDocument") out.push(`${fileName}::openSignedDocument(…)`);
      else if (/(^|\.)window\.open$|^openExternalUrl$/.test(callee) && arg && !ts.isStringLiteral(arg) && !NOT_A_FILE.test(text(arg))) {
        out.push(`${fileName}::${callee}(${text(arg)})`);
      } else if (/(^|\.)Browser\.open$/.test(callee) && arg && ts.isObjectLiteralExpression(arg)) {
        const u = arg.properties.find((p) => p.name?.getText(sf) === "url");
        const v = u && ts.isPropertyAssignment(u) ? u.initializer : u && ts.isShorthandPropertyAssignment(u) ? u.name : undefined;
        if (v && !ts.isStringLiteral(v) && !NOT_A_FILE.test(text(v))) out.push(`${fileName}::Browser.open(${text(v)})`);
      }
    }
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(sf) === "a") {
      const href = node.attributes.properties.find((p) => ts.isJsxAttribute(p) && p.name.getText(sf) === "href") as ts.JsxAttribute | undefined;
      const init = href?.initializer;
      if (init && ts.isJsxExpression(init) && init.expression && !ts.isStringLiteral(init.expression)) {
        const h = text(init.expression);
        if (!NOT_A_FILE.test(h) && DOC_HREF.test(h)) out.push(`${fileName}::<a href={${h}}>`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** Left alone on purpose, with why. A stale entry fails, so this list can't rot into a blanket pass. */
const LEFT_ALONE: Record<string, string> = {
  // Owner 2026-11-15 (the request itself): "Shops digital downloads are purchased files. Leave them as downloads."
  "components/shops/ShopDigitalOrder.tsx::window.open(url)": "a purchased digital file the buyer downloads (digitalDownloadUrl)",
  "components/shops/ShopDigitalFiles.tsx::window.open(url)": "the seller's own digital file for sale, downloaded (digitalDownloadUrl)",
  // Not a stored file: row.external_url is the published social post's own address (Facebook/Instagram), which the
  // admin views on that site. openableDocumentUrl is only its https sanitizer here.
  // Not a stored file: a Small Business Saturday listing's own website/Facebook/Instagram, which the admin checks there.
  "pages/admin/sponsors/SbsReviewPanel.tsx::<a href={safeDocumentUrl(r.link) ?? undefined}>": "a business's own public page (the listing request's link), not a stored file",
  "components/admin/marketing/MarketingQueue.tsx::<a href={openableDocumentUrl(row.external_url) ?? undefined}>": "the published post on the social site, not a stored file",
};

function scan() {
  const all: string[] = [];
  for (const f of walk(SRC)) all.push(...documentEscapes(readFileSync(f, "utf8"), f.slice(SRC.length + 1)));
  return all;
}

describe("source scan: no document opens outside the app", () => {
  const found = scan();

  it("no openSignedDocument, window.open, Browser.open or link hands a stored file's URL to the browser", () => {
    expect(found.filter((k) => !(k in LEFT_ALONE))).toEqual([]);
  });

  it("every LEFT_ALONE entry still exists", () => {
    expect(Object.keys(LEFT_ALONE).filter((k) => !found.includes(k))).toEqual([]);
  });

  it("read the files that handle stored files (inventory floor)", () => {
    // 2026-11-15: 27 files name a signer or a storage-URL helper. A walker that reads nothing fails here.
    expect(docFilesRead).toBeGreaterThan(25);
  });

  it("is RED on the shapes that shipped", () => {
    const shipped = [
      // DocumentsTab SignedPortfolioTile, AdminCredentialQueue, AdminSupport, RentalsOwnershipCard before 11-15
      `const o = async () => { await openSignedDocument({ open: (url, target) => window.open(url, target), sign, toastError }); };`,
      // CredentialsTab / AdminCredentialQueue data: and https documents
      `const o = () => { const safe = openableDocumentUrl(x); if (safe) window.open(safe, "_blank", "noopener"); };`,
      // CredentialsTab signed document
      `const o = async () => { const { data: signed } = await s.createSignedUrl(p, 60); window.open(signed.signedUrl, "_blank"); };`,
      // ShopsPaperworkCard permit
      `const o = async (path) => { window.open(await permitDocumentUrl(path), "_blank", "noopener,noreferrer"); };`,
      // DocumentsTab portfolio PDF link
      `const X = () => <a href={openableDocumentUrl(url) ?? undefined} target="_blank">CV</a>;`,
      // a native shape
      `const o = async () => { const url = await getAttachmentSignedUrl(p); await Browser.open({ url }); };`,
    ];
    for (const s of shipped) expect(documentEscapes(s, "x.tsx").length, s).toBeGreaterThan(0);
  });
});

// ── Behaviour ──────────────────────────────────────────────────────────────────────────────────────────────────────
vi.mock("@/components/documents/PdfPages", () => ({
  default: ({ url, name }: { url: string; name: string }) => <div data-testid="pdf-pages" data-url={url}>{name} pages</div>,
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { DocumentsTab } from "@/components/admin/userDetail/DocumentsTab";
import { DocumentViewer } from "@/components/documents/DocumentViewer";
import { Tabs } from "@/components/ui/tabs";
import type { Profile } from "@/components/admin/adminUserHelpers";
import { documentKind, downloadUrl } from "@/lib/documentKind";

const PDF = "https://fncmgoasalhdgfwzhsqa.supabase.co/storage/v1/object/public/portfolio/u/resume.pdf";
const DOCX = "https://fncmgoasalhdgfwzhsqa.supabase.co/storage/v1/object/public/portfolio/u/cover%20letter.docx";
const PROFILE = { user_id: "u", full_name: "Yusef Abdi", email: "y@example.com", avatar_url: null, portfolio_urls: [PDF, DOCX] } as unknown as Profile;

describe("tapping a document opens the in-app document viewer (owner 11-15)", () => {
  it("the admin Documents tab: a PDF draws in the viewer, with Close, Download and Open in new tab", async () => {
    render(<Tabs value="documents"><DocumentsTab viewProfile={PROFILE} /></Tabs>);
    for (const a of Array.from(document.querySelectorAll("a"))) expect(a.getAttribute("href") ?? "").not.toMatch(/supabase\.co|\/storage\//);
    fireEvent.click(screen.getByRole("button", { name: "Open resume.pdf" }));
    const viewer = screen.getByRole("dialog", { name: "Document viewer" });
    expect((await within(viewer).findByTestId("pdf-pages")).getAttribute("data-url")).toBe(PDF);
    expect(within(viewer).getByRole("button", { name: /^Download$/ })).toBeTruthy();
    expect(within(viewer).getByRole("button", { name: "Open in new tab" })).toBeTruthy();
    fireEvent.click(within(viewer).getByRole("button", { name: "Close document viewer" }));
    expect(screen.queryByRole("dialog", { name: "Document viewer" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Open cover letter.docx" }));
    const card = screen.getByRole("dialog", { name: "Document viewer" });
    expect(within(card).getByText(/can't be shown in the app/)).toBeTruthy();
    expect(within(card).getByRole("button", { name: "Download cover letter.docx" })).toBeTruthy();
    cleanup();
  });

  it("a HEIC the browser cannot draw falls back to the Download card inside the viewer", () => {
    render(<DocumentViewer doc={{ url: "https://x.supabase.co/storage/v1/object/sign/id/IMG_1.HEIC?token=t" }} onClose={() => {}} />);
    const viewer = screen.getByRole("dialog", { name: "Document viewer" });
    fireEvent.error(within(viewer).getByAltText("IMG_1.HEIC"));
    expect(within(viewer).getByText(/can't be shown in this browser/)).toBeTruthy();
    expect(within(viewer).getByRole("button", { name: "Download IMG_1.HEIC" })).toBeTruthy();
    cleanup();
  });

  it("documentKind and downloadUrl", () => {
    expect(documentKind("u/a.PDF")).toBe("pdf");
    expect(documentKind("https://x/sign/a?token=1", "Lease.pdf")).toBe("pdf");
    expect(documentKind("a.heic")).toBe("heic");
    expect(documentKind("a.docx")).toBe("word");
    expect(documentKind("a.jpg")).toBe("image");
    expect(documentKind("a.zip")).toBe("other");
    expect(downloadUrl("https://x.supabase.co/storage/v1/object/sign/b/a.pdf?token=t", "a.pdf")).toBe("https://x.supabase.co/storage/v1/object/sign/b/a.pdf?token=t&download=a.pdf");
    expect(downloadUrl("https://example.com/a.pdf", "a.pdf")).toBe("https://example.com/a.pdf");
  });
});
