/**
 * Audit 11-01 JA-49: the poster's line for a direct offer read "Your offer is with them": no name, no expiry.
 * It now says who and until when ("Yusef has until Sat 9:00 AM to answer"); with no name known it still says
 * when the answer is due. A passed or missing time falls back to the plain line (never a time already gone).
 *
 * @mutate src/components/job-card/jobStatusLine.ts |     return by ? `${firstName(n)} has until ${dayTime(by)} to answer` : `Your offer is with ${firstName(n)}`; |     return `Your offer is with ${firstName(n)}`;
 * @mutate src/components/job-card/jobStatusLine.ts |   const offerBy = id === "offer_out" && !helperName ? offerAnswerByMs(job) : null; |   const offerBy = null as number \| null;
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { posterStatusLine } from "@/components/job-card/jobStatusLine";

type J = Parameters<typeof posterStatusLine>[0];
const NOW = new Date("2026-11-01T15:00:00Z");
const job = (o: Partial<J> = {}) =>
  ({ id: "j1", status: "open", direct_offer_status: "pending", direct_offer_expires_at: "2026-11-07T15:00:00Z", response_deadline: null, ...o }) as unknown as J;

describe("a direct offer's line says who and until when (JA-49)", () => {
  afterEach(() => vi.useRealTimers());

  it("named: Yusef has until Sat 9:00 AM to answer", () => {
    vi.useFakeTimers({ now: NOW });
    const l = posterStatusLine(job(), 0, NOW, undefined, false, "Yusef Ali");
    expect(l.id).toBe("offer_out");
    expect(l.detail).toBe("Yusef has until Sat 9:00 AM to answer");
  });

  it("no name known: still says when the answer is due", () => {
    vi.useFakeTimers({ now: NOW });
    expect(posterStatusLine(job(), 0, NOW).detail).toBe("Your offer is out · answer due Sat 9:00 AM");
  });

  it("a passed time is never shown", () => {
    vi.useFakeTimers({ now: NOW });
    const l = posterStatusLine(job({ direct_offer_expires_at: "2026-10-30T15:00:00Z" } as Partial<J>), 0, NOW, undefined, false, "Yusef Ali");
    expect(l.detail).toBe("Your offer is with Yusef");
  });
});
