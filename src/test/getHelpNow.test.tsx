/**
 * Q2478 part 3 / CMP-3 (owner decided 2026-10-29): "Get help now" on every active job opens a message to
 * Louisiana Helpr carrying the job, and promises "We usually answer within a few hours."; Support.tsx's
 * "usually within one business day" changes to match (and Profile's support tab says the same).
 *
 * Renders the REAL GetHelpNow and follows its navigation to /support; pins the job page mount and both
 * support "Message sent" states to the one shared promise.
 *
 * @mutate src/components/jobs/GetHelpNow.tsx | navigate(`/support?topic=message&subject=${encodeURIComponent(subject)}`) | navigate("/support")
 * @mutate src/components/jobs/GetHelpNow.tsx | if (!GET_HELP_NOW_STATUSES.has(job.status ?? "")) return null; | if (!job.id) return null;
 * @mutate src/components/jobs/GetHelpNow.tsx | <p className="text-ds-13 text-muted-foreground">{SUPPORT_REPLY_PROMISE}</p> | <p className="text-ds-13 text-muted-foreground">We'll get back to you.</p>
 * CMP-3 on Declutter orders: the same one tap, only while the order needs help.
 * @mutate src/components/jobs/GetHelpNow.tsx |   if (!active) return null; |   void active;
 * @mutate src/components/jobs/GetHelpNow.tsx | (order.status === "handed_over" && problemOpen) | order.status === "handed_over"
 * @mutate src/components/jobs/GetHelpNow.tsx | const active = order.status === "paid" \|\| | const active = order.status !== "handed_over" \|\|
 * @mutate src/lib/supportSubject.ts |   return jobSubject("Help with ", order, "order"); |   return jobSubject("Help with ", order);
 * @mutate src/components/declutter/DeclutterHandoverViews.tsx |       <OrderGetHelpNow order={{ orderId: order.orderId, title, status: order.status }} problemOpen={!!problem} /> | {null}
 * @mutate src/lib/supportSubject.ts |   return jobSubject("Help with ", job); |   return jobSubject("Dispute on ", job);
 * @mutate src/lib/supportTopics.ts | export const SUPPORT_REPLY_PROMISE = "We usually answer within a few hours."; | export const SUPPORT_REPLY_PROMISE = "We usually answer within one business day.";
 * @mutate src/pages/jobs/jobPage/JobPage.tsx | {(isPoster \|\| isHired) && <GetHelpNow job={job} />} | {null}
 * @mutate src/pages/info/Support.tsx | Our team will read it and reply by email. {SUPPORT_REPLY_PROMISE} Nothing | Our team will read it and reply by email, usually within one business day. Nothing
 * @mutate src/components/profile/SupportInline.tsx | Our team will read it and reply. {SUPPORT_REPLY_PROMISE} | Our team will review and get back to you soon.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { GetHelpNow, GET_HELP_NOW_STATUSES, OrderGetHelpNow } from "@/components/jobs/GetHelpNow";
import { disputeSupportSubject, helpSupportSubject } from "@/lib/supportSubject";
import { SUPPORT_REPLY_PROMISE } from "@/lib/supportTopics";
import { blankComments } from "./helpers/blankNonCode";

const read = (p: string) => blankComments(readFileSync(p, "utf8")).replace(/\s+/g, " ");
const JOB_ID = "3f2a9c1e-7b4d-4e8a-9c1e-7b4d4e8a9c1e";

function Where() {
  const loc = useLocation();
  return <p data-testid="where">{loc.pathname + loc.search}</p>;
}
function renderFor(status: string) {
  return render(
    <MemoryRouter initialEntries={["/jobs/x"]}>
      <Routes>
        <Route path="/jobs/x" element={<GetHelpNow job={{ id: JOB_ID, title: "Mow the back yard", status }} />} />
        <Route path="/support" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Get help now on a Declutter order (CMP-3)", () => {
  const ORDER = "9d2c1b0a-7b4d-4e8a-9c1e-7b4d4e8a9c1e";
  const renderOrder = (status: string | null, problemOpen: boolean) =>
    render(
      <MemoryRouter initialEntries={["/declutter"]}>
        <Routes>
          <Route path="/declutter" element={<OrderGetHelpNow order={{ orderId: ORDER, title: "Oak rocking chair", status }} problemOpen={problemOpen} />} />
          <Route path="/support" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    );

  it("a paid order: one tap opens /support with the order named, and the same promise", () => {
    renderOrder("paid", false);
    expect(screen.getByText("We usually answer within a few hours.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Get help now" }));
    const url = new URL(screen.getByTestId("where").textContent ?? "", "https://x");
    expect(url.pathname).toBe("/support");
    expect(url.searchParams.get("topic")).toBe("message");
    expect(url.searchParams.get("subject")).toBe('Help with "Oak rocking chair" (order #9d2c1b0a)');
  });

  it("handed over: gone, unless a problem is still open on the order", () => {
    const done = renderOrder("handed_over", false);
    expect(screen.queryByRole("button", { name: "Get help now" })).toBeNull();
    done.unmount();
    renderOrder("handed_over", true);
    expect(screen.getByRole("button", { name: "Get help now" })).toBeTruthy();
  });

  // declutter_orders_status_check (20261015042253): every other status the order can hold. An open problem does not
  // bring it back on a refunded (cancelled) order: that order is over.
  it("a refunded, expired, superseded or unpaid order never shows it, problem or not", () => {
    for (const status of ["refunded", "expired", "superseded", "awaiting_payment", null]) {
      for (const problem of [false, true]) {
        const { unmount } = renderOrder(status, problem);
        expect(screen.queryByRole("button", { name: "Get help now" }), `${status} problem=${problem}`).toBeNull();
        unmount();
      }
    }
  });

  it("mounted on the shared order card, outside Details", () => {
    const card = read("src/components/declutter/DeclutterHandoverViews.tsx");
    const mount = card.indexOf("<OrderGetHelpNow order={{ orderId: order.orderId, title, status: order.status }} problemOpen={!!problem} />");
    expect(mount).toBeGreaterThan(card.indexOf("<div ref={bodyRef}"));
    expect(card.slice(mount)).toMatch(/^<OrderGetHelpNow [^>]*\/> <\/article>/);
  });
});

describe("Get help now (Q2478 part 3)", () => {
  it("the owner's promise, word for word", () => {
    expect(SUPPORT_REPLY_PROMISE).toBe("We usually answer within a few hours.");
  });

  it("on an active job: one tap opens /support aimed at a real person, the job named in the subject", () => {
    renderFor("in_progress");
    expect(screen.getByText("We usually answer within a few hours.")).toBeTruthy();
    const btn = screen.getByRole("button", { name: "Get help now" });
    expect(btn.className.split(/\s+/)).toContain("rounded-full");
    fireEvent.click(btn);
    const url = new URL(screen.getByTestId("where").textContent ?? "", "https://x");
    expect(url.pathname).toBe("/support");
    expect(url.searchParams.get("topic")).toBe("message");
    expect(url.searchParams.get("subject")).toBe('Help with "Mow the back yard" (job #3f2a9c1e)');
  });

  it("every active status shows it; open, done and cancelled jobs do not", () => {
    // Floor: the active set is not empty.
    expect(GET_HELP_NOW_STATUSES.size).toBeGreaterThan(2);
    for (const s of GET_HELP_NOW_STATUSES) {
      const { unmount } = renderFor(s);
      expect(screen.queryByRole("button", { name: "Get help now" }), s).toBeTruthy();
      unmount();
    }
    for (const s of ["open", "completed", "cancelled", "expired"]) {
      const { unmount } = renderFor(s);
      expect(screen.queryByRole("button", { name: "Get help now" }), s).toBeNull();
      unmount();
    }
  });

  it("the help subject and the dispute subject share one builder but say different things", () => {
    expect(helpSupportSubject({ id: JOB_ID, title: null })).toBe("Help with job #3f2a9c1e");
    expect(disputeSupportSubject({ id: JOB_ID, title: "Mow" })).toBe('Dispute on "Mow" (job #3f2a9c1e)');
    expect(helpSupportSubject({ id: JOB_ID, title: "x".repeat(300) }).length).toBeLessThanOrEqual(120);
  });

  it("mounted on the job page for both sides, and both support sent states make the same promise", () => {
    expect(read("src/pages/jobs/jobPage/JobPage.tsx")).toContain("{(isPoster || isHired) && <GetHelpNow job={job} />}");
    const support = read("src/pages/info/Support.tsx");
    expect(support).toContain("Our team will read it and reply by email. {SUPPORT_REPLY_PROMISE} Nothing else to do on your end.");
    expect(support).not.toMatch(/business day/);
    expect(read("src/components/profile/SupportInline.tsx")).toContain("Our team will read it and reply. {SUPPORT_REPLY_PROMISE}");
  });
});
