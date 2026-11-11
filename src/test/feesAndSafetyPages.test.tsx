/**
 * F255 (audit 11-10, owner 2026-11-11 morning pop-up): there was no Fees or Safety page (both 404), so a first-timer
 * could not find what Louisiana Helpr charges or how members are kept safe. Now /fees says, in words only (owner rule
 * #20: no rate, no number), "Posting a job is free. A small one-time setup fee applies to your first paid job. Any
 * service fee is shown before you pay. Helprs see their pay before they apply." (wording made exact by the owner
 * 2026-11-11 afternoon, OWNER-DECISIONS.md) and /safety says members are ID checked (only while the identity_check switch is on),
 * money is held until you approve the work, and a problem can be reported from any job. Both are lazy routes, served
 * by vercel.json (else the catch-all serves Not found) and linked from the footer.
 *
 * Red first (2026-11-11) against origin/main 7a86319c6e: no route, no page, no footer link.
 *
 * @mutate src/App.tsx |       <Route path="/fees" element= |       <Route path="/fees-old" element=
 * @mutate src/components/Footer.tsx |               <Link to="/safety" className={FOOTER_LINK}> |               <Link to="/help" className={FOOTER_LINK}>
 * @mutate src/lib/i18n/enPublic.ts |   "fees.helprsSeePay": "Helprs see their pay before they apply.", |   "fees.helprsSeePay": "Helprs see their pay (10% + 70¢ off) before they apply.",
 * @mutate src/pages/info/Safety.tsx |         {idCheckOn && <li>{t("safety.idChecked")} | {true && <li>{t("safety.idChecked")}
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const idOn = vi.hoisted(() => ({ value: true }));
vi.mock("@/lib/useIdCheckOnForViewer", () => ({ useIdCheckOnForViewer: () => idOn.value }));
vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ title, children }: { title: string; children: React.ReactNode }) => <main><h1>{title}</h1>{children}</main>,
}));

import Fees from "@/pages/info/Fees";
import Safety from "@/pages/info/Safety";

const ROOT = resolve(__dirname, "../..");
const read = (f: string) => blankComments(readFileSync(resolve(ROOT, f), "utf8"));

describe("F255: /fees and /safety (owner 2026-11-11)", () => {
  it("/fees: the owner's exact sentences, words only (no number, no rate)", () => {
    const { container } = render(<MemoryRouter><Fees /></MemoryRouter>);
    const body = container.querySelector("[data-fees-body]")!.textContent!;
    expect(body).toBe("Posting a job is free.A small one-time setup fee applies to your first paid job.Any service fee is shown before you pay.Helprs see their pay before they apply.");
    expect(body).not.toMatch(/\d|%|¢|\$/);
  });

  it("/safety: ID check (switch on), money held until you approve, report from any job", () => {
    idOn.value = true;
    const { container, unmount } = render(<MemoryRouter><Safety /></MemoryRouter>);
    const items = [...container.querySelectorAll("[data-safety-body] li")].map((li) => li.textContent);
    expect(items.length).toBeGreaterThan(2);
    expect(items[0]).toMatch(/^Every member is ID checked/);
    expect(items).toContain("Your money is held safely until you approve the work.");
    expect(items).toContain("You can report a problem from any job.");
    unmount();
    // With the identity_check switch off, the page never promises an ID check.
    idOn.value = false;
    render(<MemoryRouter><Safety /></MemoryRouter>);
    expect(screen.queryByText(/ID checked/)).toBeNull();
    expect(screen.getByText("You can report a problem from any job.")).toBeTruthy();
    idOn.value = true;
  });

  it("both are lazy routes, served by vercel.json, and linked from the footer", () => {
    const app = read("src/App.tsx");
    const vercel = JSON.parse(readFileSync(resolve(ROOT, "vercel.json"), "utf8")) as { rewrites: { source: string; destination: string }[] };
    const footer = read("src/components/Footer.tsx");
    for (const [path, name] of [["/fees", "Fees"], ["/safety", "Safety"]] as const) {
      expect(app).toContain(`const ${name} = lazyWithPreload(() => import("./pages/info/${name}"));`);
      expect(app).toContain(`<Route path="${path}" element=`);
      expect(vercel.rewrites.filter((r) => r.source === path).map((r) => r.destination)).toEqual([`/api/share?_og=page&_id=${path.slice(1)}`, "/index.html"]);
      expect(footer).toContain(`<Link to="${path}" className={FOOTER_LINK}>`);
    }
  });
});
