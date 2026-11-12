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
import { enJobCard } from "./enJobCard";
import { enSettings } from "./enSettings";
import { enPublic } from "./enPublic";
import { enLanding } from "./enLanding";
import { enNotifications } from "./enNotifications";
import { enDeclutter } from "./enDeclutter";
import { enSections } from "./enSections";
import { enDeclBrowse } from "./enDeclBrowse";
import { enHome } from "./enHome";
import { enMessages } from "./enMessages";
import { enOffer } from "./enOffer";
import { enFree } from "./enFree";
import { enQuestions } from "./enQuestions";
import { enDeclPanels } from "./enDeclPanels";
import { enSellSummary } from "./enSellSummary";
import { enOfferTrade } from "./enOfferTrade";
import { enFreeAsk } from "./enFreeAsk";
import { enMoneyTiles } from "./enMoneyTiles";

/** The whole dictionary (boot words + screen words). Tests and es.ts's type read it; app code calls t(). */
export const en = { ...enCore, ...enScreens, ...enPostJob, ...enJobs, ...enJobCard, ...enPublic, ...enLanding, ...enNotifications, ...enDeclutter, ...enHome, ...enSettings, ...enMessages, ...enOffer, ...enFree, ...enQuestions, ...enDeclPanels, ...enSections, ...enDeclBrowse, ...enSellSummary, ...enOfferTrade, ...enFreeAsk, ...enMoneyTiles } as const;

export type MsgKey = keyof typeof en;
