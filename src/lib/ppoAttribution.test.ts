// ppoAttribution captures App Store Product Page Optimization treatment
// info from launch URLs, persists "first capture wins" to safeStorage,
// and exposes spread-friendly props for analytics. Bugs here either
// drop attribution (Apple's PPO loop never closes — we can't tell which
// treatment actually grew the business) or overwrite it (later non-PPO
// launches steal credit).

import { describe, it, expect, vi, beforeEach } from "vitest";

const getItemMock = vi.fn();
const setItemMock = vi.fn();
vi.mock("@/lib/safeStorage", () => ({
  safeStorage: {
    getItem: (...args: unknown[]) => getItemMock(...args),
    setItem: (...args: unknown[]) => setItemMock(...args),
    removeItem: vi.fn(),
  },
}));

const trackMock = vi.fn();
vi.mock("@/lib/analytics", () => ({
  track: (...args: unknown[]) => trackMock(...args),
  AhaEvent: { AppOpenedFromDeepLink: "AppOpenedFromDeepLink" },
}));

import {
  readPpoFromQuery,
  recordPpoAttribution,
  getPpoAttribution,
  ppoTrackingProps,
} from "./ppoAttribution";

const STORAGE_KEY = "helpr_ppo_attribution";

beforeEach(() => {
  getItemMock.mockReset();
  setItemMock.mockReset();
  trackMock.mockReset();
});

describe("readPpoFromQuery", () => {
  it("returns null for empty query", () => {
    expect(readPpoFromQuery("")).toBeNull();
  });

  it("returns null for unrelated query params", () => {
    expect(readPpoFromQuery("?utm_source=fb&utm_campaign=launch")).toBeNull();
  });

  it("returns null for ?ppt= with an unknown id (placeholder treatments not yet wired)", () => {
    // All current PPO_TESTS use placeholder *_PPT_ID values, which the
    // module strips from PPT_LOOKUP. So no real ppt= can match yet.
    expect(readPpoFromQuery("?ppt=TRUST_TREATMENT_PPT_ID")).toBeNull();
    expect(readPpoFromQuery("?ppt=GIBBERISH")).toBeNull();
  });

  it("parses manual ?ppo_test=trust&ppo_arm=treatment combination", () => {
    const result = readPpoFromQuery("?ppo_test=trust&ppo_arm=treatment");
    expect(result).not.toBeNull();
    expect(result?.testId).toBe("trust");
    expect(result?.arm).toBe("treatment");
    expect(result?.treatmentId).toBe("trust_treatment_manual");
    expect(result?.capturedAt).toBeTruthy();
  });

  it("parses manual ?ppo_test=visual&ppo_arm=control combination", () => {
    const result = readPpoFromQuery("?ppo_test=visual&ppo_arm=control");
    expect(result?.testId).toBe("visual");
    expect(result?.arm).toBe("control");
    expect(result?.treatmentId).toBe("visual_control");
  });

  it("returns null when ppo_test is not a registered test id", () => {
    expect(readPpoFromQuery("?ppo_test=fake_test&ppo_arm=treatment")).toBeNull();
  });

  it("returns null when ppo_arm is missing or invalid", () => {
    expect(readPpoFromQuery("?ppo_test=trust")).toBeNull();
    expect(readPpoFromQuery("?ppo_test=trust&ppo_arm=garbage")).toBeNull();
  });

  it("supports all 3 declared test ids (trust / visual / local)", () => {
    const trust = readPpoFromQuery("?ppo_test=trust&ppo_arm=control");
    const visual = readPpoFromQuery("?ppo_test=visual&ppo_arm=control");
    const local = readPpoFromQuery("?ppo_test=local&ppo_arm=control");
    expect(trust?.testId).toBe("trust");
    expect(visual?.testId).toBe("visual");
    expect(local?.testId).toBe("local");
  });
});

describe("recordPpoAttribution — first-write-wins", () => {
  it("persists + tracks on first capture", () => {
    getItemMock.mockReturnValue(null);
    const result = recordPpoAttribution("?ppo_test=trust&ppo_arm=treatment");

    expect(result?.testId).toBe("trust");
    expect(setItemMock).toHaveBeenCalledOnce();
    expect(setItemMock).toHaveBeenCalledWith(STORAGE_KEY, expect.any(String));
    const stored = JSON.parse(setItemMock.mock.calls[0][1]);
    expect(stored.testId).toBe("trust");
    expect(stored.arm).toBe("treatment");

    expect(trackMock).toHaveBeenCalledOnce();
    expect(trackMock).toHaveBeenCalledWith(
      "AppOpenedFromDeepLink",
      expect.objectContaining({
        source: "ppo",
        ppo_test_id: "trust",
        ppo_arm: "treatment",
      }),
    );
  });

  it("does NOT overwrite existing attribution on a subsequent capture", () => {
    // First-launch attribution already persisted
    const existing = JSON.stringify({
      testId: "trust",
      treatmentId: "trust_treatment_manual",
      arm: "treatment",
      capturedAt: "2026-01-01T00:00:00Z",
    });
    getItemMock.mockReturnValue(existing);

    // Second launch carries a different PPO treatment
    const result = recordPpoAttribution("?ppo_test=visual&ppo_arm=control");

    // We DO return the parsed query result (so the caller knows what
    // was on the URL) but we do NOT persist or fire track().
    expect(result?.testId).toBe("visual");
    expect(setItemMock).not.toHaveBeenCalled();
    expect(trackMock).not.toHaveBeenCalled();
  });

  it("returns null and writes nothing when query has no PPO marker", () => {
    getItemMock.mockReturnValue(null);
    const result = recordPpoAttribution("?utm_source=fb");
    expect(result).toBeNull();
    expect(setItemMock).not.toHaveBeenCalled();
    expect(trackMock).not.toHaveBeenCalled();
  });

  it("does not throw when storage operations fail", () => {
    getItemMock.mockImplementation(() => {
      throw new Error("storage unavailable");
    });
    expect(() => recordPpoAttribution("?ppo_test=trust&ppo_arm=treatment")).not.toThrow();
  });
});

describe("getPpoAttribution", () => {
  it("returns null when nothing persisted", () => {
    getItemMock.mockReturnValue(null);
    expect(getPpoAttribution()).toBeNull();
  });

  it("returns the persisted attribution", () => {
    const stored = {
      testId: "trust",
      treatmentId: "trust_treatment_manual",
      arm: "treatment",
      capturedAt: "2026-01-01T00:00:00Z",
    };
    getItemMock.mockReturnValue(JSON.stringify(stored));
    expect(getPpoAttribution()).toEqual(stored);
  });

  it("returns null on malformed JSON without throwing", () => {
    getItemMock.mockReturnValue("{not-valid");
    expect(getPpoAttribution()).toBeNull();
  });
});

describe("ppoTrackingProps", () => {
  it("returns empty object when no attribution", () => {
    getItemMock.mockReturnValue(null);
    expect(ppoTrackingProps()).toEqual({});
  });

  it("returns spread-ready ppo_* fields when attribution exists", () => {
    getItemMock.mockReturnValue(
      JSON.stringify({
        testId: "trust",
        treatmentId: "trust_treatment_manual",
        arm: "treatment",
        capturedAt: "2026-01-01T00:00:00Z",
      }),
    );
    expect(ppoTrackingProps()).toEqual({
      ppo_test_id: "trust",
      ppo_treatment_id: "trust_treatment_manual",
      ppo_arm: "treatment",
    });
  });
});
