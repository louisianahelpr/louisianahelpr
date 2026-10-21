/**
 * Q185: the Sentry issue alerts docs/SENTRY_ALERT_RULES.md specifies, as data,
 * plus the pure logic that turns them into API payloads, plans what to change
 * against what Sentry already has, and checks a read-back. No I/O here: the CLI
 * is scripts/sentry/sync-alert-rules.mjs, the workflow
 * .github/workflows/sentry-alert-rules.yml, the guard
 * src/test/sentryAlertRules.test.ts.
 *
 * WHICH API (measured 2026-10-21, not assumed). Sentry retired the legacy
 * project issue-alert endpoint /api/0/projects/{org}/{project}/rules/: its docs
 * page (docs.sentry.io/api/alerts/create-an-issue-alert-rule-for-a-project)
 * is "Page Not Found", the route is absent from the OpenAPI schema and from
 * getsentry/sentry master src/sentry/api/urls.py, and sentry.io answers an
 * unauthenticated GET of it 404 (like an unknown path) where live project
 * routes answer 401. Issue alerts are now "Alerts" (internally: workflows)
 * attached to a project's "issue_stream" monitor (detector):
 *   list    GET  /api/0/organizations/{org}/workflows/
 *           https://docs.sentry.io/api/monitors/fetch-alerts/
 *   create  POST /api/0/organizations/{org}/workflows/
 *           https://docs.sentry.io/api/monitors/create-an-alert-for-an-organization/
 *   update  PUT  /api/0/organizations/{org}/workflows/{workflow_id}/
 *           https://docs.sentry.io/api/monitors/update-an-alert-by-id/
 *   monitor GET  /api/0/organizations/{org}/detectors/?project=<slug>&query=type:issue_stream
 *           https://docs.sentry.io/api/monitors/fetch-an-organizations-monitors/
 *
 * EMAIL ONLY (owner, 2026-10-21): every alert emails Suggested Assignees
 * (issue owners), falling back to Active Members. No Slack, so the doc's
 * P0/P1/P2 "targets" differ only in the re-notify interval below.
 */

/** The environment every alert evaluates in (doc: "All rules above filter to production"). */
export const ENVIRONMENT = "production";

/**
 * Re-notify interval per tier, minutes. The doc gives none; these are choices,
 * from the values the create doc allows for `config.frequency`
 * (0, 5, 10, 30, 60, 180, 720, 1440):
 * https://docs.sentry.io/api/monitors/create-an-alert-for-an-organization/
 * P0/P1 30 min (Sentry's long-standing issue-alert default); P2 is the doc's
 * "digest only", so at most once a day per issue.
 */
export const FREQUENCY_MINUTES = { P0: 30, P1: 30, P2: 1440 };

/** Allowed `config.frequency` values (create doc, `config`). */
export const ALLOWED_FREQUENCIES = [0, 5, 10, 30, 60, 180, 720, 1440];

/**
 * Event-frequency windows. The create doc's bullet list says `1min`/`1hr`, but
 * its own JSON examples send "1h", and the server validates against
 * STANDARD_INTERVALS in getsentry/sentry
 * src/sentry/workflow_engine/handlers/condition/utils/event_frequency.py,
 * whose keys are these.
 */
export const FREQUENCY_INTERVALS = ["1m", "5m", "15m", "1h", "1d", "1w", "30d"];

/** Match operators for Event Attribute / Tagged Event (create doc, "Conditions"). */
export const MATCH_TYPES = ["co", "nc", "eq", "ne", "sw", "ew", "is", "ns"];

/** Trigger types this file uses (create doc, `triggers`). */
export const TRIGGER_TYPES = ["first_seen_event", "regression_event"];

// Filter helpers. Shapes from the create doc, "Conditions":
// https://docs.sentry.io/api/monitors/create-an-alert-for-an-organization/
const message = (match, value) => ({ kind: "event_attribute", attribute: "message", match, value });
const tag = (key, match, value) => ({ kind: "tagged_event", key, match, value });

