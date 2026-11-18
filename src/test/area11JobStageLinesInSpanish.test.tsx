// Area 11 M12 (11-18): in Spanish the poster's job page still read "Eli is on the way · since 8:51 AM", "You'll
// confirm once they say they've arrived." and "23h 52m left to approve ..." in English. Those lines now go through t().
//
// @mutate src/pages/jobs/jobPage/OnTheWayNow.tsx | {t("jl.nowOnWay", { name })} | {name} is on the way
// @mutate src/pages/jobs/jobPage/OnTheWayNow.tsx | {t("jl.nowConfirmNote")} | You'll confirm once they say they've arrived.
// @mutate src/pages/jobs/jobPage/reviewTimeLeft.ts | return t("jl.approveLeft", { left: h > 0 ? `${h}h ${m}m` : `${m}m` }); | return `${h > 0 ? `${h}h ${m}m` : `${m}m`} left to approve or ask for a change, then Helpr support steps in`;
// @mutate src/pages/jobs/jobPage/reviewTimeLeft.ts | if (ms <= 0) return t("jl.approveLate"); | if (ms <= 0) return "You can still approve. Helpr support will check in; your payment stays held";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setLang, ensureLangLoaded, __resetLangForTests } from "@/lib/i18n/language";
import { enJobLines } from "@/lib/i18n/enJobLines";
import { esJobLines } from "@/lib/i18n/esJobLines";
import { reviewTimeLeft } from "@/pages/jobs/jobPage/reviewTimeLeft";
import { OnTheWayNow } from "@/pages/jobs/jobPage/OnTheWayNow";

// No position: the line alone (the block draws no map without one).
vi.mock("@/pages/jobs/jobPage/onTheWayPosition", () => ({ fetchOnTheWayPosition: async () => null }));

const NOW = Date.parse("2026-11-18T12:00:00Z");
const job = {
  id: "j1", status: "accepted", helper_on_the_way_at: new Date(NOW - 10 * 60_000).toISOString(), helper_arrived_at: null,
  helper_completed_at: null, poster_confirmed_working_at: null, latitude: null, longitude: null,
} as never;

function renderNow() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><OnTheWayNow job={job} helperFirst="Eli" /></QueryClientProvider>);
}

describe("job stage lines speak Spanish (area 11 M12)", () => {
  beforeEach(async () => {
    __resetLangForTests();
    setLang("es");
    await ensureLangLoaded();
  });
  afterEach(() => __resetLangForTests());

  it("the approve clock, before and after the window", () => {
    expect(reviewTimeLeft(NOW + (2 * 60 + 5) * 60_000, NOW)).toBe("Le quedan 2h 5m para aprobar o pedir un cambio; después interviene el soporte de Helpr");
    expect(reviewTimeLeft(NOW - 1, NOW)).toBe(esJobLines["jl.approveLate"]);
  });

  it("the on-the-way block", () => {
    renderNow();
    expect(screen.getByText(/Eli va en camino/)).toBeInTheDocument();
    expect(screen.getByText(esJobLines["jl.nowConfirmNote"])).toBeInTheDocument();
    expect(screen.queryByText(/is on the way/)).toBeNull();
  });

  it("every new key has Spanish", () => {
    const keys = Object.keys(enJobLines).filter((k) => /^jl\.(now|approve)/.test(k));
    expect(keys.length).toBeGreaterThan(5);
    for (const k of keys) expect(esJobLines[k as keyof typeof esJobLines], k).toBeTruthy();
  });
});

// Area 11 M13 (11-18): Home's "Your payout didn't go through" card and its bank reasons were English in Spanish.
// @mutate src/components/money/PayoutFailedCard.tsx | {t("mt.pf.title")} | Your payout didn't go through
// @mutate src/components/money/payoutProblems.ts | return code && FAILURE_CODES.has(code) ? t(`mt.pf.${code}` as MsgKey) : null; | return code && FAILURE_CODES.has(code) ? "The account number isn't right." : null;
describe("the payout-failed card speaks Spanish (area 11 M13)", () => {
  beforeEach(async () => {
    __resetLangForTests();
    setLang("es");
    await ensureLangLoaded();
  });
  afterEach(() => __resetLangForTests());

  it("its bank reasons and its words", async () => {
    const { payoutFailureWords } = await import("@/components/money/payoutProblems");
    const { esMoneyTiles } = await import("@/lib/i18n/esMoneyTiles");
    expect(payoutFailureWords("invalid_account_number")).toBe("El número de cuenta no es correcto.");
    expect(payoutFailureWords("not_a_code")).toBeNull();
    const src = (await import("@/components/money/PayoutFailedCard.tsx?raw")).default;
    const keys = [...src.matchAll(/t\("(mt\.pf\.[a-zA-Z]+)"/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(3);
    for (const k of keys) expect(esMoneyTiles[k as keyof typeof esMoneyTiles], k).toBeTruthy();
    expect(src).not.toMatch(/>Your payout didn't go through</);
  });
});
