/**
 * Audit 1c D3-6 (builder 75, 2026-10-30): a Helpr with no car read zero open deliveries, because Deliver's only
 * read (helpr_tasks_open_near) keeps just the tasks the caller's vehicle fits. helpr_tasks_open_count
 * (20261030044539) counts every open delivery by pickup area, so Deliver can say "3 deliveries are waiting" above
 * "Add your car".
 *
 * The count must stay the listing read minus ONLY the vehicle fit: every filter of open_near's WHERE (read from
 * its NEWEST definition, so a filter open_near gains later must be added here too) appears in the count's WHERE,
 * except helpr_task_vehicle_fits. Behaviour proof: src/test/pglite/helprTasksOpenCount.pglite.mjs (16 PASS x3
 * replays; NEW_MIGRATION=skip 15 FAIL; 6 mutants RED).
 *
 * @mutate supabase/migrations/20261031082821_helpr_open_count_and_windows_hide_backed_out.sql |      AND public.helpr_task_same_stripe_mode(v_uid, t.customer_id) |      AND true
 * @mutate supabase/migrations/20261031082821_helpr_open_count_and_windows_hide_backed_out.sql |      AND NOT public.are_users_blocked(v_uid, t.pickup_contact_id) |      AND true
 * @mutate supabase/migrations/20261031082821_helpr_open_count_and_windows_hide_backed_out.sql |   v_uid := public.helpr_task_assert_helpr();\n  RETURN QUERY\n  SELECT t.pickup_area |   v_uid := auth.uid();\n  RETURN QUERY\n  SELECT t.pickup_area
 * @mutate supabase/migrations/20261031082821_helpr_open_count_and_windows_hide_backed_out.sql |   SELECT t.pickup_area, count(*)::integer |   SELECT t.pickup_address, count(*)::integer
 * @mutate supabase/migrations/20261031082821_helpr_open_count_and_windows_hide_backed_out.sql |      AND NOT public.helpr_task_source_held(t.source_kind, t.source_id)\n   GROUP BY |      AND true\n   GROUP BY
 * @mutate supabase/migrations/20261031082821_helpr_open_count_and_windows_hide_backed_out.sql | e.task_id = t.id AND e.actor_id = v_uid AND e.task_event IN ('released', 'helpr_no_show') | e.task_id = t.id AND e.actor_id = v_uid AND e.task_event IN ('released')
 * @mutate src/components/declutter/DeclutterDeliveryViews.tsx |   const counts = useQuery({ queryKey: ["helpr-tasks", "open-count"], queryFn: fetchOpenCount, enabled: !!userId }); |   const counts = useQuery({ queryKey: ["helpr-tasks", "open-count"], queryFn: async () => null, enabled: !!userId });
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const REPO = resolve(__dirname, "..", "..");
const MIG = join(REPO, "supabase", "migrations");
const DEFS = effectiveDefs(MIG);
const flat = (name: string) => blankSqlComments(DEFS.get(name)?.stmt ?? "").replace(/\s+/g, " ");

/** The `AND`-separated filters of a body's first `FROM public.helpr_tasks t WHERE ...` (up to GROUP/ORDER/LIMIT). */
function filters(body: string): string[] {
  const m = /FROM public\.helpr_tasks t WHERE (.*?) (?:GROUP BY|ORDER BY|LIMIT)\b/.exec(body);
  return (m?.[1] ?? "").split(/ AND (?![^()]*\))/).map((s) => s.trim()).filter(Boolean);
}

describe("helpr_tasks_open_count is the listing read minus only the vehicle fit (audit 1c D3-6)", () => {
  const near = flat("helpr_tasks_open_near");
  const count = flat("helpr_tasks_open_count");

  it("reads the newest definitions (floor)", () => {
    expect(near).toContain("CREATE OR REPLACE FUNCTION public.helpr_tasks_open_near(");
    expect(count).toContain("CREATE OR REPLACE FUNCTION public.helpr_tasks_open_count(");
    expect(filters(near).length).toBeGreaterThan(6);
  });

  it("every filter of open_near's WHERE is in the count's, except the vehicle fit", () => {
    const nearF = filters(near);
    const countF = new Set(filters(count));
    const missing = nearF.filter((f) => !/helpr_task_vehicle_fits/.test(f) && !countF.has(f));
    expect(missing).toEqual([]);
    expect([...countF].filter((f) => /helpr_task_vehicle_fits/.test(f))).toEqual([]);
    expect(nearF.some((f) => /helpr_task_vehicle_fits/.test(f))).toBe(true);
  });

  it("the same gates first, and area words with a count only", () => {
    for (const body of [near, count]) {
      expect(body).toContain("PERFORM public.helpr_task_source_require_feature('declutter_delivery');");
      expect(body).toContain("v_uid := public.helpr_task_assert_helpr();");
    }
    expect(count).toMatch(/RETURNS TABLE\(pickup_area text, open_count integer\)/);
    expect(count).toMatch(/SELECT t\.pickup_area, count\(\*\)::integer FROM public\.helpr_tasks t/);
    expect(count).not.toMatch(/pickup_address|pickup_lat|pickup_lng|dropoff_/);
    const mig = blankSqlComments(readFileSync(join(MIG, "20261030044539_helpr_tasks_open_count.sql"), "utf8"));
    expect(mig).toContain("REVOKE ALL ON FUNCTION public.helpr_tasks_open_count() FROM PUBLIC, anon;");
    expect(mig).toContain("GRANT EXECUTE ON FUNCTION public.helpr_tasks_open_count() TO authenticated, service_role;");
  });

  it("Deliver reads it, and falls back to the listed deliveries before it is deployed", () => {
    const api = blankComments(readFileSync(join(REPO, "src/lib/helprTasks/api.ts"), "utf8"));
    expect(api).toContain('const res = await supabase.rpc("helpr_tasks_open_count");');
    expect(api).toContain('if (res.error && isMissingRpcNamed(res.error, "helpr_tasks_open_count")) return null;');
    const view = blankComments(readFileSync(join(REPO, "src/components/declutter/DeclutterDeliveryViews.tsx"), "utf8"));
    expect(view).toContain('const counts = useQuery({ queryKey: ["helpr-tasks", "open-count"], queryFn: fetchOpenCount, enabled: !!userId });');
    expect(view).toContain("const busyRows = counts.data ?? openList;");
  });
});
