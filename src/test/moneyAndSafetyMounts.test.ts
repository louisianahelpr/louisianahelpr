/**
 * Boards 143 and 156: three built components are MOUNTED where the boards put
 * them, not only built. A component nobody renders is a feature members never
 * see (Builder 5 built them; the lead's 10-21 note asked for the mounts):
 *  - PayoutFailedCard in Home, first in the main column under the greeting;
 *  - FeesOwedLine in You › Money (EarningsTab), just above the one-time
 *    setup-fee line (the lead's 10-21 placement);
 *  - SafetyShieldButton in the deal-room chat header, only for the thread
 *    between the poster and the HIRED Helpr.
 *
 * @mutate src/pages/home/HomeDashboard.tsx |             <PayoutFailedCard /> |             {null}
 * @mutate src/components/profile/EarningsTab.tsx |           <FeesOwedLine /> |           {null}
 * @mutate src/components/messages/ChatHeader.tsx |       {safetyJob && <SafetyShieldButton job={safetyJob} />} |       {null}
 * @mutate src/components/messages/chatView/DealCard.tsx |   return convo.viewerIsPoster ? job.helper_id === convo.otherUserId : job.helper_id === uid; |   return true;
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isHiredPairThread } from "@/components/messages/chatView/DealCard";

const src = (p: string) => readFileSync(p, "utf8");

describe("money and safety components are mounted (boards 143, 156)", () => {
  it("Home renders PayoutFailedCard first in its main column", () => {
    const s = src("src/pages/home/HomeDashboard.tsx");
    const main = s.indexOf("data-home-main");
    const card = s.indexOf("<PayoutFailedCard />");
    expect(main).toBeGreaterThan(-1);
    expect(card).toBeGreaterThan(main);
    // Before Live now and Next up: it is the one thing that needs the member.
    expect(card).toBeLessThan(s.indexOf('data-testid="live-now"'));
    expect(card).toBeLessThan(s.indexOf('data-testid="next-up"'));
  });

  it("You › Money renders FeesOwedLine just above the setup-fee line", () => {
    const s = src("src/components/profile/EarningsTab.tsx");
    const line = s.indexOf("<FeesOwedLine />");
    expect(line).toBeGreaterThan(-1);
    expect(line).toBeLessThan(s.indexOf("less: the one-time payout setup fee."));
    expect(line).toBeGreaterThan(s.indexOf("<EarningsSummaryCard"));
  });

  it("the chat header renders the shield for the hired pair's deal job", () => {
    expect(src("src/components/messages/ChatHeader.tsx")).toContain("{safetyJob && <SafetyShieldButton job={safetyJob} />}");
  });

  it("the shield's thread is the poster and the hired Helpr only", () => {
    const job = { helper_id: "helpr" };
    // Poster's side: the other person is the hired Helpr.
    expect(isHiredPairThread(job, { viewerIsPoster: true, otherUserId: "helpr" }, "poster")).toBe(true);
    // Poster's side, a not-hired applicant's thread.
    expect(isHiredPairThread(job, { viewerIsPoster: true, otherUserId: "applicant" }, "poster")).toBe(false);
    // Helpr's side: the viewer is the hired Helpr.
    expect(isHiredPairThread(job, { viewerIsPoster: false, otherUserId: "poster" }, "helpr")).toBe(true);
    // A not-hired applicant reading the job.
    expect(isHiredPairThread(job, { viewerIsPoster: false, otherUserId: "poster" }, "applicant")).toBe(false);
    // Nobody hired, or no viewer.
    expect(isHiredPairThread({ helper_id: null }, { viewerIsPoster: true, otherUserId: "x" }, "poster")).toBe(false);
    expect(isHiredPairThread(job, { viewerIsPoster: false, otherUserId: "poster" }, "")).toBe(false);
  });
});
