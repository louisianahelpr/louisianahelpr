/**
 * A CREW MEMBER WHO NEVER CAME CAN BE REPORTED, AND THE REST OF THE CREW IS NOT HELD UP (JOBS-3,
 * owner 2026-10-31 ~9:35 PM: "crew members are paid individually once the poster confirms they worked; a no-show
 * member gets nothing + a strike; others are never held up").
 *
 * Before: a crew had no per-member no-show (report_helper_no_show refuses a crew), and the crew's roll-up
 * (rpc_group_member_mark_done) waits for every CONFIRMED member's Done, so one confirmed member who never came held
 * every other member's pay for ever.
 *
 * Server: rpc_poster_report_member_no_show (20261101031804), behaviour proven in
 * src/test/pglite/crewMemberNoShow.pglite.mjs (--before red 7/7). This file pins the newest definition's load-bearing
 * clauses, so a later restatement that drops one is red here, and the poster's "Didn't show" chip on the crew roster.
 *
 * @mutate supabase/migrations/20261101031804_crew_member_no_show.sql | IF v_job.customer_id IS DISTINCT FROM v_uid THEN | IF false THEN
 * @mutate supabase/migrations/20261101031804_crew_member_no_show.sql | WHERE job_id = _job_id AND violation_type = 'no_show' AND user_id = _member_id | WHERE false
 * @mutate supabase/migrations/20261101031804_crew_member_no_show.sql |   DELETE FROM public.group_job_helpers WHERE id = v_slot.id; |   PERFORM 1;
 * @mutate supabase/migrations/20261101031804_crew_member_no_show.sql | IF v_remaining = 0 AND v_done >= 1 | IF false AND v_remaining = 0 AND v_done >= 1
 * @mutate supabase/migrations/20261101031804_crew_member_no_show.sql | REVOKE ALL ON FUNCTION public.rpc_poster_report_member_no_show(uuid, uuid) FROM PUBLIC, anon; | REVOKE ALL ON FUNCTION public.rpc_poster_report_member_no_show(uuid, uuid) FROM PUBLIC;
 * @mutate src/components/GroupJobHelpers.tsx |     hasJobStarted(dateNeeded, startTime); |     true;
 * @mutate src/components/GroupJobHelpers.tsx |     !!h.helper_confirmed_at && |     true &&
 * @mutate src/components/GroupJobHelpers.tsx |               {noShowReportable(h) && ( |               {false && (
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { latestFunctionDefs } from "./helpers/rpcErrorInventory";
import { blankSqlComments } from "./helpers/blankNonCode";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }));
vi.mock("@/lib/haptics", () => ({ hapticSuccess: vi.fn(), hapticError: vi.fn(), hapticMedium: vi.fn() }));

const { GroupJobHelpers } = await import("@/components/GroupJobHelpers");

const ROOT = resolve(__dirname, "../..");
const MIGRATIONS = resolve(ROOT, "supabase/migrations");
const RPC = "rpc_poster_report_member_no_show";
const defs = latestFunctionDefs(MIGRATIONS);
const def = defs.get(RPC);
const body = (def?.body ?? "").replace(/\s+/g, " ");

describe("the server: the newest rpc_poster_report_member_no_show keeps every rule", () => {
  it("is defined", () => {
    expect(defs.size).toBeGreaterThan(500);
    expect(def, `${RPC} must be defined by a migration`).toBeDefined();
  });

  it.each([
    ["the poster only", "IF v_job.customer_id IS DISTINCT FROM v_uid THEN RAISE EXCEPTION 'not_authorized'"],
    ["after the start", "RAISE EXCEPTION 'job_not_started'"],
    ["once per member per job", "WHERE job_id = _job_id AND violation_type = 'no_show' AND user_id = _member_id ) THEN RAISE EXCEPTION 'already_reported'"],
    ["a confirmed member only", "IF v_slot.helper_confirmed_at IS NULL THEN RAISE EXCEPTION 'helper_never_accepted'"],
    ["never one who arrived", "IF v_slot.helper_arrived_at IS NOT NULL OR v_slot.poster_confirmed_arrival_at IS NOT NULL THEN RAISE EXCEPTION 'helper_already_arrived'"],
    ["the existing no-show strike", "public.apply_consequence_ladder( p_user => _member_id, p_violation_type => 'no_show'"],
    ["the spot closes", "DELETE FROM public.group_job_helpers WHERE id = v_slot.id;"],
    ["the member is told, with the job as the notice's subject", "'/jobs?job=' || _job_id::text, _job_id);"],
    ["the rest of the crew completes", "IF v_remaining = 0 AND v_done >= 1"],
  ])("%s", (_what, clause) => {
    expect(body).toContain(clause);
  });

  it("anon cannot call it", () => {
    const file = def ? blankSqlComments(readFileSync(resolve(MIGRATIONS, def.file), "utf8")) : "";
    expect(file).toContain(`REVOKE ALL ON FUNCTION public.${RPC}(uuid, uuid) FROM PUBLIC, anon;`);
  });
});

describe("the poster's crew roster offers \"Didn't show\"", () => {
  const NOW = new Date("2032-10-30T18:00:00Z"); // 1 PM in Louisiana
  beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW); });
  afterAll(() => { vi.useRealTimers(); });

  const member = (over: Record<string, unknown> = {}) => ({
    id: "s1", helper_id: "m1", status: "accepted", helperName: "Hallie",
    helper_confirmed_at: "2032-10-29T12:00:00Z", helper_on_the_way_at: null, helper_arrived_at: null,
    poster_confirmed_arrival_at: null, helper_completed_at: null, ...over,
  });
  const roster = (props: { startTime?: string; isOwner?: boolean; jobStatus?: string; h?: Record<string, unknown> }) =>
    render(
      <QueryClientProvider client={new QueryClient()}>
        <GroupJobHelpers jobId="j" helpersNeeded={2} isOwner={props.isOwner ?? true} jobStatus={props.jobStatus ?? "in_progress"}
          initialHelpers={[member(props.h)]} dateNeeded="2032-10-30" startTime={props.startTime ?? "09:00"} />
      </QueryClientProvider>,
    );
  const chip = () => screen.queryByRole("button", { name: /didn't show up/i });

  it("after the start, on a confirmed member who has not checked in", () => {
    roster({});
    expect(chip()).toBeInTheDocument();
  });
  it.each([
    ["before the start", { startTime: "15:00" }],
    ["to anyone but the poster", { isOwner: false }],
    ["on a member who checked in", { h: { helper_arrived_at: "2032-10-30T14:05:00Z" } }],
    ["on a member the poster confirmed on site", { h: { poster_confirmed_arrival_at: "2032-10-30T14:05:00Z" } }],
    ["on a member who finished", { h: { helper_completed_at: "2032-10-30T16:00:00Z" } }],
    ["on a spot never confirmed", { h: { helper_confirmed_at: null } }],
    ["on a finished job", { jobStatus: "completed" }],
  ])("never %s", (_w, props) => {
    roster(props as never);
    expect(chip()).not.toBeInTheDocument();
  });
});
