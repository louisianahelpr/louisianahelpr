/**
 * F260q (owner 11-11 "Spanish EVERYTHING now"): a new member's Home cards in their language: the welcome card's three
 * starting actions, the poster's first-job checklist steps and the shared checklist line ("1 of 3", "Next:"), from
 * enHome / esHome. English reads the old words. FirstJobHome's body too: its steps, Jobs near you, the alerts card and
 * How you get paid (its day counts from the shared payout constants).
 *
 * @mutate src/pages/home/homeDashboard/WelcomeCard.tsx | >{t("home.wc.title")}</h2> | >What brings you here?</h2>
 * @mutate src/pages/home/homeDashboard/FirstJobHome.tsx | {tr("home.ck.next")} <span | Next: <span
 * @mutate src/pages/home/homeDashboard/FirstJobHome.tsx | · {tr("home.ck.count", { done: doneCount, total: steps.length })}</span> | · {doneCount} of {steps.length}</span>
 * @mutate src/pages/home/homeDashboard/FirstJobHome.tsx | label: tr("home.fj.about"), | label: "Add a photo and a line about you",
 * @mutate src/pages/home/homeDashboard/FirstJobHome.tsx | >{tr("home.fj.alertsTitle")}</span> | >Get told about new jobs nearby</span>
 * @mutate src/pages/home/homeDashboard/FirstJobHome.tsx | text-foreground">{tr("home.fj.howPaid")}</h2> | text-foreground">How you get paid</h2>
 * @mutate src/pages/home/homeDashboard/PosterFirstJobCard.tsx | label: t("home.pf.approve"), | label: "Approve the work when it's done",
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { setLang, ensureLangLoaded, __resetLangForTests } from "@/lib/i18n/language";

vi.mock("@/hooks/useAgeGate", () => ({ useAgeGate: () => ({ underAge: false, explain: vi.fn(), gate: (_k: string, fn: () => void) => fn }) }));
vi.mock("@/hooks/usePayoutSetupPaused", () => ({ usePayoutSetupPaused: () => false }));
vi.mock("@/lib/haptics", () => ({ hapticMedium: vi.fn(), hapticLight: vi.fn() }));
vi.mock("@tanstack/react-query", async (orig) => ({ ...(await orig<typeof import("@tanstack/react-query")>()), useQuery: () => ({ data: { posted: true, hired: true, finished: false } }) }));

const { WelcomeCard } = await import("@/pages/home/homeDashboard/WelcomeCard");
const { PosterFirstJobCard } = await import("@/pages/home/homeDashboard/PosterFirstJobCard");
const { FirstJobHome } = await import("@/pages/home/homeDashboard/FirstJobHome");

const show = () => render(<MemoryRouter><WelcomeCard sell /><PosterFirstJobCard userId="u1" /></MemoryRouter>);

describe("a new member's Home cards follow the language (F260q)", () => {
  afterEach(() => {
    cleanup();
    __resetLangForTests();
  });

  it("English: the old words", () => {
    show();
    expect(screen.getByRole("heading", { name: "What brings you here?" })).toBeTruthy();
    expect(screen.getByText("Sell something")).toBeTruthy();
    expect(screen.getByText("· 2 of 3")).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "Your first job posted: 2 of 3 done" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Next: Approve the work when it's done/ })).toBeTruthy();
  });

  it("Spanish: the welcome actions, the checklist title, count, steps and Next", async () => {
    setLang("es");
    await ensureLangLoaded();
    show();
    expect(screen.getByRole("heading", { name: "¿Qué le trae por aquí?" })).toBeTruthy();
    expect(screen.getByText("Publicar un trabajo")).toBeTruthy();
    expect(screen.getByText("Publique un artículo en Declutter")).toBeTruthy();
    expect(screen.getByText("· 2 de 3")).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "Su primer trabajo publicado: 2 de 3 hechos" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Siguiente: Apruebe el trabajo cuando esté hecho/ })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/What brings|Sell something|of 3|Next:|Hire a Helpr/);
  });
});

describe("the first-job Home card follows the language (F260q)", () => {
  afterEach(() => {
    cleanup();
    __resetLangForTests();
  });
  const showFirst = () => render(<MemoryRouter><FirstJobHome profile={null} alertsOff /></MemoryRouter>);

  it("English: the old words, and How you get paid reads the shared payout phrases", () => {
    showFirst();
    expect(screen.getByRole("heading", { name: "Get your first job" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Next: Pick what you do/ })).toBeTruthy();
    expect(screen.getByText("Get told about new jobs nearby")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Turn on" })).toBeTruthy();
    expect(document.body.textContent).toContain("it reaches your Helpr account 3 days after the job is approved, and your bank within 2 business days after that.");
  });

  it("Spanish: the checklist, the alerts card and How you get paid, with the same day counts", async () => {
    setLang("es");
    await ensureLangLoaded();
    showFirst();
    expect(screen.getByRole("heading", { name: "Consiga su primer trabajo" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Siguiente: Elija lo que hace/ })).toBeTruthy();
    expect(screen.getByText("Entérese de trabajos nuevos cerca")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Activar" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Cómo le pagan" })).toBeTruthy();
    expect(document.body.textContent).toContain("llega a su cuenta de Helpr 3 días después de que se aprueba el trabajo, y a su banco en 2 días hábiles");
    expect(document.body.textContent).not.toMatch(/Get your first|Pick what you do|Get told|How you get paid|Read more|Turn on/);
  });
});
