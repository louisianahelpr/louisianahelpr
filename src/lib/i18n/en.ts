/**
 * The app's words, English. THE SOURCE: every key here must exist in es.ts
 * (typed Record<MsgKey, string>, so a missing key fails typecheck; the
 * dictionary test checks the reverse, empties and {vars}).
 *
 * Keys are "<screen>.<thing>". {name} is filled by t(key, { name }).
 * Money and legal meaning must match exactly across languages.
 */
import { enCore } from "./enCore";
import { enScreens } from "./enScreens";
import { enPostJob } from "./enPostJob";
import { enJobs } from "./enJobs";

/** The whole dictionary (boot words + screen words). Tests and es.ts's type read it; app code calls t(). */
export const en = { ...enCore, ...enScreens, ...enPostJob, ...enJobs } as const;

export type MsgKey = keyof typeof en;
