// Owner decision 2026-09-25 (docs/OPEN.md Q407 addendum 14): once someone is
// off a job (rejected applicant, removed crew member, declined or expired
// offeree) messaging closes BOTH ways. The server refuses the send with a bare
// 42501 (20260925175953 + 20260925230845; proof in real Postgres:
// src/test/pglite/messageGateCurrentParty.pglite.mjs). Before this, the client
// kept a working composer and every send came back as a RETRYABLE "didn't go
// through" bubble that could never succeed (lh-authz-rls review M2).
//
// This pins the client half without a mocked Supabase (CLAUDE.md: no new
// mocked-Supabase specs): the read-only notice is what the composer renders,
// its copy is not role-based, and the source wiring routes an RLS refusal the
// server attributes to "off the job" to a non-retryable `refused` bubble
// BEFORE the retryable path. Comments are blanked before any source scan.
//
// @mutate src/components/messages/chatView/ChatComposer.tsx |   if (offJobState) { |   if (offJobState && false) {
// @mutate src/pages/messages/messagesData/sendHandlers.ts |           const offJob = await fetchOffJobState(optimistic.job_id, receiverId); |           const offJob = null;
// @mutate src/components/messages/ChatView.tsx |   const composerLocked = isApplicant && !posterHasMessaged && !offJobState; |   const composerLocked = isApplicant && !posterHasMessaged;
// @mutate src/components/messages/ChatView.tsx |             offJobState={offJobState}\n | \n
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { ChatComposer } from "@/components/messages/chatView/ChatComposer";
import type { Conversation } from "@/components/messages/types";
import { OFF_JOB_TOAST, offJobNotice } from "./offJobGate";
import { blankComments } from "@/test/helpers/blankNonCode";

const ROOT = resolve(__dirname, "..", "..");
const src = (p: string) => blankComments(readFileSync(resolve(ROOT, p), "utf8"));

const base = {
  composerLocked: false,
  chatLoadError: false,
  keyboardInset: 0,
  activeConvo: { jobId: "j", otherUserId: "o" } as unknown as Conversation,
  messages: [],
  userId: "me",
  draft: "",
  setDraft: () => {},
  sendMessage: async () => true,
  broadcastTyping: () => {},
};

describe("off the job: the composer is a read-only notice", () => {
  for (const state of ["self", "other"] as const) {
    it(`'${state}': no composer, the notice says why`, () => {
      render(<ChatComposer {...base} offJobState={state} draft="half a sentence" />);
      expect(screen.getByTestId("thread-off-job-notice")).toBeTruthy();
      expect(screen.getByRole("status").textContent).toBe(offJobNotice(state));
      expect(screen.queryByRole("textbox")).toBeNull();
      // The text being typed when it closed is kept on screen, like the lockout.
      expect(screen.getByTestId("thread-closed-unsent-draft").textContent).toContain("half a sentence");
    });
  }

  it("wins over the poster-first lock (someone off the job is not waiting to be contacted)", () => {
    render(<ChatComposer {...base} composerLocked offJobState="self" />);
    expect(screen.getByTestId("thread-off-job-notice")).toBeTruthy();
  });

  it("an open thread still gets the composer", () => {
    render(<ChatComposer {...base} offJobState={null} />);
    expect(screen.queryByTestId("thread-off-job-notice")).toBeNull();
  });

  it("the copy names what happened, never a role", () => {
    for (const text of [offJobNotice("self"), offJobNotice("other"), OFF_JOB_TOAST]) {
      expect(text).not.toMatch(/\b(poster|posted|helpr|helper|applicant|crew|offer)\b/i);
      expect(text.length).toBeGreaterThan(20);
    }
    expect(offJobNotice("self")).toMatch(/you're no longer on this job/);
    expect(offJobNotice("other")).toMatch(/they're no longer on this job/);
  });
});

describe("off the job: source wiring", () => {
  it("the send path turns an off-the-job RLS refusal into a non-retryable bubble before the retryable one", () => {
    const code = src("src/pages/messages/messagesData/sendHandlers.ts");
    const at = code.indexOf("const offJob = await fetchOffJobState(optimistic.job_id, receiverId);");
    expect(at, "the 42501 branch no longer asks the server whether the thread is off the job").toBeGreaterThan(0);
    const branch = code.slice(at, code.indexOf("return;", at) + "return;".length);
    expect(branch).toContain("toast.error(OFF_JOB_TOAST)");
    expect(branch).toContain('sendStatus: "refused"');
    expect(branch).toContain("offJobState: offJob");
    expect(at, "asked after the retryable fallback: a refused send would still offer a retry").toBeLessThan(
      code.indexOf(`toast.error("Message didn't go through — tap it to try again.")`),
    );
    expect(code.lastIndexOf('code === "42501"', at)).toBeGreaterThan(0);
  });

  it("ChatView asks the server and hands the answer to the composer", () => {
    const code = src("src/components/messages/ChatView.tsx");
    expect(code).toMatch(/const offJobState = useOffJobState\(\{ activeConvo, userId, skip: threadClosed \}\);/);
    expect(code).toContain("const composerLocked = isApplicant && !posterHasMessaged && !offJobState;");
    expect(code).toContain("offJobState={offJobState}");
    expect(code).toMatch(/skip: threadClosed \|\| !!offJobState \|\| composerLocked/);
  });

  it("the client reads the server's own answer, not a re-implementation", () => {
    const code = src("src/lib/offJobGate.ts");
    expect(code).toContain('supabase.rpc("get_off_job_thread_state"');
    expect(code).not.toMatch(/\.from\("applications"\)|\.from\("group_job_helpers"\)/);
  });
});