/**
 * One entry per rule in docs/SENTRY_ALERT_RULES.md, in doc order, with the
 * doc's exact name. `triggers` are OR'ed (the doc's "new issue OR regresses");
 * `frequency` and every filter in `all` must hold; at least one of `anyOf`
 * must hold when it is non-empty (the doc's "contains any of").
 */
export const RULES = [
  {
    doc: "Rule 1",
    name: "P0 schema drift — column missing",
    tier: "P0",
    triggers: ["first_seen_event", "regression_event"],
    frequency: null,
    all: [message("co", "does not exist"), message("nc", "relation")],
    anyOf: [],
  },
  {
    doc: "Rule 2",
    name: "P0 — notifications.type CHECK violation",
    tier: "P0",
    triggers: ["first_seen_event"],
    frequency: null,
    all: [message("co", "notifications_type_check")],
    anyOf: [],
  },
  {
    doc: "Rule 3",
    name: "P0 — invalid job state transition",
    tier: "P0",
    triggers: ["first_seen_event"],
    frequency: null,
    all: [message("co", "Invalid job status transition")],
    anyOf: [],
  },
  {
    doc: "Rule 4",
    name: "P0 — payout sent but ledger missing",
    tier: "P0",
    triggers: ["first_seen_event"],
    frequency: null,
    all: [message("co", "transfer sent but ledger write failed")],
    anyOf: [],
  },
  {
    doc: "Rule 5",
    name: "P0 — chat push notification trigger failed",
    tier: "P0",
    triggers: ["first_seen_event"],
    frequency: null,
    all: [message("co", "send-push-notification")],
    anyOf: [message("co", "failed"), message("co", "error"), message("co", "timeout"), message("co", "non-2xx")],
  },
  {
    doc: "Rule 6",
    name: "P1 — edge function 5xx burst",
    tier: "P1",
    triggers: [],
    frequency: { value: 5, interval: "1h" },
    all: [],
    anyOf: [
      tag("source", "eq", "stripe-webhook"),
      tag("source", "eq", "stripe-connect"),
      tag("source", "eq", "release-payout"),
      tag("source", "eq", "send-push-notification"),
      tag("source", "eq", "process-email-queue"),
      tag("source", "eq", "complete-signup"),
    ],
  },
  {
    doc: "Rule 7",
    name: "P1 — Stripe Connect onboarding errors",
    tier: "P1",
    triggers: [],
    frequency: { value: 3, interval: "15m" },
    all: [],
    anyOf: [
      message("co", "stripe-connect"),
      message("co", "Failed to start onboarding"),
      message("co", "Failed to complete onboarding"),
      message("co", "account_link expired"),
    ],
  },
  {
    doc: "Rule 8",
    name: "WARN — Stripe webhook signature mismatch",
    tier: "P2",
    triggers: ["first_seen_event"],
    frequency: null,
    all: [],
    anyOf: [message("co", "Stripe webhook signature failed"), message("co", "STRIPE_WEBHOOK_SECRET is not configured")],
  },
  {
    doc: "Rule 9",
    name: "WARN — rate limit triggered",
    tier: "P2",
    triggers: [],
    frequency: { value: 20, interval: "1h" },
    all: [message("co", "Rate limit exceeded")],
    anyOf: [],
  },
];

/**
 * A filter as a workflow data condition. Shapes ("Event Attribute", "Tagged
 * Event") from https://docs.sentry.io/api/monitors/create-an-alert-for-an-organization/
 */
export function filterCondition(f) {
  if (f.kind === "event_attribute") {
    return { type: "event_attribute", comparison: { match: f.match, value: f.value, attribute: f.attribute }, conditionResult: true };
  }
  if (f.kind === "tagged_event") {
    return { type: "tagged_event", comparison: { key: f.key, match: f.match, value: f.value }, conditionResult: true };
  }
  throw new Error(`unknown filter kind ${f.kind}`);
}

/**
 * "Number of Events": the issue is seen more than `value` times in `interval`.
 * Shape from https://docs.sentry.io/api/monitors/create-an-alert-for-an-organization/
 */
