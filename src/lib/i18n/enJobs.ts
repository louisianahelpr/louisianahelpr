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
  // F291a (audit 11-10): the hired Helpr's name for the same button while a case is open: the case sheet takes their photos.
  "jobPage.addYourSide": "Add photos", // Area 04 #16 (11-18): the case sheet takes photos only, no statement
  "jobPage.photos": "Photos from the job",
  "jobPage.crew": "Your crew",
  "jobPage.side": "Price and actions",
  "jobPage.postedBy": "Posted by",
  "jobPage.yourHelpr": "Your Helpr",
  // Design audit r3 #9: the job page's fact rows, the no-applicants card and the poster's Edit / Cancel buttons.
  "jobPage.whenRow": "When",
  "jobPage.whereRow": "Where",
  "jobPage.noApplicants": "No applicants yet",
  "jobPage.sentToOne": "Sent to 1 Helpr so far.",
  "jobPage.sentToN": "Sent to {n} Helprs so far.",
  "jobPage.outNear": "It's out to Helprs near {city}.",
  "jobPage.outNearby": "It's out to Helprs nearby.",
  "jobPage.tellYou": "We'll tell you when someone applies.",
  "jobPage.repliesSooner": "Want replies sooner?",
  "jobPage.addPhoto": "Add a photo",
  "jobPage.addPhotoWhy": "Jobs with photos are easier to say yes to",
  "jobPage.changePrice": "Change the price",
  "jobPage.youreAt": "You're at",
  "jobPage.editJob": "Edit job",
  "jobPage.cancelJob": "Cancel job",
} as const;

addEnglish(enJobs);
