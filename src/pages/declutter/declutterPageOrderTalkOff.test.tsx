/**
 * D2-1 (audit 1028 part 2): an order chat's notice link (/declutter?tab=…&order_talk=<order id>) opens the chat even
 * with the Declutter switch off. A paid sale carries on with Declutter off (row 62), but OrderTalkFromLink was mounted
 * INSIDE DeclutterGate, whose children are drawn only while the switch is on: with it off the member saw the 404 (or
 * their sales to finish) and no chat.
 *
 * The gate is replaced by what it draws with the switch off (its own children never), so the test reads only where
 * DeclutterPage mounts the chat.
 *
 * @mutate src/pages/declutter/DeclutterPage.tsx |       </DeclutterGate>\n |       <OrderTalkFromLink />\n      </DeclutterGate>\n
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, useSearchParams } from "react-router-dom";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "@/test/helpers/blankNonCode";

vi.mock("@/components/declutter/declutterUi", () => ({
  // The switch is off and the member has no sale to finish: the gate draws its 404, never its children.
  DeclutterGate: () => <p>NOT FOUND</p>,
}));
vi.mock("@/components/declutter/DeclutterSkeletons", () => ({ DeclutterHomeSkeleton: () => null }));
vi.mock("@/components/declutter/DeclutterHomeView", () => ({ default: () => <p>DECLUTTER HOME</p> }));
vi.mock("@/components/declutter/DeclutterTradeViews", () => ({ FinishSalesView: () => null }));
vi.mock("@/components/declutter/DeclutterHandoverTalk", () => ({ HandoverTalkFromLink: () => null }));
vi.mock("@/hooks/useFeature", () => ({ useFeatureStatus: () => ({ on: false, settled: true }) }));
vi.mock("@/components/declutter/DeclutterOrderTalk", () => ({
  OrderTalkFromLink: function Stub() {
    const [p] = useSearchParams();
    return p.get("order_talk") ? <div data-testid="order-talk-sheet">{p.get("order_talk")}</div> : null;
  },
}));

import DeclutterPage from "./DeclutterPage";

const ORDER = "00000000-0000-4000-8000-0000000000c1";

afterEach(cleanup);

describe("the order chat link with Declutter switched off", () => {
  it("opens the chat over the page the gate draws", async () => {
    render(
      <MemoryRouter initialEntries={[`/declutter?tab=selling&order_talk=${ORDER}`]}>
        <DeclutterPage />
      </MemoryRouter>,
    );
    expect(screen.getByText("NOT FOUND")).toBeInTheDocument();
    expect(screen.queryByText("DECLUTTER HOME")).toBeNull();
    // The chat's code loads on its own once a link carries ?order_talk= (B77).
    expect((await screen.findByTestId("order-talk-sheet")).textContent).toBe(ORDER);
  });

  it("DeclutterPage mounts OrderTalkFromLink once, after the gate closes", () => {
    const src = blankComments(readFileSync(join(process.cwd(), "src/pages/declutter/DeclutterPage.tsx"), "utf8"));
    const close = src.indexOf("</DeclutterGate>");
    const mounts = [...src.matchAll(/<OrderTalkFromLink\s*\/>/g)].map((m) => m.index ?? -1);
    expect(close).toBeGreaterThan(0);
    expect(mounts).toHaveLength(1);
    expect(mounts[0]).toBeGreaterThan(close);
  });
});
