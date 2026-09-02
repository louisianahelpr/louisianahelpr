/**
 * assertNever — the compile-time guard for exhaustive branching.
 *
 * WHY THIS EXISTS. `pending_approval` fell through every branch of a job-status
 * switch and rendered an empty bordered box, on jobs the app had just told the
 * poster needed them. It happened TWICE: a second status did the same thing on
 * another card. Both were invisible to review, because a `switch` with a
 * `default` and a `Record<string, …>` map are both perfectly valid code that
 * happens to be missing a case.
 *
 * The mechanism that stops it is not a checklist — it is the type system. When
 * every branch of a union is handled, the scrutinee narrows to `never` in the
 * default arm; when one is missing, it narrows to the missing member instead
 * and passing it here is a COMPILE ERROR that names the value:
 *
 *     Argument of type '"pending_approval"' is not assignable to parameter of
 *     type 'never'.
 *
 * That error appears in `npm run typecheck` the moment a new `job_status` lands
 * in the generated Supabase types, before anything renders.
 *
 * USAGE — a switch:
 *
 *     switch (status) {
 *       case "open":      return <Open />;
 *       …
 *       default:          return assertNever(status, `job status ${status}`);
 *     }
 *
 * USAGE — a lookup map. Type the map as `Record<JobStatus, T>` (NOT
 * `Record<string, T>`, which is what let `statusBadge` lose `pending_approval`)
 * and TypeScript enforces the same thing without needing a call.
 *
 * WHAT IT DOES AT RUNTIME. It throws — but only where a value the types say is
 * impossible actually arrived, which in this app has one real cause: the
 * database enum gained a member and `src/integrations/supabase/types.ts` has
 * not been regenerated. That is a bug worth surfacing, not worth rendering an
 * empty box over. Callers that must not throw on a live screen should use
 * `assertNeverSafe`, which reports and returns a fallback instead.
 */
export function assertNever(value: never, context?: string): never {
  throw new Error(
    `Unhandled case: ${JSON.stringify(value)}${context ? ` (${context})` : ""}. ` +
      `A union member has no branch — see src/lib/assertNever.ts.`,
  );
}

/**
 * The non-throwing form, for RENDER paths.
 *
 * A `switch` inside a component must not take the screen down because the DB
 * enum moved ahead of the generated types. This keeps the compile-time
 * guarantee identical (`value: never` still fails the build on a missing
 * branch) while degrading to a caller-chosen fallback at runtime.
 *
 *     default: return assertNeverSafe(status, null, `PostedJobCard status`);
 *
 * `onUnexpected` is the reporting hook — pass `report` from `@/lib/report` at
 * the call site rather than importing it here, so this module stays a leaf with
 * no dependencies and can be imported from anywhere, including tests.
 */
export function assertNeverSafe<T>(
  value: never,
  fallback: T,
  context?: string,
  onUnexpected?: (message: string) => void,
): T {
  onUnexpected?.(
    `Unhandled case: ${JSON.stringify(value)}${context ? ` (${context})` : ""}`,
  );
  return fallback;
}
