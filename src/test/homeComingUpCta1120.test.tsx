/**
 * Owner polish 11-20: Home's empty "Coming up · Nothing booked yet" gets a helpful next step: Post a job (through the
 * age gate, like the Create pill and the welcome card) and Find work (the jobs feed), as outline buttons so Home keeps
 * its one primary action. English and Spanish.
 *
 * @mutate src/pages/home/homeDashboard/ComingUpCta.tsx | onClick={gate.gate("post", () => navigate("/post-job"))} | onClick={() => navigate("/post-job")}
 * @mutate src/pages/home/homeDashboard/ComingUpCta.tsx | onClick={() => navigate("/jobs")} | onClick={() => navigate("/home")}
 * @mutate src/pages/home/HomeDashboard.tsx |                   <ComingUpCta />\n | \n
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { blankComments } from "./helpers/blankNonCode";

const ageGate = vi.hoisted(() => ({ underAge: false, explain: vi.fn() }));
vi.mock("@/hooks/useAgeGate", () => ({
  useAgeGate: () => ({
    underAge: ageGate.underAge,
    explain: ageGate.explain,
    gate: (kind: string, go: () => void) => () => (ageGate.underAge ? ageGate.explain(kind) : go()),
    gatedProps: () => ({}),
  }),
}));

import { ComingUpCta } from "@/pages/home/homeDashboard/ComingUpCta";
import { setLang, ensureLangLoaded, __resetLangForTests } from "@/lib/i18n/language";

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}
const draw = () =>
  render(
    <MemoryRouter initialEntries={["/home"]}>
      <Routes><Route path="*" element={<><ComingUpCta /><Where /></>} /></Routes>
    </MemoryRouter>,
  );

describe("Coming up's empty state offers Post a job and Find work (owner polish 11-20)", () => {
  afterEach(() => {
    cleanup();
    ageGate.underAge = false;
    ageGate.explain.mockReset();
    __resetLangForTests();
  });

  it("two outline buttons, each going where it says", () => {
    draw();
    const buttons = [...document.querySelectorAll("[data-coming-up-cta] button")];
    expect(buttons.map((b) => b.textContent)).toEqual(["Post a job", "Find work"]);
    fireEvent.click(screen.getByText("Find work"));
    expect(screen.getByTestId("where").textContent).toBe("/jobs");
    fireEvent.click(screen.getByText("Post a job"));
    expect(screen.getByTestId("where").textContent).toBe("/post-job");
  });

  it("Post a job goes through the age gate", () => {
    ageGate.underAge = true;
    draw();
    fireEvent.click(screen.getByText("Post a job"));
    expect(ageGate.explain).toHaveBeenCalledWith("post");
    expect(screen.getByTestId("where").textContent).toBe("/home");
  });

  it("in Spanish", async () => {
    setLang("es");
    await ensureLangLoaded();
    draw();
    expect(screen.getByText("Publicar un trabajo")).toBeTruthy();
    expect(screen.getByText("Buscar trabajo")).toBeTruthy();
  });

  it("Home draws it under the empty line, inside Coming up", () => {
    const home = blankComments(readFileSync("src/pages/home/HomeDashboard.tsx", "utf8"));
    const empty = home.indexOf('data-testid="coming-up-empty"');
    expect(empty).toBeGreaterThan(0);
    const cta = home.indexOf("<ComingUpCta />", empty);
    expect(cta).toBeGreaterThan(empty);
    expect(cta).toBeLessThan(home.indexOf("</GroupSection>", empty));
  });
});
