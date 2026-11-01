/**
 * A3-C20 (app audit 2026-10-29): a poster with 366 jobs still saw "Get your
 * first job" at the top of Home, because "new" meant only "never applied".
 * The first-job Home shows only to a member with no job history at all.
 */
import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const db = vi.hoisted(() => ({ applications: 0, jobs: 0 }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      const counted = { data: null, error: null, status: 200, count: table === "applications" ? db.applications : db.jobs };
      const chain = {
        select: () => chain,
        eq: () => (table === "notification_preferences" ? chain : Promise.resolve(counted)),
        or: () => Promise.resolve(counted),
        maybeSingle: () => Promise.resolve({ data: { job_matches: true, email_job_matches: true }, error: null, status: 200 }),
      };
      return chain;
    },
  },
}));

import { useFirstJobState } from "./FirstJobHome";

function stateFor(applications: number, jobs: number) {
  db.applications = applications;
  db.jobs = jobs;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return renderHook(() => useFirstJobState("me"), { wrapper });
}

describe("Get your first job shows only to a member with no job history", () => {
  const cases: [number, number, boolean][] = [
    [0, 0, true], // brand new
    [0, 366, false], // the audited long-time poster
    [0, 1, false], // hired on a direct offer, never applied
    [3, 0, false], // applied
  ];

  it("has cases", () => expect(cases.length).toBeGreaterThan(3));

  for (const [apps, jobs, want] of cases) {
    it(`${apps} applications, ${jobs} jobs -> ${want ? "shown" : "hidden"}`, async () => {
      const { result } = stateFor(apps, jobs);
      await waitFor(() => expect(result.current).not.toBeNull());
      expect(result.current!.isNew).toBe(want);
    });
  }
});

// @mutate src/pages/home/homeDashboard/FirstJobHome.tsx |     isNew: (appCount ?? 0) === 0 && (jobCount ?? 0) === 0, |     isNew: (appCount ?? 0) === 0,
