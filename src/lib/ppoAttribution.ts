/**
 * Product Page Optimization (PPO) — A/B test attribution.
 *
 * Apple's PPO product randomly serves up to 3 treatment variants alongside
 * the control listing on the App Store. When a user installs from a PPO
 * treatment, Apple appends `?ppt=<treatment_id>` to the install referrer,
 * which iOS hands to the app on first launch (and which we also accept on
 * the web for paid-social campaigns mirroring the same hypotheses).
 *
 * We capture the treatment, persist it for the session, tag every analytics
 * event downstream with `ppo_test_id` + `ppo_treatment`, and let the admin
 * dashboard slice activation / first-job rates by treatment. That's how we
 * close Apple's loop — Apple tells us *installs* per arm, we tell ourselves
 * *activation* per arm, and we crown the variant that actually grows the
 * business, not just the download count.
 *
 * Active tests are declared in `PPO_TESTS`. When you launch a new test in
 * App Store Connect, add the test ID + treatment IDs Apple issues you here.
 */
import { track, AhaEvent } from "@/lib/analytics";

export type PpoTestId = "trust" | "visual" | "local";
export type PpoArm = "control" | "treatment";

export interface PpoAttribution {
  testId: PpoTestId;
  treatmentId: string;
  arm: PpoArm;
  capturedAt: string;
}

const STORAGE_KEY = "helpr_ppo_attribution";

/**
 * Catalogue of live + planned tests.
 *
 * `applePptId` is the value Apple stamps onto `?ppt=` for each treatment
 * variant. The control arm has no Apple ID (it's the default listing) — we
 * synthesize a `control` token internally so analytics buckets line up.
 *
 * Fill in real `applePptId` values once you create each test in App Store
 * Connect → Custom Product Pages → Product Page Optimization.
 */
export const PPO_TESTS: Record<PpoTestId, {
  hypothesis: string;
  control: { label: string };
  treatments: Array<{ applePptId: string; label: string }>;
}> = {
  trust: {
    hypothesis: "Does safety messaging beat price messaging on install rate?",
    control: { label: "Verified, Secure, Local" },
    treatments: [
      { applePptId: "TRUST_TREATMENT_PPT_ID", label: "Jobs from $50. Save time." },
    ],
  },
  visual: {
    hypothesis: "Does lifestyle photography beat product UI on install rate?",
    control: { label: "Dashboard + map screenshots" },
    treatments: [
      { applePptId: "VISUAL_TREATMENT_PPT_ID", label: "Real Louisiana neighbors at work" },
    ],
  },
  local: {
    hypothesis: "Does parish-specific copy beat broad statewide copy?",
    control: { label: "Service marketplace for your home" },
    treatments: [
      { applePptId: "LOCAL_TREATMENT_PPT_ID", label: "Reliable help in Iberia & Vermilion Parishes" },
    ],
  },
};

const PPT_LOOKUP: Record<string, { testId: PpoTestId; treatmentId: string }> = (() => {
  const out: Record<string, { testId: PpoTestId; treatmentId: string }> = {};
  for (const [testId, def] of Object.entries(PPO_TESTS) as Array<[PpoTestId, typeof PPO_TESTS[PpoTestId]]>) {
    for (const t of def.treatments) {
      if (t.applePptId && !t.applePptId.endsWith("_PPT_ID")) {
        out[t.applePptId] = { testId, treatmentId: t.applePptId };
      }
    }
  }
  return out;
})();

/**
 * Parse the launch URL for a PPO treatment marker. Accepts:
 *   - `?ppt=<applePptId>`            (Apple's native PPO referrer)
 *   - `?ppo_test=trust&ppo_arm=treatment`  (manual / web-mirror campaigns)
 */
export function readPpoFromQuery(search: string): PpoAttribution | null {
  const params = new URLSearchParams(search);

  const ppt = params.get("ppt");
  if (ppt && PPT_LOOKUP[ppt]) {
    const { testId, treatmentId } = PPT_LOOKUP[ppt];
    return { testId, treatmentId, arm: "treatment", capturedAt: new Date().toISOString() };
  }

  const manualTest = params.get("ppo_test") as PpoTestId | null;
  const manualArm = params.get("ppo_arm") as PpoArm | null;
  if (manualTest && PPO_TESTS[manualTest] && (manualArm === "control" || manualArm === "treatment")) {
    return {
      testId: manualTest,
      treatmentId: manualArm === "control" ? `${manualTest}_control` : `${manualTest}_treatment_manual`,
      arm: manualArm,
      capturedAt: new Date().toISOString(),
    };
  }

  return null;
}

/**
 * Capture-and-persist. Call from the CPP router on first launch — first
 * write wins so a user who later opens a non-PPO link doesn't lose their
 * original attribution.
 */
export function recordPpoAttribution(search: string): PpoAttribution | null {
  const attribution = readPpoFromQuery(search);
  if (!attribution) return null;

  try {
    if (!localStorage.getItem(STORAGE_KEY)) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(attribution));
      track(AhaEvent.AppOpenedFromDeepLink, {
        source: "ppo",
        ppo_test_id: attribution.testId,
        ppo_treatment_id: attribution.treatmentId,
        ppo_arm: attribution.arm,
      });
    }
  } catch {
    // private mode / disabled storage — best-effort only
  }

  return attribution;
}

/**
 * Read the persisted attribution. Use to tag downstream activation events
 * (signup_completed, first_job_posted, first_payout_received) so the admin
 * dashboard can compute conversion per arm.
 */
export function getPpoAttribution(): PpoAttribution | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PpoAttribution;
  } catch {
    return null;
  }
}

/** Convenience: spread directly into a `track(...)` props bag. */
export function ppoTrackingProps(): Record<string, string> {
  const a = getPpoAttribution();
  if (!a) return {};
  return {
    ppo_test_id: a.testId,
    ppo_treatment_id: a.treatmentId,
    ppo_arm: a.arm,
  };
}
