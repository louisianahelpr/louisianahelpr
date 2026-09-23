/**
 * Analytics that silently stop (docs/OPEN.md Q72) — pure logic, no I/O.
 * scripts/check-analytics-freshness.mjs runs `freshnessSql()` against prod and
 * passes the rows to `evaluateFreshness`. Tested in
 * src/test/analyticsFreshness.test.ts, which also derives the list of events
 * the app emits from the `track(` call sites in src/ and holds KEY_EVENTS +
 * NOT_MONITORED + MISSING_MILESTONES equal to it, both ways.
 *
 * QUIET vs BROKEN. The app is pre-launch: a week with no real signup is the
 * truth, not a fault, so "zero events" alone can never be an alert. Each key
 * event is paired with the ROWS the same user action writes (its ground truth,
 * real users only: not is_seed). Per event, over its window:
 *
 *   ok          at least one event recorded.
 *   broken      zero events, but real users did the thing (ground truth >= 1):
 *               the app works and analytics lost it. Ledger error.
 *   degraded    events recorded but fewer than DEGRADED_RATIO of the real
 *               actions, once there are at least DEGRADED_MIN of them. Ledger
 *               warning.
 *   quiet       zero events and zero real actions: nobody did it. Reported,
 *               never alerted.
 *   unverified  zero events and the event has no ground truth to compare
 *               (payment_made, job_accepted: see each entry). Reported as
 *               "quiet, cannot tell broken" and never alerted.
 *   unreadable  the read failed: red run.
 *
 * Test traffic is shown beside real traffic (events from is_seed profiles;
 * rows with is_seed) but never decides a verdict: seeders write rows through
 * the API without the browser, so seed rows with no event prove nothing.
 */

export const DEGRADED_RATIO = 0.5;
export const DEGRADED_MIN = 10;

/**
 * The key product events. `ground` is SQL returning {real, test} counts of the
 * rows the same action writes since `$SINCE` (a timestamptz expression), or
 * null when there is no such row.
 */
export const KEY_EVENTS = [
  {
    event: "signup_completed",
    label: "signup",
    windowDays: 7,
    // Signup.tsx fires it on the EMAIL signup page only; social sign-in never
    // passes through it, so only email-provider accounts count.
    ground: `SELECT count(*) FILTER (WHERE NOT coalesce(p.is_seed, false)) AS real,
                    count(*) FILTER (WHERE p.is_seed) AS test
               FROM auth.users u LEFT JOIN public.profiles p ON p.user_id = u.id
              WHERE u.created_at > $SINCE AND u.raw_app_meta_data->>'provider' = 'email'`,
  },
  {
    event: "job_posted",
    label: "job posted",
    windowDays: 7,
    // Recurring children and auto-created jobs are written server-side, never
    // through the post flow (useJobSubmit), so they are not ground truth.
    ground: `SELECT count(*) FILTER (WHERE NOT j.is_seed) AS real, count(*) FILTER (WHERE j.is_seed) AS test
               FROM public.jobs j
              WHERE j.created_at > $SINCE AND NOT coalesce(j.is_auto_created, false) AND j.parent_job_id IS NULL`,
  },
  {
    event: "job_applied",
    label: "applied",
    windowDays: 7,
    // useApplyFlow is the insert that fires it. respond_to_direct_offer inserts
    // an application for the OFFERED helper server-side with no event, so
    // those rows are excluded.
    ground: `SELECT count(*) FILTER (WHERE NOT j.is_seed AND NOT coalesce(hp.is_seed, false)) AS real,
                    count(*) FILTER (WHERE j.is_seed OR hp.is_seed) AS test
               FROM public.applications a
               JOIN public.jobs j ON j.id = a.job_id
               LEFT JOIN public.profiles hp ON hp.user_id = a.helper_id
              WHERE a.created_at > $SINCE AND j.offered_to_helper_id IS DISTINCT FROM a.helper_id`,
  },
  {
    event: "job_accepted",
    label: "hired (helper accepted)",
    windowDays: 7,
    // No usable ground truth: helper_confirmed_at is also stamped server-side,
    // with no event, by instant_book_claim, respond_to_direct_offer and the
    // group roster (migrations 20260804120000, 20260820000000,
    // 20260919192559), and no column tells those hires apart from an
    // offer accepted in useOfferHandlers. Comparing against it would call a
    // quiet week of instant-book hires BROKEN.
    ground: null,
  },
  {
    event: "payment_made",
    label: "paid",
    windowDays: 7,
    // jobs has payment_status but no paid-at timestamp, so "paid in the
    // window" cannot be counted without guessing from updated_at.
    ground: null,
  },
  {
    event: "job_completed",
    label: "completed",
    windowDays: 7,
    // Emitted by src/lib/jobCompletedEvent.ts when a create-payment release
    // answers bothDone (Activity confirm, the tracker's Done after the poster
    // approved, closing a dispute). Ground truth is only the completions that
    // path makes: both parties stamped, no dispute, single-Helpr. The 24h
    // auto-release sweep leaves poster_completed_at null, and dispute
    // decisions/quick release set dispute_status, so neither counts (they
    // complete with no client, so no event). dispute_status is NULL on a job
    // never disputed (its 'open' default was dropped and backfilled,
    // 20260823200000). jobs.completed_at is stamped by
    // zz_jobs_stamp_completed_at (20260914201350) on entering completed.
    ground: `SELECT count(*) FILTER (WHERE NOT j.is_seed AND NOT coalesce(cp.is_seed, false) AND NOT coalesce(hp.is_seed, false)) AS real,
                    count(*) FILTER (WHERE j.is_seed OR cp.is_seed OR hp.is_seed) AS test
               FROM public.jobs j
               LEFT JOIN public.profiles cp ON cp.user_id = j.customer_id
               LEFT JOIN public.profiles hp ON hp.user_id = j.helper_id
              WHERE j.status = 'completed' AND j.completed_at > $SINCE
                AND j.poster_completed_at IS NOT NULL AND j.helper_completed_at IS NOT NULL
                AND j.dispute_status IS NULL AND NOT coalesce(j.is_group_job, false)`,
  },
  {
    event: "review_left",
    label: "reviewed",
    windowDays: 7,
    ground: `SELECT count(*) FILTER (WHERE NOT coalesce(rp.is_seed, false) AND NOT j.is_seed) AS real,
                    count(*) FILTER (WHERE rp.is_seed OR j.is_seed) AS test
               FROM public.reviews r
               JOIN public.jobs j ON j.id = r.job_id
               LEFT JOIN public.profiles rp ON rp.user_id = r.reviewer_id
              WHERE r.created_at > $SINCE`,
  },
  {
    event: "message_sent",
    label: "message sent",
    windowDays: 7,
    // Q283. sendHandlers.ts fires it once per stored message. Only that path
    // stamps client_id, which separates it from server-written rows
    // (is_system notices and any edge insert). client_id exists since
    // 20260923181707 (0 of 402 rows had one on 2026-09-23: no message had been
    // sent since), so a window reaching before it undercounts, never overcounts.
    ground: `SELECT count(*) FILTER (WHERE NOT coalesce(sp.is_seed, false)) AS real,
                    count(*) FILTER (WHERE sp.is_seed) AS test
               FROM public.messages m
               LEFT JOIN public.profiles sp ON sp.user_id = m.sender_id
              WHERE m.created_at > $SINCE AND NOT coalesce(m.is_system, false) AND m.client_id IS NOT NULL`,
  },
];

