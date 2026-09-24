/**
 * checkDrift — the zod boundary check, off the critical path (PD-020).
 *
 * validateResult() never blocks a screen: on drift it reports to Sentry and the
 * caller keeps the raw payload. Every call site ignored its return value, yet
 * importing it statically put zod (the `forms` chunk, ~80 KB raw) on the boot
 * path of every signed-in page via useProfile. Here the schema is named, not
 * imported, and zod + the schemas load after the data is already on screen.
 */
export type DriftSchema = "sharedProfileOrNull" | "helperApplications" | "jobRow";

export function checkDrift(schema: DriftSchema, data: unknown, context: string): void {
  void Promise.all([import("./schemas"), import("./validateResult")])
    .then(([schemas, { validateResult }]) => {
      if (schema === "sharedProfileOrNull") validateResult(schemas.sharedProfileOrNullSchema, data, context);
      else if (schema === "helperApplications") validateResult(schemas.helperApplicationsSchema, data, context);
      else validateResult(schemas.jobRowSchema, data, context);
    })
    .catch(() => {
      /* observability must never break the app */
    });
}
