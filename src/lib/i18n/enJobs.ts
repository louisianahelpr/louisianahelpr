/**
 * The words of the job page (UX-8 phase 1; Auditor 3 A3-3 part 3, 11-01): its own headings, states and links (the
 * Browse card's chips are enJobCard.ts, so the guest /browse screen carries none of these). Not on the boot path:
 * the page's modules import this file (side effect), which registers the English with t() (enRegistry.ts).
 *
 * Money wording (Job price, Your pay, You take home, the money notes) and the job's next-step sentences stay English
 * until a person translates them, as the chat screens do.
 */
import { addEnglish } from "./enRegistry";

export const enJobs = {
  // The job page
  "jobPage.title": "Job",
  "jobPage.loading": "Loading job",
  "jobPage.loadFailed": "We couldn't load this job.",
  "jobPage.checkConnection": "Check your connection and try again.",
  "jobPage.unavailable": "This job isn't available.",
  "jobPage.unavailableBody": "It may have been filled, expired or taken down.",
  "jobPage.browseJobs": "Browse jobs",
  "jobPage.summary": "Job summary",
  "jobPage.details": "Details",
  "jobPage.showMore": "Show more",
  "jobPage.showLess": "Show less",
  "jobPage.where": "Where the job is",
  "jobPage.seeCase": "See the case",
  "jobPage.photos": "Photos from the job",
  "jobPage.crew": "Your crew",
  "jobPage.side": "Price and actions",
  "jobPage.postedBy": "Posted by",
  "jobPage.yourHelpr": "Your Helpr",
} as const;

addEnglish(enJobs);
