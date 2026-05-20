import { describe, it, expect, beforeEach } from "vitest";

import {
  HELPER_MILESTONES,
  detectReachedMilestones,
  hasCelebrated,
  markCelebrated,
  milestoneStorageKey,
  selectNewMilestones,
  type HelperMilestoneId,
  type MilestoneStorage,
} from "./helperMilestones";

/** In-memory storage gate for tests — same shape as safeStorage. */
function makeStorage(): MilestoneStorage & { dump: () => Record<string, string> } {
  const data: Record<string, string> = {};
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = v;
    },
    dump: () => ({ ...data }),
  };
}

describe("milestoneStorageKey", () => {
  it("namespaces by helperId so two accounts on one device do not collide", () => {
    const a = milestoneStorageKey("helper-a", "first_job");
    const b = milestoneStorageKey("helper-b", "first_job");
    expect(a).not.toBe(b);
    expect(a.startsWith("helpr_milestone_")).toBe(true);
    expect(b.startsWith("helpr_milestone_")).toBe(true);
  });
});

describe("detectReachedMilestones — completed-job boundaries", () => {
  const earningsAndStreak = { totalEarningsDollars: 0, fiveStarStreak: 0 };

  it("returns nothing at 0 completed jobs", () => {
    expect(
      detectReachedMilestones({ completedJobCount: 0, ...earningsAndStreak }),
    ).toEqual([]);
  });

  it("fires first_job at exactly 1 completed job", () => {
    expect(
      detectReachedMilestones({ completedJobCount: 1, ...earningsAndStreak }),
    ).toEqual(["first_job"]);
  });

  it("does NOT fire five_jobs at 4 completed jobs", () => {
    expect(
      detectReachedMilestones({ completedJobCount: 4, ...earningsAndStreak }),
    ).toEqual(["first_job"]);
  });

  it("fires first_job + five_jobs at exactly 5", () => {
    expect(
      detectReachedMilestones({ completedJobCount: 5, ...earningsAndStreak }),
    ).toEqual(["first_job", "five_jobs"]);
  });

  it("does NOT fire ten_jobs at 9", () => {
    expect(
      detectReachedMilestones({ completedJobCount: 9, ...earningsAndStreak }),
    ).toEqual(["first_job", "five_jobs"]);
  });

  it("fires ten_jobs at exactly 10", () => {
    expect(
      detectReachedMilestones({ completedJobCount: 10, ...earningsAndStreak }),
    ).toEqual(["first_job", "five_jobs", "ten_jobs"]);
  });

  it("does NOT fire twenty_five_jobs at 24", () => {
    expect(
      detectReachedMilestones({ completedJobCount: 24, ...earningsAndStreak }),
    ).toEqual(["first_job", "five_jobs", "ten_jobs"]);
  });

  it("fires twenty_five_jobs at exactly 25", () => {
    expect(
      detectReachedMilestones({ completedJobCount: 25, ...earningsAndStreak }),
    ).toEqual(["first_job", "five_jobs", "ten_jobs", "twenty_five_jobs"]);
  });
});

describe("detectReachedMilestones — earnings boundary", () => {
  it("does NOT fire first_1k_earnings at $999.99", () => {
    expect(
      detectReachedMilestones({
        completedJobCount: 0,
        totalEarningsDollars: 999.99,
        fiveStarStreak: 0,
      }),
    ).toEqual([]);
  });

  it("fires first_1k_earnings at exactly $1000", () => {
    expect(
      detectReachedMilestones({
        completedJobCount: 0,
        totalEarningsDollars: 1000,
        fiveStarStreak: 0,
      }),
    ).toEqual(["first_1k_earnings"]);
  });

  it("fires first_1k_earnings well past the threshold (e.g. $5,231.40)", () => {
    expect(
      detectReachedMilestones({
        completedJobCount: 0,
        totalEarningsDollars: 5231.4,
        fiveStarStreak: 0,
      }),
    ).toEqual(["first_1k_earnings"]);
  });
});

describe("detectReachedMilestones — five-star streak boundary", () => {
  const noJobsOrEarnings = { completedJobCount: 0, totalEarningsDollars: 0 };

  it("does NOT fire first_five_star_streak_of_5 at streak of 4", () => {
    expect(
      detectReachedMilestones({ ...noJobsOrEarnings, fiveStarStreak: 4 }),
    ).toEqual([]);
  });

  it("fires first_five_star_streak_of_5 at streak of exactly 5", () => {
    expect(
      detectReachedMilestones({ ...noJobsOrEarnings, fiveStarStreak: 5 }),
    ).toEqual(["first_five_star_streak_of_5"]);
  });

  it("still fires at a larger streak (e.g. 20)", () => {
    expect(
      detectReachedMilestones({ ...noJobsOrEarnings, fiveStarStreak: 20 }),
    ).toEqual(["first_five_star_streak_of_5"]);
  });
});