/**
 * Product milestones the owner named that NO `track(` call emits today. The
 * guard fails the day one of these gains a call site, so it moves to
 * KEY_EVENTS instead of staying unmonitored.
 */
export const MISSING_MILESTONES = {
  // Empty since Q222 (2026-09-23): job_completed is emitted and monitored.
};

/**
 * Every other event the app emits, with why it is not a key product event.
 * Held equal to the source both ways by the guard.
 */
export const NOT_MONITORED = {
  signup_started: "funnel step before signup_completed; signup_completed is the monitored outcome",
  signup_step_completed: "funnel step before signup_completed",
  signup_step_validation_failed: "friction signal; zero is the good case",
  email_verified: "follows signup_completed; covered by it",
  first_job_posted: "first-time variant of job_posted, which is monitored",
  first_job_application_sent: "first-time variant of job_applied",
  first_job_accepted: "first-time variant of job_accepted",
  first_review_left: "first-time variant of review_left",
  first_job_completed: "first-time variant of job_completed",
  first_helper_hired: "poster's first-time hire; the hire itself is monitored through job_accepted (the Helpr's acceptance)",
  first_five_star_review: "subset of review_left",
  first_payment_collected: "first-time variant; payment_made is the monitored payment event",
  payout_setup_started: "onboarding step, not a core-loop action",
  payout_setup_completed: "onboarding step, not a core-loop action",
  app_opened_from_push: "native-only engagement signal; zero is normal on web",
  app_opened_from_deep_link: "engagement signal; zero is normal",
  push_received_foreground: "native-only engagement signal",
  permission_denied: "friction signal; zero is the good case",
  permission_skipped_guest: "friction signal; zero is the good case",
  forced_logout_bounce: "error signal; zero is the good case (Sentry watches it)",
  push_token_saved: "native push plumbing; push-tokens-empty ledger item covers it",
  push_token_save_failed: "error signal; zero is the good case",
  nps_prompt_shown: "survey plumbing, not a core-loop action",
  nps_prompt_dismissed: "survey plumbing",
  nps_submitted: "survey plumbing",
  post_job_entry_choice: "UI choice inside the post flow; job_posted is the outcome",
  sample_job_template_selected: "UI choice inside the post flow",
  unpaid_draft_resume: "recovery path inside the post flow",
  application_withdraw_reason: "optional survey on withdrawing",
};

