/**
 * Q238: the admin review queues had only ever been seen EMPTY.
 *
 * The Q165 report shot pending credentials, IDV review, exceptions, ban
 * review, fraud flags, support tickets, broadcasts and expired subscriptions
 * with nothing in them, so the one state each queue exists for (a row waiting
 * on an admin) had never rendered anywhere a test could see it. Each view here
 * is rendered with a populated fixture and must show that row, and must not
 * fall back to its empty or error state.
 *
 * The data layer is a table-keyed stub (every query on a table answers with
 * that table's fixture rows): this proves the RENDER path for a populated
 * queue, not the live queries. Every fixture value that a CHECK constraint
 * governs is a legal one (fixtureSchemaContract.test.ts reads this file).
 *
 * @mutate src/components/admin/AdminCredentialQueue.tsx | fetcher: async () => (unwrap(await supabase.rpc("get_pending_credentials")) ?? []) as PendingRow[], | fetcher: async () => [] as PendingRow[],
 * @mutate src/components/admin/AdminBanReview.tsx | .eq("action_taken", "pending_ban_review") | .eq("action_taken", "pending_ban_review").limit(0)
 */
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ComponentType } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  tables: {} as Record<string, unknown[]>,
  rpc: {} as Record<string, unknown[]>,
}));

vi.mock("@/integrations/supabase/client", () => {
  const CHAIN = ["select", "eq", "neq", "in", "is", "not", "or", "order", "gte", "lte", "gt", "lt", "ilike", "match", "filter", "contains", "range"];
  const builder = (rows: unknown[]) => {
    let limit: number | null = null;
    const b: Record<string, unknown> = {};
    for (const m of CHAIN) b[m] = () => b;
    b.limit = (n: number) => { limit = n; return b; };
    const out = () => (limit === null ? rows : rows.slice(0, limit));
    b.maybeSingle = async () => ({ data: out()[0] ?? null, error: null });
    b.single = async () => ({ data: out()[0] ?? null, error: null });
    b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve({ data: out(), error: null, count: out().length }).then(res, rej);
    return b;
  };
  return {
    supabase: {
      from: (t: string) => builder(db.tables[t] ?? []),
      rpc: async (name: string) => ({ data: db.rpc[name] ?? [], error: null }),
      functions: { invoke: async () => ({ data: {}, error: null }) },
      storage: {
        from: () => ({
          createSignedUrl: async () => ({ data: { signedUrl: "https://example.test/doc.pdf" }, error: null }),
          createSignedUrls: async () => ({ data: [], error: null }),
        }),
      },
      auth: {
        getUser: async () => ({ data: { user: { id: "admin-1" } }, error: null }),
        getSession: async () => ({ data: { session: null }, error: null }),
      },
      channel: () => {
        const ch = { on: () => ch, subscribe: () => ch };
        return ch;
      },
      removeChannel: () => undefined,
    },
  };
});
vi.mock("@/components/UserAvatar", () => ({ default: () => null, UserAvatar: () => null }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));

import AdminCredentialQueue from "@/components/admin/AdminCredentialQueue";
import AdminIDVReview from "@/components/admin/AdminIDVReview";
import AdminExceptionQueue from "@/components/admin/AdminExceptionQueue";
import AdminBanReview from "@/components/admin/AdminBanReview";
import AdminFraudDashboard from "@/components/admin/AdminFraudDashboard";
import AdminSupport from "@/components/admin/AdminSupport";
import AdminBroadcasts from "@/components/admin/AdminBroadcasts";
import AdminSubscriptions from "@/components/admin/AdminSubscriptions";

const PERSON = { user_id: "u-1", full_name: "Clementine Arceneaux", email: "clem@example.com" };
const PAST = "2026-09-01T12:00:00Z";
const FUTURE = "2099-01-01T00:00:00Z";

interface Case {
  view: string;
  Component: ComponentType;
  seed: () => void;
  /** Text only a populated row renders. */
  shows: RegExp;
  /** The view's own empty-state title. */
  empty: RegExp;
}

