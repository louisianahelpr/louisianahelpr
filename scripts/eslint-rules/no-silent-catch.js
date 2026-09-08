/**
 * no-silent-catch — a `catch` must not swallow a failure without a trace.
 *
 * WHY THIS RULE EXISTS
 * The most damaging defects in this codebase produce no error, no log and no
 * user signal. `rpc_withdraw_dispute` was dead for every caller for months
 * with ZERO Sentry events, because the client caught the failure and toasted
 * "please try again" without ever reporting it. A `catch {}` on an auth,
 * money or safety path turns a broken feature into a feature that silently
 * never fires — and nothing in review, CI or the type system can see it,
 * because the code reads perfectly.
 *
 * WHAT SATISFIES IT
 * A catch block passes when it does ANY of the following:
 *   1. calls `report(...)`  (@/lib/errorLogger — the monitoring path)
 *   2. rethrows              (`throw` — the caller is now responsible)
 *   3. tells the user        (`toast.*`)
 *   4. logs                  (`console.error` / `console.warn`)
 *   5. carries a comment INSIDE the catch body explaining why silence is
 *      correct here — the deliberate opt-out.
 *
 * WHY A COMMENT IS AN ACCEPTED OPT-OUT
 * Plenty of catches here are legitimately silent: a `JSON.parse` fallback in
 * `safeStorage`, a feature-detection probe, a cancelled user gesture.
 * Reporting those would flood monitoring and bury the real signal, which is
 * the same failure in the opposite direction. The rule is not "always
 * report" — it is "never swallow ACCIDENTALLY". Writing the reason down is
 * what converts a silent catch from an oversight into a decision, and it is
 * the artifact a future reader needs when they wonder whether the silence
 * was considered.
 *
 * WHY THE COMMENT HAS A LENGTH FLOOR
 * A bare `// noop` or `// ignore` restates the code and justifies nothing —
 * it would let the rule pass vacuously, which is the exact shape of guard
 * this repo has been bitten by before (a check that cannot fail is worse
 * than no check, because it reads as satisfied). So the comment must carry
 * at least `minCommentChars` characters of actual text. That is a crude
 * proxy for "someone explained themselves", and it is deliberately crude:
 * the goal is to make the lazy escape hatch slightly harder than thinking.
 *
 * Comments are read from INSIDE the catch body only. A comment sitting above
 * the `catch` keyword usually documents the `try`, not the swallow.
 */

const DEFAULT_MIN_COMMENT_CHARS = 25;

/** Call expressions that count as "this failure left a trace". */
function isTracingCall(node) {
  const callee = node.callee;
  if (!callee) return false;
  // report(...)
  if (callee.type === "Identifier" && callee.name === "report") return true;
  if (callee.type === "MemberExpression") {
    const obj = callee.object;
    const prop = callee.property;
    const propName = prop && prop.type === "Identifier" ? prop.name : null;
    const objName = obj && obj.type === "Identifier" ? obj.name : null;
    // toast.error(...) / toast.success(...) / toast(...) via member
    if (objName === "toast") return true;
    // console.error(...) / console.warn(...) — logging, not monitoring, but
    // it is a trace: the failure is at least visible in a devtools session.
    if (objName === "console" && (propName === "error" || propName === "warn")) return true;
    // Sentry.captureException(...) and friends
    if (objName === "Sentry") return true;
  }
  return false;
}

/** Walk a subtree looking for a tracing call or a rethrow. */
function bodyLeavesATrace(body) {
  let found = false;
  const seen = new Set();
  const visit = (node) => {
    if (found || !node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (typeof node.type === "string") {
      if (node.type === "ThrowStatement") {
        found = true;
        return;
      }
      if (node.type === "CallExpression" && isTracingCall(node)) {
        found = true;
        return;
      }
      // Do NOT descend into a nested function: a `report()` inside a callback
      // that this catch merely *defines* is not a report this catch performs.
      if (
        node.type === "FunctionDeclaration" ||
        node.type === "FunctionExpression" ||
        node.type === "ArrowFunctionExpression"
      ) {
        return;
      }
    }
    for (const key of Object.keys(node)) {
      if (key === "parent" || key === "loc" || key === "range") continue;
      visit(node[key]);
    }
  };
  visit(body);
  return found;
}

/** Total characters of comment text inside the catch body. */
function justificationLength(sourceCode, body) {
  const comments = sourceCode.getCommentsInside(body);
  return comments.reduce((sum, c) => sum + c.value.trim().length, 0);
}

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Require a catch block to report, rethrow, surface, or justify its silence in a comment.",
    },
    schema: [
      {
        type: "object",
        properties: { minCommentChars: { type: "integer", minimum: 0 } },
        additionalProperties: false,
      },
    ],
    messages: {
      silent:
        "This `catch` swallows a failure and leaves no trace. A silent catch on an " +
        "auth, money or safety path is how a broken feature becomes a feature that " +
        "never fires and never says why (rpc_withdraw_dispute: months of 100% " +
        "failure, zero Sentry events). Do ONE of:\n" +
        "  • call report(err, { tags: { … } }) from @/lib/errorLogger — the default;\n" +
        "  • rethrow, if the caller should handle it;\n" +
        "  • toast the user, if they can act on it;\n" +
        "  • or, if silence really is correct here (a JSON.parse fallback, a " +
        "feature probe, a cancelled gesture), write a comment INSIDE the catch " +
        "saying why. That comment is the whole point: it turns an accidental " +
        "swallow into a decision someone can review.",
    },
  },

  create(context) {
    const opts = context.options[0] || {};
    const minCommentChars =
      typeof opts.minCommentChars === "number"
        ? opts.minCommentChars
        : DEFAULT_MIN_COMMENT_CHARS;
    const sourceCode = context.sourceCode || context.getSourceCode();

    return {
      CatchClause(node) {
        if (bodyLeavesATrace(node.body)) return;
        if (justificationLength(sourceCode, node.body) >= minCommentChars) return;
        context.report({ node, messageId: "silent" });
      },
    };
  },
};
