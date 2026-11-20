/**
 * Waiting on a sign-up's email (owner 2026-11-20, ease batch item 6): /signup's "Check your email to finish" card for
 * someone whose sign-up is still unverified on this device, and /signup-pending's "While you wait" links. Loaded only
 * by those two pages (side effect import). Spanish: esVerify.ts.
 */
import { addEnglish } from "./enRegistry";

export const enVerify = {
  "verify.checkTitle": "Check your email to finish",
  "verify.checkBody": "We sent a link to {email}. Tap it to finish signing up, then you can post, message and pay. Anything you started is kept on this device.",
  "verify.resend": "Send a new link",
  "verify.different": "Use a different email",
  "verify.whileWait": "While you wait",
  "verify.browseJobs": "Browse jobs near you",
  "verify.startPost": "Start a job post",
  "verify.browseDeclutter": "Browse Declutter",
} as const;

addEnglish(enVerify);
