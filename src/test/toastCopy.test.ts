/**
 * TOAST COPY FOLLOWS THE APP'S COPY RULES — every toast, from the inventory (Q228).
 *
 * Toasts are the largest body of user-facing copy in the app, and until
 * 2026-09-26 nobody had read them as a set. The sweep that day, over the
 * inventory scripts/toast-inventory.mjs builds from the TypeScript AST of
 * src/, found (counts measured that day, before → after the fix):
 *
 *   - RAW ERROR TEXT: 49 toasts could show an error's own `.message` —
 *     `toast.error(err instanceof Error ? err.message : "…")`, `"Export
 *     failed: " + error.message`, `(err as Error).message || "Action failed"`
 *     — so a PostgREST, WebKit or supabase-js string ("Failed to send a
 *     request to the Edge Function", "new row violates row-level security")
 *     reached a person as if it were advice. 43 now go through
 *     userFacingError(), which keeps a human sentence and drops a machine
 *     one; the 6 that carry copy the app wrote itself are RAW_ERROR_EXEMPT.
 *   - an error title with no closing punctuation next to hundreds that have
 *     one (43 → 0 outside message-ending templates), a title with a
 *     description ending in "." against the label style of the rest (4 → 0),
 *     "!" (4 → 0), an emoji "⚠️ Warning:" prefix on a toast already styled as
 *     an error (1 → 0), "You must be logged in." where the app says "sign in"
 *     everywhere else (2 → 0), a lowercase "helpr" (2 → 0), and a bare
 *     "Action failed" / "Export failed" / "Payout failed" / "Send failed" with
 *     no next step (9 → 0).
 *
 * Each check below reads the same leaves the inventory records: every value a
 * title or description can evaluate to, following same-file variables,
 * helper functions and `fail(msg)` closures (copyLeaves in the script). The
 * app's error mappers (ERROR_MAPPERS) are trusted for their error argument
 * only — their fallback is shown verbatim, so it is swept like any literal.
 *
 * Not checked here, and why: copy from another module that reaches a toast as
 * a parameter or a table lookup (the 'opaque' leaves), and strings that are
 * already guarded elsewhere — "Helper" (helprNotHelperInCopy.test.ts), an
 * interpolated message followed by ". " (serverMessageSentenceEnd.test.ts),
 * functions.invoke transport errors (edgeFunctionErrorReachesTheUser.test.ts).
 *
 * @mutate src/components/PayoutSetupForm.tsx | toast.error(userFacingError(err, "We couldn't start payout setup — try again in a moment.")); | toast.error(err instanceof Error ? err.message : "We couldn't start payout setup — try again in a moment.");
 * @mutate src/components/admin/AdminExport.tsx | toast.error(userFacingError(queryErr, "Couldn't export that — try again.")); | toast.error("Export failed: " + queryErr.message);
 * @mutate src/components/profile/SubscriptionTab.tsx | toast.error(err.message); | toast.error("Couldn't start checkout — try again?");
 * @mutate src/components/admin/AdminUserNotes.tsx | "Couldn't save that note — try again." | "Couldn't save that note — try again"
 * @mutate src/pages/profile/AutoTip.tsx | "Couldn't save these settings" | "Couldn't save these settings."
 * @mutate src/pages/home/useApplyFlow.ts | "Application sent. Track it in My Jobs." | "Application sent! Track it in My Jobs."
 * @mutate src/pages/messages/logViolation.ts | "Sharing contact info or taking business off-platform isn't allowed. | "⚠️ Warning: Sharing contact info or taking business off-platform isn't allowed.
 * @mutate src/components/BlockUserDialog.tsx | "Sign in to continue." | "You must be logged in."
 * @mutate src/lib/fileExport.ts | download it from Louisiana Helpr on the web. | download it from helpr on the web.
 * @mutate src/components/admin/AdminMarketing.tsx | toast.error(userFacingError(e, "Couldn't send that — try again.")); | toast.error("Send failed");
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { copyLeaves, inventory, toastCalls, walk } from "../../scripts/toast-inventory.mjs";

const ROOT = path.resolve(__dirname, "../..");

interface Leaf {
  file: string;
  line: number;
  kind: string;
  slot: string;
  hasDescription: boolean;
  type: "literal" | "template" | "raw" | "opaque";
  text: string;
  fragment: boolean;
}

function leaves(): Leaf[] {
  const out: Leaf[] = [];
  for (const f of walk(path.join(ROOT, "src")).sort()) {
    const { sf, rel, calls } = toastCalls(f, readFileSync(f, "utf8"));
    for (const c of calls) {
      const hasDescription = c.copy.some((x) => x.slot === "description");
      for (const piece of c.copy) {
        for (const l of copyLeaves(piece.node, sf)) {
          out.push({ file: rel, line: l.line, kind: c.kind, slot: piece.slot, hasDescription, type: l.type, text: l.text, fragment: l.fragment });
        }
      }
    }
  }
  return out;
}

const ALL = leaves();
const COPY = ALL.filter((l) => l.type === "literal" || l.type === "template");
const at = (l: Leaf) => `${l.file}:${l.line} ${JSON.stringify(l.text)}`;
/** Admin screens are read by staff; deploy/queue vocabulary is theirs. */
const isAdmin = (l: Leaf) => /\/admin\//.test(l.file) || /pages\/Admin/.test(l.file);
const FAILURE_KINDS = new Set(["toast.error", "toast.warning", "errorToast"]);

