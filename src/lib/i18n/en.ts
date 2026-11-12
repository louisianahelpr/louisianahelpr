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
import { enSellForm } from "./enSellForm";
import { enOfferTrade } from "./enOfferTrade";
import { enFreeAsk } from "./enFreeAsk";
import { enMoneyTiles } from "./enMoneyTiles";
import { enChatEvents } from "./enChatEvents";
import { enDeclOffers } from "./enDeclOffers";
import { enTodos } from "./enTodos";
import { enListingParts } from "./enListingParts";
import { enTracker } from "./enTracker";
import { enPorchPlaces } from "./enPorchPlaces";
import { enSellingNow } from "./enSellingNow";
import { enYourPage } from "./enYourPage";
import { enJobSteps } from "./enJobSteps";
import { enNextStep } from "./enNextStep";
import { enJobLines } from "./enJobLines";
import { enCardLines } from "./enCardLines";
import { enDeclErrors } from "./enDeclErrors";

/** The whole dictionary (boot words + screen words). Tests and es.ts's type read it; app code calls t(). */
export const en = { ...enCore, ...enScreens, ...enPostJob, ...enJobs, ...enJobCard, ...enPublic, ...enLanding, ...enNotifications, ...enDeclutter, ...enHome, ...enSettings, ...enMessages, ...enOffer, ...enFree, ...enQuestions, ...enDeclPanels, ...enSections, ...enDeclBrowse, ...enSellSummary, ...enOfferTrade, ...enFreeAsk, ...enMoneyTiles, ...enChatEvents, ...enSellForm, ...enDeclOffers, ...enTodos, ...enListingParts, ...enTracker, ...enPorchPlaces, ...enSellingNow, ...enYourPage, ...enJobSteps, ...enNextStep, ...enJobLines, ...enCardLines, ...enDeclErrors } as const;

export type MsgKey = keyof typeof en;