export function frequencyCondition(freq) {
  return { type: "event_frequency_count", comparison: { value: freq.value, interval: freq.interval }, conditionResult: true };
}

/**
 * The email action: Suggested Assignees, falling back to Active Members.
 * Shape ("Notify on Preferred Channel", second example) from
 * https://docs.sentry.io/api/monitors/create-an-alert-for-an-organization/
 */
export function emailAction() {
  return {
    type: "email",
    integrationId: null,
    data: { fallthroughType: "ActiveMembers" },
    config: { targetType: "issue_owners", targetDisplay: null, targetIdentifier: "" },
    status: "active",
  };
}

/**
 * The action filters ("if" groups) for a rule. Each group carries the same
 * email action; Sentry fires a deduplicated set of actions
 * (getsentry/sentry src/sentry/workflow_engine/processors/action.py
 * get_unique_active_actions), so several passing groups send one email.
 *   no anyOf            -> one "all" group: frequency + all
 *   anyOf, nothing else -> one "any-short" group of the anyOf filters
 *   anyOf + common      -> one "all" group per anyOf filter: common + that filter,
 *                          which is exactly common AND (f1 OR f2 OR ...).
 * logicType values: https://docs.sentry.io/api/monitors/create-an-alert-for-an-organization/
 */
export function actionFilters(rule) {
  const common = [...(rule.frequency ? [frequencyCondition(rule.frequency)] : []), ...rule.all.map(filterCondition)];
  if (rule.anyOf.length === 0) return [{ logicType: "all", conditions: common, actions: [emailAction()] }];
  if (common.length === 0) {
    return [{ logicType: "any-short", conditions: rule.anyOf.map(filterCondition), actions: [emailAction()] }];
  }
  return rule.anyOf.map((f) => ({ logicType: "all", conditions: [...common, filterCondition(f)], actions: [emailAction()] }));
}

/**
 * The create/update body for one rule. Top-level shape from
 * https://docs.sentry.io/api/monitors/create-an-alert-for-an-organization/
 * (name, enabled, environment, config.frequency, triggers, actionFilters,
 * detectorIds). Triggers with no conditions run on every event: the docs'
 * Fetch Alerts example "Notify team #example-team" is exactly an empty trigger
 * group plus an event_frequency_count filter, and the server treats an empty
 * group as true (processors/data_condition_group.py).
 */
export function buildPayload(rule, { detectorId }) {
  if (detectorId === undefined || detectorId === null || detectorId === "") throw new Error("buildPayload needs the project's issue_stream monitor id");
  return {
    name: rule.name,
    enabled: true,
    environment: ENVIRONMENT,
    config: { frequency: FREQUENCY_MINUTES[rule.tier] },
    detectorIds: [Number(detectorId)],
    triggers: {
      logicType: "any-short",
      conditions: rule.triggers.map((type) => ({ type, comparison: true, conditionResult: true })),
    },
    actionFilters: actionFilters(rule),
  };
}

const sortKeys = (v) => {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
  return v;
};
const stable = (v) => JSON.stringify(sortKeys(v));

function normalizeCondition(c) {
  const cmp = c.comparison;
  if (c.type === "event_frequency_count") return { type: c.type, comparison: { value: Number(cmp?.value), interval: cmp?.interval } };
  if (c.type === "event_attribute") return { type: c.type, comparison: { attribute: cmp?.attribute, match: cmp?.match, value: cmp?.value ?? null } };
  if (c.type === "tagged_event") return { type: c.type, comparison: { key: cmp?.key, match: cmp?.match, value: cmp?.value ?? null } };
  return { type: c.type, comparison: cmp ?? null };
}

function normalizeAction(a) {
  return { type: a?.type, targetType: a?.config?.targetType ?? null, fallthroughType: a?.data?.fallthroughType ?? null };
}

/**
 * The fields that decide what an alert does, from either a payload we built or
 * a workflow Sentry returned (response shape: Fetch Alerts,
 * https://docs.sentry.io/api/monitors/fetch-alerts/). Server-assigned ids,
 * dates, owner and lastTriggered are left out; condition and group order is not
 * significant.
 */