describe("detectReachedMilestones — all milestones at once", () => {
  it("returns every milestone for a power helper", () => {
    expect(
      detectReachedMilestones({
        completedJobCount: 100,
        totalEarningsDollars: 50_000,
        fiveStarStreak: 30,
      }),
    ).toEqual([
      "first_job",
      "five_jobs",
      "ten_jobs",
      "twenty_five_jobs",
      "first_1k_earnings",
      "first_five_star_streak_of_5",
    ]);
  });
});

describe("hasCelebrated / markCelebrated", () => {
  let storage: ReturnType<typeof makeStorage>;
  beforeEach(() => {
    storage = makeStorage();
  });

  it("returns false before any celebration is marked", () => {
    expect(hasCelebrated(storage, "helper-1", "first_job")).toBe(false);
  });

  it("returns true after marking", () => {
    markCelebrated(storage, "helper-1", "first_job");
    expect(hasCelebrated(storage, "helper-1", "first_job")).toBe(true);
  });

  it("scope is per-helper", () => {
    markCelebrated(storage, "helper-1", "first_job");
    expect(hasCelebrated(storage, "helper-2", "first_job")).toBe(false);
  });

  it("scope is per-milestone", () => {
    markCelebrated(storage, "helper-1", "first_job");
    expect(hasCelebrated(storage, "helper-1", "five_jobs")).toBe(false);
  });

  it("is idempotent — marking twice still reads as celebrated", () => {
    markCelebrated(storage, "helper-1", "first_job");
    markCelebrated(storage, "helper-1", "first_job");
    expect(hasCelebrated(storage, "helper-1", "first_job")).toBe(true);
  });
});

describe("selectNewMilestones", () => {
  let storage: ReturnType<typeof makeStorage>;
  beforeEach(() => {
    storage = makeStorage();
  });

  it("returns nothing when helperId is empty (avoids cross-account leakage)", () => {
    expect(
      selectNewMilestones(storage, "", {
        completedJobCount: 100,
        totalEarningsDollars: 5000,
        fiveStarStreak: 10,
      }),
    ).toEqual([]);
  });

  it("returns nothing for a brand-new helper at 0 stats", () => {
    expect(
      selectNewMilestones(storage, "helper-1", {
        completedJobCount: 0,
        totalEarningsDollars: 0,
        fiveStarStreak: 0,
      }),
    ).toEqual([]);
  });

  it("returns the first_job milestone on the very first completion", () => {
    const fresh = selectNewMilestones(storage, "helper-1", {
      completedJobCount: 1,
      totalEarningsDollars: 50,
      fiveStarStreak: 0,
    });
    expect(fresh.map((m) => m.id)).toEqual(["first_job"]);
  });

  it("skips milestones the helper has already celebrated", () => {
    markCelebrated(storage, "helper-1", "first_job");
    const fresh = selectNewMilestones(storage, "helper-1", {
      completedJobCount: 5,
      totalEarningsDollars: 200,
      fiveStarStreak: 0,
    });
    expect(fresh.map((m) => m.id)).toEqual(["five_jobs"]);
  });

  it("preserves the canonical milestone order (smallest first)", () => {
    const fresh = selectNewMilestones(storage, "helper-1", {
      completedJobCount: 25,
      totalEarningsDollars: 2000,
      fiveStarStreak: 8,
    });
    expect(fresh.map((m) => m.id)).toEqual([
      "first_job",
      "five_jobs",
      "ten_jobs",
      "twenty_five_jobs",
      "first_1k_earnings",
      "first_five_star_streak_of_5",
    ]);
  });

  it("each milestone fires only ONCE — second call returns empty", () => {
    const stats = {
      completedJobCount: 25,
      totalEarningsDollars: 2000,
      fiveStarStreak: 8,
    };
    const first = selectNewMilestones(storage, "helper-1", stats);
    first.forEach((m) => markCelebrated(storage, "helper-1", m.id));
    const second = selectNewMilestones(storage, "helper-1", stats);
    expect(second).toEqual([]);
  });
});

describe("HELPER_MILESTONES — copy contract", () => {
  it("includes all six milestone IDs the product spec requires", () => {
    const ids = HELPER_MILESTONES.map((m) => m.id);
    const expected: HelperMilestoneId[] = [
      "first_job",
      "five_jobs",
      "ten_jobs",
      "twenty_five_jobs",
      "first_1k_earnings",
      "first_five_star_streak_of_5",
    ];
    expect(ids).toEqual(expected);
  });

  it("every milestone has both a title and a description", () => {
    for (const m of HELPER_MILESTONES) {
      expect(m.title.length).toBeGreaterThan(0);
      expect(m.description.length).toBeGreaterThan(0);
    }
  });
});