/**
 * Error text the app WROTE, shown through `.message` on purpose. Keyed by
 * `file: expression`. An entry that no longer reproduces fails below.
 */
// @two-way src/test/toastCopy.test.ts:stale RAW_ERROR_EXEMPT entry
const RAW_ERROR_EXEMPT: Record<string, string> = {
  "src/components/BrowseMap.tsx: geo.message":
    "useUserLocation's error state; every message is a failWith(\"…\") literal written in that hook, never a platform error.",
  "src/components/admin/marketing/MarketingQueue.tsx: issues[0].message":
    "validateDraft() issues (marketingTypes.ts): every message is copy written in that validator.",
  "src/components/profile/SubscriptionTab.tsx: err.message":
    "only inside `err instanceof IapBlockedError`, whose message is the pre-purchase gate's copy written for the member.",
  "src/components/profile/profileEditForm/usePortfolio.ts: err.message":
    "assertUploadablePortfolioImage throws only UnsupportedPortfolioImageError / PortfolioImageTooLargeError, whose messages are app copy.",
};

describe("toast copy (Q228)", () => {
  it("the inventory is real and matches what these checks read", () => {
    const inv = inventory(ROOT);
    expect(inv.summary.calls).toBeGreaterThan(500);
    expect(COPY.length).toBeGreaterThan(500);
    // Every call the inventory lists is a call these checks walked.
    const walked = new Set(ALL.map((l) => `${l.file}:${l.kind}`));
    const missing = inv.toasts.filter((t) => (t.title || t.description || t.promise) && !walked.has(`${t.file}:${t.kind}`));
    expect(missing).toEqual([]);
  });

  it("no toast shows an error's own machine text unless the app wrote it", () => {
    const raw = ALL.filter((l) => l.type === "raw");
    const keys = [...new Set(raw.map((l) => `${l.file}: ${l.text}`))];
    const unexempt = raw.filter((l) => !Object.prototype.hasOwnProperty.call(RAW_ERROR_EXEMPT, `${l.file}: ${l.text}`)).map((l) => `${l.file}:${l.line} ${l.slot}: ${l.text}`);
    expect(unexempt, "route it through userFacingError(err, \"<human fallback>\") (src/lib/userFacingError.ts)").toEqual([]);
    const stale = Object.keys(RAW_ERROR_EXEMPT).filter((k) => !keys.includes(k));
    expect(stale, "stale RAW_ERROR_EXEMPT entry — the raw read is gone, remove the entry").toEqual([]);
  });

  it("no title is empty", () => {
    expect(COPY.filter((l) => l.slot === "title" && !l.fragment && !l.text.trim()).map(at)).toEqual([]);
  });

  it("a failure toast standing alone ends its sentence", () => {
    // A template that ends in an interpolated message leaves the ending to the
    // message (serverMessageSentenceEnd.test.ts owns that seam).
    const endsInMessage = (t: string) => /\$\{[^}]*(message|Message|error|Error|msg|reason|copy)[^}]*\}$/.test(t);
    const bad = COPY.filter(
      (l) => l.slot === "title" && !l.fragment && !l.hasDescription && FAILURE_KINDS.has(l.kind) && l.text.trim() && !/[.?!…)]$/.test(l.text.trim()) && !(l.type === "template" && endsInMessage(l.text)),
    );
    expect(bad.map(at), "end it with . or ?").toEqual([]);
  });

  it("a title with a description is a label, not a sentence", () => {
    const bad = COPY.filter((l) => l.slot === "title" && !l.fragment && l.hasDescription && /[^.]\.$/.test(l.text.trim()));
    expect(bad.map(at), "drop the period; the description carries the sentence").toEqual([]);
  });

  it("no exclamation marks and no emoji", () => {
    expect(COPY.filter((l) => /!/.test(l.text)).map(at)).toEqual([]);
    expect(COPY.filter((l) => /\p{Extended_Pictographic}/u.test(l.text)).map(at)).toEqual([]);
  });

  it("no vague failure: every 'X failed' says what to do next", () => {
    const vague = /something went wrong|an? (unknown |unexpected )?error (occurred|happened)|^unknown error|^oops|^error\.?$/i;
    const bareFailed = /^[\w\s]*\bfailed\.?$/i;
    const bad = COPY.filter((l) => !l.fragment && (vague.test(l.text.trim()) || (l.slot === "title" && !l.hasDescription && bareFailed.test(l.text.trim()))));
    expect(bad.map(at)).toEqual([]);
  });

  it("one vocabulary: sign in, Helpr, and no role or internal nouns outside admin", () => {
    expect(COPY.filter((l) => /\blog(ged)? ?(in|out)\b|\blogin\b/i.test(l.text)).map(at), "the app says 'sign in'").toEqual([]);
    expect(COPY.filter((l) => /(^|[^@.\w])helprs?\b/.test(l.text)).map(at), "'Helpr' is capitalised").toEqual([]);
    const roleOrInternal = /\b(as a (helpr|poster|customer|client)|posters?|customers?|clients?|taskers?|tasks?|RPC|PGRST\w*|supabase|postgres|database|migration|edge function|undefined|null|NaN|Error:)\b/i;
    expect(COPY.filter((l) => !isAdmin(l) && roleOrInternal.test(l.text)).map(at), "every account posts and works; say 'the person who posted this job', and never name an internal").toEqual([]);
  });
});