export function normalizeWorkflow(w) {
  const groups = (w.actionFilters ?? []).map((g) => ({
    logicType: g.logicType,
    conditions: (g.conditions ?? []).map(normalizeCondition).sort((a, b) => stable(a).localeCompare(stable(b))),
    actions: (g.actions ?? []).map(normalizeAction).sort((a, b) => stable(a).localeCompare(stable(b))),
  }));
  return {
    name: w.name,
    enabled: w.enabled !== false,
    environment: w.environment ?? null,
    frequency: w.config?.frequency ?? null,
    triggers: {
      logicType: w.triggers?.logicType ?? null,
      types: (w.triggers?.conditions ?? []).map((c) => c.type).sort(),
    },
    actionFilters: groups.sort((a, b) => stable(a).localeCompare(stable(b))),
    detectorIds: (w.detectorIds ?? []).map(String).sort(),
  };
}

/** The top-level fields on which `existing` differs from `desired` (both normalized). */
export function diffWorkflow(desired, existing) {
  const d = normalizeWorkflow(desired);
  const e = normalizeWorkflow(existing);
  return Object.keys(d).filter((k) => stable(d[k]) !== stable(e[k]));
}

/**
 * The idempotent plan: match desired payloads to existing alerts by EXACT name.
 * Missing -> create; present but drifted -> update (by id); identical -> skip.
 * Alerts not named here are never touched (and nothing is ever deleted). Two
 * existing alerts with one desired name is ambiguous, so it throws rather than
 * pick one.
 */
export function planRules(desiredPayloads, existingWorkflows) {
  const byName = new Map();
  for (const w of existingWorkflows) {
    const list = byName.get(w.name) ?? [];
    list.push(w);
    byName.set(w.name, list);
  }
  return desiredPayloads.map((payload) => {
    const matches = byName.get(payload.name) ?? [];
    if (matches.length > 1) {
      throw new Error(`${matches.length} Sentry alerts are named "${payload.name}" (ids ${matches.map((m) => m.id).join(", ")}); rename or remove the extra one by hand`);
    }
    if (matches.length === 0) return { action: "create", name: payload.name, payload, diffs: [] };
    const diffs = diffWorkflow(payload, matches[0]);
    return diffs.length === 0
      ? { action: "skip", name: payload.name, id: String(matches[0].id), payload, diffs }
      : { action: "update", name: payload.name, id: String(matches[0].id), payload, diffs };
  });
}

/**
 * The read-back proof: every desired alert exists exactly once by name, and its
 * name, environment, triggers, conditions, email action, frequency and monitor
 * match what was sent. Returns the failures (empty = proven).
 */
export function verifyReadback(desiredPayloads, workflowsAfter) {
  const failures = [];
  for (const payload of desiredPayloads) {
    const matches = workflowsAfter.filter((w) => w.name === payload.name);
    if (matches.length === 0) {
      failures.push(`${payload.name}: not found after the sync`);
      continue;
    }
    if (matches.length > 1) {
      failures.push(`${payload.name}: ${matches.length} alerts carry this name`);
      continue;
    }
    const diffs = diffWorkflow(payload, matches[0]);
    if (diffs.length > 0) failures.push(`${payload.name}: read back differs in ${diffs.join(", ")}`);
    const emails = (matches[0].actionFilters ?? []).flatMap((g) => g.actions ?? []).filter((a) => a.type === "email");
    if (emails.length === 0) failures.push(`${payload.name}: read back has no email action`);
  }
  return failures;
}

/**
 * The rule names docs/SENTRY_ALERT_RULES.md declares: every `**Name:** \`...\``
 * line under a `## Rule N:` heading.
 */
export function ruleNamesInDoc(markdown) {
  const names = [];
  let inRule = false;
  for (const line of markdown.split("\n")) {
    if (/^## /.test(line)) inRule = /^## Rule \d+:/.test(line);
    const m = inRule && line.match(/^\*\*Name:\*\*\s*`([^`]+)`/);
    if (m) names.push(m[1]);
  }
  return names;
}