const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

/** One read-only statement: one row per key event. */
export function freshnessSql(events = KEY_EVENTS) {
  return events
    .map((k) => {
      const since = `(now() - interval '${Math.trunc(k.windowDays)} days')`;
      const ground = k.ground ? k.ground.replaceAll("$SINCE", since) : null;
      return `SELECT ${lit(k.event)} AS event, ${Math.trunc(k.windowDays)} AS window_days,
  (SELECT count(*) FROM public.analytics_events e WHERE e.event = ${lit(k.event)} AND e.created_at > ${since})::int AS events,
  (SELECT count(*) FROM public.analytics_events e JOIN public.profiles p ON p.user_id = e.user_id
    WHERE e.event = ${lit(k.event)} AND e.created_at > ${since} AND p.is_seed)::int AS test_events,
  (SELECT max(e.created_at) FROM public.analytics_events e WHERE e.event = ${lit(k.event)}) AS last_event_at,
  ${ground ? `(SELECT g.real FROM (${ground}) g)::int` : "NULL::int"} AS real_actions,
  ${ground ? `(SELECT g.test FROM (${ground}) g)::int` : "NULL::int"} AS test_actions`;
    })
    .join("\nUNION ALL\n");
}

const n = (v) => (v === null || v === undefined || v === "" ? null : Number(v));

/**
 * The verdict for one event. `row` is the SQL row (or undefined when missing).
 * @returns {"ok"|"degraded"|"broken"|"quiet"|"unverified"|"unreadable"}
 */
export function classify(row, hasGround, { ratio = DEGRADED_RATIO, min = DEGRADED_MIN } = {}) {
  if (!row) return "unreadable";
  const events = n(row.events);
  if (events === null || !Number.isFinite(events) || events < 0) return "unreadable";
  const real = n(row.real_actions);
  if (hasGround && (real === null || !Number.isFinite(real) || real < 0)) return "unreadable";
  if (events === 0) {
    if (!hasGround) return "unverified";
    return real >= 1 ? "broken" : "quiet";
  }
  if (hasGround && real >= min && events < real * ratio) return "degraded";
  return "ok";
}

export function evaluateFreshness(rows, events = KEY_EVENTS) {
  const byEvent = new Map((Array.isArray(rows) ? rows : []).map((r) => [r.event, r]));
  const results = events.map((k) => {
    const row = byEvent.get(k.event);
    return { k, row, status: classify(row, k.ground !== null) };
  });
  const alerts = results.filter((r) => r.status === "broken" || r.status === "degraded");
  const unreadable = results.filter((r) => r.status === "unreadable");
  const count = (s) => results.filter((r) => r.status === s).length;
  const summary = [
    unreadable.length ? `UNREADABLE ${unreadable.length}` : null,
    count("broken") ? `BROKEN ${count("broken")}: ${results.filter((r) => r.status === "broken").map((r) => r.k.event).join(", ")}` : null,
    count("degraded") ? `DEGRADED ${count("degraded")}` : null,
    `${count("ok")} ok`,
    `${count("quiet") + count("unverified")} quiet (nobody did it${count("unverified") ? `; ${count("unverified")} cannot be told from broken` : ""})`,
  ].filter(Boolean).join("; ");
  const cell = (v) => (v === null || v === undefined ? "—" : String(v));
  const report = [
    "## Analytics freshness (Q72)",
    "",
    `**${summary}**`,
    "",
    "Real = not is_seed. Pre-launch, QUIET (no event, no real action) is expected and never alerts; BROKEN (real actions, zero events) does.",
    "",
    "| Event | Milestone | Window | Events | of which test | Real actions | Test actions | Last event | Status |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...results.map(({ k, row, status }) =>
      `| \`${k.event}\` | ${k.label} | ${k.windowDays}d | ${cell(row?.events)} | ${cell(row?.test_events)} | ` +
      `${k.ground ? cell(row?.real_actions) : "no ground truth"} | ${k.ground ? cell(row?.test_actions) : "—"} | ${cell(row?.last_event_at)} | **${status.toUpperCase()}** |`),
    ...(Object.keys(MISSING_MILESTONES).length
      ? ["", `Not monitored because no event exists: ${Object.keys(MISSING_MILESTONES).map((e) => `\`${e}\``).join(", ")} (see scripts/lib/analyticsFreshness.mjs).`]
      : []),
  ].join("\n");
  return { results, alerts, unreadable, summary, report };
}

export const alertTitle = (r) => `Analytics: ${r.k.event} ${r.status === "broken" ? "stopped recording (real users acted, zero events)" : "records under half of real actions"}`;
