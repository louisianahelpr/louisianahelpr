/**
 * GUARD (Q2452; owner decision 2026-10-28): a Declutter delivery reaches a Helpr only when their
 * vehicle fits it, and every delivery needs a car.
 *
 * The rule lives in ONE function, helpr_task_vehicle_fits(p_user, p_size): no car, no delivery of any
 * size; large needs the truck; extra large the truck and a second person. This guard pins it, then
 * checks the CLASS, built from the migrations' own inventory: every function whose NEWEST
 * definition (effectiveDefs, any dollar-quote tag) tests a delivery for status 'open' (a function
 * reading public.helpr_tasks, or a trigger on public.helpr_tasks reading NEW) either calls
 * helpr_task_vehicle_fits or is named in EXEMPT with the reason no Helpr meets the task there. The
 * list is exact both ways, so a new path that lists, offers, suggests or hands a delivery to a
 * Helpr without the vehicle rule turns this red, and so does a stale exemption.
 *
 * Also pinned: the save refuses a change that leaves a held delivery no longer fitting
 * ('vehicle_in_use'); taking a delivery without a car says "Add your car under Your vehicle to take
 * deliveries." ('vehicle_needs_car'), and Deliver shows the same sentence; the save sends the car.
 * Backend proof (the REAL rule across all five paths, 3x replay, six planted defects each RED):
 * src/test/pglite/helprVehicleMatch.pglite.mjs.
 *
 * @mutate supabase/migrations/20261028012406_helpr_vehicle_needs_a_car.sql |        AND v.has_car\n |
 * @mutate supabase/migrations/20261028012406_helpr_vehicle_needs_a_car.sql |   IF EXISTS (SELECT 1 FROM public.helpr_tasks t\n              WHERE t.helpr_id = v_uid AND t.status IN ('accepted', 'picked_up') |   IF false AND EXISTS (SELECT 1 FROM public.helpr_tasks t\n              WHERE t.helpr_id = v_uid AND t.status IN ('accepted', 'picked_up')
 * @mutate supabase/migrations/20261031102758_helpr_backout_after_seller_move_is_free.sql |      RAISE EXCEPTION 'vehicle_needs_car' USING ERRCODE = '42501', |      RAISE EXCEPTION 'vehicle_too_small' USING ERRCODE = '42501',
 * @mutate supabase/migrations/20261028012406_helpr_vehicle_needs_a_car.sql |   p_has_car := p_has_car OR p_has_truck;\n |
 * @mutate supabase/migrations/20261028012406_helpr_vehicle_needs_a_car.sql |   PERFORM 1 FROM public.helpr_vehicles v WHERE v.user_id = v_uid FOR UPDATE;\n |
 * @mutate supabase/migrations/20261031102758_helpr_backout_after_seller_move_is_free.sql |   PERFORM 1 FROM public.helpr_vehicles v WHERE v.user_id = v_uid FOR SHARE;\n |
 * @mutate supabase/migrations/20261031102758_helpr_backout_after_seller_move_is_free.sql |        AND public.helpr_task_vehicle_fits(v_uid, x.size) |        AND true
 * @mutate supabase/migrations/20261027203030_helpr_go_online_for_deliveries.sql |        AND public.helpr_task_vehicle_fits(h.user_id, NEW.size)\n |        AND true\n
 * @mutate src/components/declutter/DeclutterDeliveryViews.tsx |   const noCar = vehicle.isSuccess && !vehicle.data?.has_car; |   const noCar = false;
 * @mutate src/components/declutter/DeliverVehicleForm.tsx | <Checkbox id={`helpr-truck-${userId}`} checked={hasTruck} | <input type="checkbox" id={`helpr-truck-${userId}`} checked={hasTruck}
 * @mutate src/lib/helprTasks/api.ts | { p_has_car: hasCar, p_has_truck: hasTruck, | { p_has_truck: hasTruck,
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { join, resolve } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const REPO = resolve(__dirname, "..", "..");
const MIG = join(REPO, "supabase", "migrations");
const DEFS = effectiveDefs(MIG);
const code = (name: string) => blankSqlComments(DEFS.get(name)?.stmt ?? "");
const flat = (name: string) => code(name).replace(/\s+/g, " ");

/** Functions a trigger on public.helpr_tasks runs (they read the task as NEW). */
const TRIGGER_FNS = new Set(
  [...readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort()
    .map((f) => blankSqlComments(readFileSync(join(MIG, f), "utf8"))).join("\n")
    .matchAll(/CREATE\s+TRIGGER\s+\w+\s+(?:BEFORE|AFTER)[^;]*?\s+ON\s+public\.helpr_tasks\s[^;]*?EXECUTE\s+(?:FUNCTION|PROCEDURE)\s+public\.(\w+)\s*\(/gi)]
    .map((m) => m[1]),
);

/** Every function whose newest definition tests a delivery for status 'open'. */
const OPEN_READERS = [...DEFS.keys()].filter((name) => {
  const c = code(name);
  const readsTasks = /public\.helpr_tasks\b/.test(c) || (TRIGGER_FNS.has(name) && /\bNEW\.status\b/.test(c));
  return readsTasks && /status\s*(?:=|<>)\s*'open'/.test(c);
}).sort();

// @two-way src/test/deliveryVehicleMatch.test.ts:EXEMPT names a function that no longer tests
/** Functions that test 'open' where NO Helpr is listed, offered, suggested or handed the task. */
const EXEMPT: Record<string, string> = {
  declutter_complete_handover: "its 'open' is a PROBLEM's status at a buyer and seller's handover; no Helpr is shown a delivery",
  declutter_admin_decide_problem: "its 'open' is a PROBLEM's status; an admin decides it, no Helpr is shown a delivery",
  declutter_admin_decide_delivery_damage: "its 'open' is a PROBLEM's status; an admin decides it, no Helpr is shown a delivery",
  declutter_delivery_raise_open: "whether the BUYER may raise an open delivery's pay; no Helpr is shown one",
  declutter_delivery_raise_paid: "a buyer's raise is paid onto the open task; offers stay with the readers above",
  declutter_report_helpr_no_show: "its 'open' is a PROBLEM's status; the seller reports the booked Helpr, no Helpr is shown a delivery",
  declutter_helpr_answer_no_show: "its 'open' is a PROBLEM's status; the booked Helpr answers a report, no Helpr is shown a delivery",
  helpr_task_source_held: "its 'open' is a PROBLEM's status (the money hold); no Helpr is shown a delivery",
  helpr_task_reopen: "puts a task back to open for the readers above; picks no Helpr",
  declutter_delivery_return_finish: "a re-post after a Helpr could not finish puts the task back to open for the readers above; picks no Helpr",
  declutter_admin_decide_stuck_delivery: "its 'open' is a PROBLEM's status; an admin decides a stuck delivery, no Helpr is shown a delivery",
  helpr_task_sweep: "the cron that closes unfilled tasks; picks no Helpr",
  helpr_tasks_open_count: "counts open deliveries by pickup area for a Helpr with no car yet (audit 1c D3-6); lists, offers, suggests and hands no task",
};

describe("Declutter delivery: only a Helpr whose vehicle fits meets the delivery (Q2452)", () => {
  it("the inventory read the paths", () => {
    expect(TRIGGER_FNS.has("helpr_task_offer_online")).toBe(true);
    expect(OPEN_READERS.length).toBeGreaterThan(10);
    for (const fn of ["helpr_tasks_open_near", "helpr_task_view", "helpr_task_accept", "helpr_route_suggestions", "helpr_task_offer_online"]) {
      expect(OPEN_READERS, fn).toContain(fn);
    }
  });

  it("every path that tests a delivery for 'open' applies the vehicle rule, or says why no Helpr meets it there (exact both ways)", () => {
    const missing = OPEN_READERS.filter((fn) => !code(fn).includes("helpr_task_vehicle_fits(") && !(fn in EXEMPT));
    expect(missing, "add public.helpr_task_vehicle_fits(<helpr>, <task>.size) to these, or an EXEMPT reason").toEqual([]);
    // Per task: each delivery a reader tests for 'open' (alias.status) is the one it checks the vehicle for
    // (alias.size), so a second candidate list in the same function cannot drop the rule unseen.
    const perAlias = OPEN_READERS.filter((fn) => !(fn in EXEMPT)).flatMap((fn) => {
      const c = code(fn);
      const aliases = [...new Set([...c.matchAll(/\b(\w+)\.status\s*(?:=|<>)\s*'open'/g)].map((m) => m[1]))];
      return aliases.filter((a) => !new RegExp(`helpr_task_vehicle_fits\\(\\s*[\\w.]+\\s*,\\s*${a}\\.size\\s*\\)`).test(c)).map((a) => `${fn}: ${a}`);
    });
    expect(perAlias, "a delivery tested for 'open' without helpr_task_vehicle_fits(<helpr>, <it>.size)").toEqual([]);
    const stale = Object.keys(EXEMPT).filter((fn) => !OPEN_READERS.includes(fn) || code(fn).includes("helpr_task_vehicle_fits("));
    expect(stale, "EXEMPT names a function that no longer tests 'open', or now applies the rule").toEqual([]);
  });

  it("the rule: no car, no delivery of any size; large needs the truck; extra large the truck and a second person", () => {
    const fits = flat("helpr_task_vehicle_fits");
    expect(fits).toContain("SELECT COALESCE(p_user IS NOT NULL AND EXISTS ( SELECT 1 FROM public.helpr_vehicles v WHERE v.user_id = p_user AND v.has_car AND (p_size = 'small' OR (p_size = 'large' AND v.has_truck) OR (p_size = 'xl' AND v.has_truck AND v.second_person))), false)");
    // A truck is a car: the table keeps it so, and the save sets it.
    const mig = blankSqlComments(readFileSync(join(MIG, DEFS.get("helpr_task_vehicle_fits")!.file), "utf8")).replace(/\s+/g, " ");
    expect(mig).toContain("ADD CONSTRAINT helpr_vehicles_truck_needs_car CHECK (NOT has_truck OR has_car)");
    expect(mig).toContain("UPDATE public.helpr_vehicles SET has_car = true WHERE has_truck AND NOT has_car;");
    expect(flat("helpr_set_vehicle")).toContain("p_has_car := p_has_car OR p_has_truck;");
  });

  it("the save refuses a change that leaves a held delivery no longer fitting", () => {
    const save = flat("helpr_set_vehicle");
    expect(save).toContain("IF EXISTS (SELECT 1 FROM public.helpr_tasks t WHERE t.helpr_id = v_uid AND t.status IN ('accepted', 'picked_up') AND NOT (p_has_car AND (t.size = 'small' OR (t.size = 'large' AND p_has_truck) OR (t.size = 'xl' AND p_has_truck AND p_second_person)))) THEN RAISE EXCEPTION 'vehicle_in_use'");
    // ...before anything is written.
    expect(save.indexOf("'vehicle_in_use'")).toBeLessThan(save.indexOf("INSERT INTO public.helpr_vehicles"));
    // A take and a save at the same moment cannot both pass (lh-authz-rls review nit 1): the save locks the
    // vehicle row before it reads the held deliveries, and the take holds it FOR SHARE across its vehicle check.
    const lock = save.indexOf("PERFORM 1 FROM public.helpr_vehicles v WHERE v.user_id = v_uid FOR UPDATE;");
    expect(lock).toBeGreaterThan(0);
    expect(lock).toBeLessThan(save.indexOf("t.status IN ('accepted', 'picked_up')"));
    const accept = flat("helpr_task_accept");
    const share = accept.indexOf("PERFORM 1 FROM public.helpr_vehicles v WHERE v.user_id = v_uid FOR SHARE;");
    expect(share).toBeGreaterThan(0);
    expect(share).toBeLessThan(accept.indexOf("IF NOT public.helpr_task_vehicle_fits(v_uid, t.size)"));
  });

  it("taking a delivery without a car says so plainly, and Deliver says the same", () => {
    const accept = flat("helpr_task_accept");
    expect(accept).toMatch(/IF NOT public\.helpr_task_vehicle_fits\(v_uid, t\.size\) THEN IF NOT EXISTS \(SELECT 1 FROM public\.helpr_vehicles v WHERE v\.user_id = v_uid AND v\.has_car\) THEN RAISE EXCEPTION 'vehicle_needs_car'/);
    const sentence = "Add your car under Your vehicle to take deliveries.";
    expect(accept).toContain(`HINT = '${sentence}'`);
    const copy = blankComments(readFileSync(join(REPO, "src/lib/helprTasks/errorCopy.ts"), "utf8"));
    expect(copy).toContain(`vehicle_needs_car: "${sentence}"`);
    expect(copy).toMatch(/vehicle_in_use: "You have a delivery that needs this vehicle\./);
    const view = blankComments(readFileSync(join(REPO, "src/components/declutter/DeclutterDeliveryViews.tsx"), "utf8"));
    expect(view).toContain("const noCar = vehicle.isSuccess && !vehicle.data?.has_car;");
    expect(view).toMatch(/\{noCar \? \(\s*<p[^>]*>Add your car under Your vehicle to take deliveries\.<\/p>/);
    // "Your vehicle" lives in its own file since audit DD D1 (DeliverVehicleForm.tsx), rendered by the view.
    expect(view).toContain('import { VehicleForm } from "./DeliverVehicleForm";');
    const form = blankComments(readFileSync(join(REPO, "src/components/declutter/DeliverVehicleForm.tsx"), "utf8"));
    expect(form).toContain("I have a car");
    // The shared Checkbox for every box on the card (lead 2026-10-28: a raw box rendered as an empty square at 375).
    expect(form).toMatch(/import \{ Checkbox \} from "@\/components\/ui\/checkbox";/);
    expect(form).not.toMatch(/<input type="checkbox"/);
    for (const box of ["car", "truck", "second"]) expect(form).toContain(`<Checkbox id={\`helpr-${box}-\${userId}\`}`);
  });

  it("the client saves the car answer through the four-argument save", () => {
    const api = blankComments(readFileSync(join(REPO, "src/lib/helprTasks/api.ts"), "utf8"));
    expect(api).toContain('supabase.rpc("helpr_set_vehicle", { p_has_car: hasCar, p_has_truck: hasTruck, p_second_person: secondPerson, p_photo_path: photoPath as string })');
    expect(api).toContain('select("has_car, has_truck, second_person, photo_path")');
  });
});
