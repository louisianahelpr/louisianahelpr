/**
 * The notifications ask in context (owner 2026-11-20, ease batch item 3): never at sign-up or on first load, only
 * right after the action it is about. Loaded with the ask itself (src/lib/pushAskWords.ts, a lazy chunk), never on a
 * page's first load. Spanish: esPushAsk.ts.
 */
import { addEnglish } from "./enRegistry";

export const enPushAsk = {
  "pushAsk.posted.title": "Want a ping when someone applies?",
  "pushAsk.posted.body": "We'll let you know the moment a Helpr applies to your job or messages you. Change it any time in Settings.",
  "pushAsk.applied.title": "Want a ping when you're hired?",
  "pushAsk.applied.body": "We'll let you know as soon as the poster hires you or messages you. Change it any time in Settings.",
  "pushAsk.listed.title": "Want a ping when someone makes an offer?",
  "pushAsk.listed.body": "We'll let you know when a buyer makes an offer, asks a question or buys. Change it any time in Settings.",
  "pushAsk.message.title": "Want a ping when they reply?",
  "pushAsk.message.body": "We'll let you know when a new message comes in. Change it any time in Settings.",
} as const;

addEnglish(enPushAsk);
