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

/** Blank `//` and block comments, leaving anything inside a string literal alone. */
function blankComments(src: string): string {
  let out = "";
  let quote: string | null = null;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quote) {
      out += ch;
      if (ch === "\\") {
        out += src[++i] ?? "";
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      out += ch;
      continue;
    }
    if (ch === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") {
        out += " ";
        i++;
      }
      out += "\n";
      continue;
    }
    if (ch === "/" && src[i + 1] === "*") {
      const close = src.indexOf("*/", i + 2);
      const stop = close === -1 ? src.length : close + 2;
      for (; i < stop; i++) out += src[i] === "\n" ? "\n" : " ";
      i--;
      continue;
    }
    out += ch;
  }
  return out;
}

/**
 * `retryInbox`'s OWN body — brace-matched, with comments blanked.
 *
 * Every assertion below used to read `HOOK.slice(HOOK.indexOf("const
 * retryInbox"))`: an unbounded slice running to the end of a 713-line file, so
 * anything the REST of the hook happened to contain satisfied it. Measured
 * 2026-09-21 — deleting the `report(error, …)` from inside `retryInbox`, the
 * line that is the difference between "the retry did nothing" and "you are
 * signed out", left this file GREEN (7 passed), satisfied by the unrelated
 * `report(error, …)` in `openConvo` sixty lines further down.
 *
 * Comments are blanked too: a body whose PROSE names
 * `supabase.auth.refreshSession()` must not satisfy an assertion that it CALLS
 * it. Blanked rather than deleted, so the `indexOf` ordering check below still
 * compares real positions.
 */
function functionBody(src: string, declaration: string): string {
  const at = src.indexOf(declaration);
  if (at === -1) {
    throw new Error(
      `${declaration} is gone from useMessagesData.ts — this guard is reading nothing`,
    );
  }
  const open = src.indexOf("{", at);
  if (open === -1) throw new Error(`no body found for ${declaration}`);
  let depth = 0;
  let end = -1;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) {
      end = i + 1;
      break;
    }
  }
  if (end === -1) throw new Error(`unbalanced braces after ${declaration}`);
  return blankComments(src.slice(at, end));
}

const RETRY_BODY = functionBody(HOOK, "const retryInbox");

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
    const body = RETRY_BODY;
    expect(body).toContain("if (resolvedUserId)");
    expect(body).toContain("queryKeys.messages.conversations(resolvedUserId)");
  });

  it("retryInbox re-attempts the SESSION when no id is known", () => {
    // The whole point: with no id there is nothing to refetch the inbox WITH,
    // so the retry has to recover identity instead. Anything less is the
    // no-op this test exists to prevent.
    const body = RETRY_BODY;
    expect(body).toContain("supabase.auth.refreshSession()");
    // Recovered session must repopulate useCurrentUser, which feeds
    // `cachedUser` — half of `resolvedUserId`. Without this the refresh
    // succeeds and the UI never notices.
    expect(body).toContain("queryKeys.currentUser.all");
  });

  it("clears the stall flag so a retry returns to the skeleton", () => {
    // Without this the same ErrorState re-renders instantly under a retry
    // that is still in flight, which reads as another dead press.
    const body = RETRY_BODY;
    expect(body.indexOf("setIdentityStalled(false)"))
      .toBeLessThan(body.indexOf("if (resolvedUserId)"));
  });

  it("does not swallow a failed refresh", () => {
    const body = RETRY_BODY;
    expect(body).toContain("report(error");
  });

  it("still exposes retryInbox from the hook", () => {
    expect(HOOK).toMatch(/\n\s{4}retryInbox,/);
  });
});

// Swallow the failed session refresh. The user taps "Try again", the refresh
// fails, and nothing anywhere records that they are actually signed out — the
// silent-failure half of the original dead-button defect. This is the exact
// mutation that SURVIVED while the assertions read an unbounded slice to the
// end of the file (the `report(error, …)` in `openConvo` satisfied it).
// @mutate src/pages/messages/useMessagesData.ts | report(error, { severity: "warning", tags: { source: "useMessagesData.retryIdentity" } }); | void error;
