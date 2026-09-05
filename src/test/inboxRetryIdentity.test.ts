// The inbox's "Try again" button was dead in the exact state it was added for.
//
// `useMessagesData.loadError` has two branches:
//     conversationsError || (identityStalled && !resolvedUserId)
// The second exists because the conversations query is `enabled: !!resolvedUserId`
// and a disabled React Query reports `isPending` forever — so a session that
// fails to rehydrate on resume left the inbox on its skeleton for good
// (reproduced on an iPhone 17 Pro simulator, 2026-08-19). An 8s grace window
// was added to fall through to the ErrorState instead, and the code comment
// said that state "already offers a retry".
//
// It did not. The retry was:
//     onRetry={() => { if (userId) loadConversations(userId); }}
// and that branch is DEFINED by the user id being null. So the fix swapped an
// infinite skeleton for an error screen whose only button silently did nothing.
// Killing and relaunching the app was still the only way out.
//
// These are source-level assertions on purpose. The defect is not observable
// from behaviour without an 8-second fake-timer dance through a real Supabase
// session rehydration; what actually went wrong is a retry wired to the wrong
// recovery action, and that IS visible in the source. A behavioural test that
// mounted the component and clicked the button would have passed before the
// fix too, because "nothing happens" is indistinguishable from "refetch
// returned the same error" unless you assert which call was made.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const HOOK = read("src/pages/messages/useMessagesData.ts");
const LIST = read("src/components/messages/ConversationList.tsx");

describe("inbox retry — the identity-stall branch", () => {
  it("no longer guards the retry on the id that is null in that branch", () => {
    // The exact dead line. If this ever comes back, the button dies with it.
    expect(LIST).not.toContain("if (userId) loadConversations(userId)");
  });

  it("routes the error state's retry through retryInbox", () => {
    expect(LIST).toContain("onRetry={() => { void retryInbox(); }}");
    expect(LIST).toContain("retryInbox: () => void | Promise<void>");
  });

  it("retryInbox refetches conversations when an id IS known", () => {
    const body = HOOK.slice(HOOK.indexOf("const retryInbox"));
    expect(body).toContain("if (resolvedUserId)");
    expect(body).toContain("queryKeys.messages.conversations(resolvedUserId)");
  });

  it("retryInbox re-attempts the SESSION when no id is known", () => {
    // The whole point: with no id there is nothing to refetch the inbox WITH,
    // so the retry has to recover identity instead. Anything less is the
    // no-op this test exists to prevent.
    const body = HOOK.slice(HOOK.indexOf("const retryInbox"));
    expect(body).toContain("supabase.auth.refreshSession()");
    // Recovered session must repopulate useCurrentUser, which feeds
    // `cachedUser` — half of `resolvedUserId`. Without this the refresh
    // succeeds and the UI never notices.
    expect(body).toContain("queryKeys.currentUser.all");
  });

  it("clears the stall flag so a retry returns to the skeleton", () => {
    // Without this the same ErrorState re-renders instantly under a retry
    // that is still in flight, which reads as another dead press.
    const body = HOOK.slice(HOOK.indexOf("const retryInbox"));
    expect(body.indexOf("setIdentityStalled(false)"))
      .toBeLessThan(body.indexOf("if (resolvedUserId)"));
  });

  it("does not swallow a failed refresh", () => {
    const body = HOOK.slice(HOOK.indexOf("const retryInbox"));
    expect(body).toContain("report(error");
  });

  it("still exposes retryInbox from the hook", () => {
    expect(HOOK).toMatch(/\n\s{4}retryInbox,/);
  });
});
