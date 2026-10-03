// GitHub code-scanning alerts in the ops alert ledger (2026-10-03).
//
// 63 code-scanning alerts (CodeQL) were open on main on 2026-10-03 and no
// session had seen them: the session-start summary, /admin?view=health and
// the Slack digest all read the ops alert ledger, and nothing put code
// scanning there. The hourly sync (ops-alert-ledger.mjs in prod-errors.yml)
// now keeps ONE item for them, bumped only when the set of open alerts
// changes (so an hourly sync does not inflate its count) and closed with
// evidence when none are open.

export const CODE_SCANNING_SOURCE = "code-scanning";
export const CODE_SCANNING_TITLE = "GitHub code scanning: open alerts on main";

/** The jq filter the sync hands `gh api --paginate`: one JSON object per alert. */
export const CODE_SCANNING_JQ = ".[] | {number, rule: .rule.id, severity: (.rule.security_severity_level // .rule.severity)}";

/**
 * What the ledger item says about a set of open alerts, or null when none.
 * @param {{number: number, rule: string, severity: string}[]} alerts
 */
export function summarizeCodeScanning(alerts) {
  if (!alerts.length) return null;
  const numbers = alerts.map((a) => Number(a.number)).sort((x, y) => x - y);
  const byRule = new Map();
  for (const a of alerts) byRule.set(a.rule, (byRule.get(a.rule) ?? 0) + 1);
  const rules = [...byRule].sort((x, y) => y[1] - x[1] || String(x[0]).localeCompare(String(y[0])));
  const serious = alerts.some((a) => ["critical", "high", "error"].includes(String(a.severity).toLowerCase()));
  return {
    severity: serious ? "error" : "warning",
    sample: `${alerts.length} open: ${rules.map(([r, n]) => `${n} ${r}`).join(", ")}`.slice(0, 1900),
    sampleRef: { alerts: numbers },
  };
}

/** True when the open set differs from the one the ledger item last recorded. */
export function codeScanningChanged(prevRef, numbers) {
  const prev = Array.isArray(prevRef?.alerts) ? prevRef.alerts.map(Number) : null;
  if (!prev) return true;
  return prev.length !== numbers.length || prev.some((n, i) => n !== numbers[i]);
}
