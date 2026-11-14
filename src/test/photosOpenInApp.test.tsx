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
 * @mutate src/components/jobDone/JobDoneSummary.tsx |               onClick={() => openPhoto(i)} |               onClick={() => {}}
 * @mutate src/components/PhotoProofDialog.tsx | onClick={() => openPhoto(i)}> | onClick={() => {}}>
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

const IMAGE_TAG = /^(img|picture|[A-Za-z]*(Img|Image|Photo|Thumb))$/;
const SIGNED_ARG = /signed|thumb|photo|src\b|srcs\[/i;

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
  const visit = (node: ts.Node) => {
    // <a href={data}> … <img/ProofPhotoImg/FallbackImg/OptimizedImage …> … </a>
    if (ts.isJsxElement(node) && tagName(node.openingElement) === "a") {
      const href = node.openingElement.attributes.properties.find((p) => ts.isJsxAttribute(p) && p.name.getText(sf) === "href") as ts.JsxAttribute | undefined;
      const init = href?.initializer;
      if (init && ts.isJsxExpression(init) && init.expression && !ts.isStringLiteral(init.expression) && hasImage(node)) {
        out.push(`${fileName}::<a href={${text(init.expression)}}> around a photo`);
      }
    }
    // window.open(signed…) / openExternalUrl(photo…)
    if (ts.isCallExpression(node)) {
      const callee = text(node.expression).replace(/\?\./g, ".");
      const arg = node.arguments[0];
      if ((/(^|\.)window\.open$/.test(callee) || callee === "openExternalUrl") && arg && SIGNED_ARG.test(text(arg))) {
        out.push(`${fileName}::${callee}(${text(arg)})`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** Left alone on purpose, with why. A stale entry fails, so this list can't rot into a blanket pass. */
const LEFT_ALONE: Record<string, string> = {
  "components/AttachmentLink.tsx::window.open(signed)":
    "the FILE chip only (PDF, doc): an application attachment that is not an image. The app has no document viewer; the image thumb opens the in-app viewer",
  "components/profile/CredentialsTab.tsx::window.open(signed.signedUrl)":
    "the member's own licence/insurance document (often a PDF), opened in the phone's document viewer; not a photo",
  "components/admin/userDetail/DocumentsTab.tsx::<a href={openableDocumentUrl(url) ?? undefined}> around a photo":
    "admin-only web console (never in the iPhone app): ID/credential documents, some PDFs, opened full-size for review",
  "components/admin/AdminCredentialQueue.tsx::<a href={signedUrl}> around a photo":
    "admin-only web console: credential documents (PDF or image) opened full-size for review",
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