const CASES: Case[] = [
  {
    view: "pending credentials",
    Component: AdminCredentialQueue,
    seed: () => {
      db.rpc.get_pending_credentials = [{
        ...PERSON, avatar_url: null, license_url: "u-1/license.pdf", insurance_url: null,
        license_status: "pending", insurance_status: "none", is_licensed: true, is_insured: false,
        business_name: "Arceneaux Electric", submitted_at: PAST,
      }];
    },
    shows: /Clementine Arceneaux/,
    empty: /No pending credentials/,
  },
  {
    view: "IDV review",
    Component: AdminIDVReview,
    seed: () => {
      db.tables.profiles = [{
        ...PERSON, idv_status: "manual_review", idv_session_id: "vs_test_123", idv_attempt_count: 2,
        idv_attempted_at: PAST, idv_failure_reason: "document_unverified_other", created_at: PAST,
      }];
    },
    shows: /Clementine Arceneaux/,
    empty: /Nobody is waiting on a human/,
  },
  {
    view: "verification exceptions",
    Component: AdminExceptionQueue,
    seed: () => {
      db.tables.verification_exceptions = [{
        id: "ex-1", check_id: null, credential_id: null, user_id: "u-1", exception_type: "name_mismatch",
        notes: "License says C. Arceneaux", assigned_to: null, status: "open", resolution: null,
        created_at: PAST, resolved_at: null, helper_credentials: null,
      }];
      db.tables.profiles = [PERSON];
    },
    shows: /Clementine Arceneaux/,
    empty: /No open exceptions/,
  },
  {
    view: "ban review",
    Component: AdminBanReview,
    seed: () => {
      db.tables.user_violations = [{
        id: "v-1", user_id: "u-1", description: "Third no-show in 30 days",
        action_taken: "pending_ban_review", violation_type: "no_show", created_at: PAST,
      }];
      db.tables.profiles = [PERSON];
    },
    shows: /Clementine Arceneaux/,
    empty: /No accounts awaiting review/,
  },
  {
    view: "fraud flags",
    Component: AdminFraudDashboard,
    seed: () => {
      db.tables.fraud_flags = [{
        id: "f-1", user_id: "u-1", flag_type: "off_platform_contact", details: "Shared a phone number in chat",
        job_id: null, resolved: false, created_at: PAST,
      }];
      db.tables.profiles = [PERSON];
    },
    // formatName shortens the surname ("Clementine A.").
    shows: /Clementine A/,
    empty: /Nothing flagged/,
  },
  {
    view: "support tickets",
    Component: AdminSupport,
    seed: () => {
      db.rpc.admin_support_queue = [{
        id: "r-1", reporter_id: "u-1", reason: "payment_issue", description: "My payout has not arrived",
        status: "pending", created_at: PAST, priority_at: PAST, priority_support: false,
        reporter_name: PERSON.full_name, reporter_email: PERSON.email, support_tier: "free",
      }];
    },
    shows: /My payout has not arrived/,
    empty: /^No (\w+ )?(support )?tickets$/,
  },
  {
    view: "broadcasts",
    Component: AdminBroadcasts,
    seed: () => {
      db.tables.broadcast_messages = [{
        id: "b-1", title: "Hurricane prep week", message: "Storm-prep jobs are open in every parish.",
        type: "info", starts_at: PAST, expires_at: FUTURE, created_at: PAST,
        pending_push_fan_out_at: null, push_fanned_out_at: PAST,
      }];
    },
    shows: /Hurricane prep week/,
    empty: /Nothing scheduled/,
  },
  {
    view: "expired subscriptions",
    Component: AdminSubscriptions,
    seed: () => {
      db.tables.profiles = [{
        ...PERSON, subscription_tier: "pro", subscription_expires_at: PAST, is_seed: false,
      }];
    },
    shows: /Clementine Arceneaux/,
    empty: /No subscriptions found/,
  },
];

const renderView = (C: ComponentType) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <C />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe("Q238 every admin review queue renders POPULATED", () => {
  beforeEach(() => {
    db.tables = {};
    db.rpc = {};
  });

  it("covers the eight views Q238 named (floor)", () => {
    expect(CASES.length).toBeGreaterThanOrEqual(8);
  });

  for (const c of CASES) {
    it(`${c.view}: shows the waiting row, not the empty or error state`, async () => {
      c.seed();
      renderView(c.Component);
      expect((await screen.findAllByText(c.shows)).length).toBeGreaterThan(0);
      expect(screen.queryByText(c.empty)).toBeNull();
      expect(screen.queryByText(/couldn't load/i)).toBeNull();
    });
  }

  it("can fail: the same views with no rows show their empty state", async () => {
    for (const c of CASES) {
      db.tables = {};
      db.rpc = {};
      const { unmount } = renderView(c.Component);
      expect(await screen.findByText(c.empty)).toBeInTheDocument();
      unmount();
    }
  });
});
