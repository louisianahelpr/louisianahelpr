/**
 * The words of Post a job (UX-8 phase 1; Auditor 3 A3-3 part 2, 11-01): the step bar and rail, each screen's
 * question, the group grid, the ways to start and the Continue button. Not on the boot path: only Post a job's
 * modules import this file (side effect), which registers the words with t() (enRegistry.ts) before they render.
 *
 * Money and price wording (the price screen's helper lines, totals, fees, the checkout) stays English until a
 * person translates it, as the chat screens do; only the question "What will you pay?" is here.
 */
import { addEnglish } from "./enRegistry";

export const enPostJob = {
  // The step bar (phone) and the step rail (computer)
  "postJob.progress": "Post a job progress",
  "postJob.stepOf": "{step} of {count}",
  "postJob.stepOfLong": "Step {step} of {count}",
  "postJob.goBackToStep": "Go back to step {step}",
  "postJob.steps": "Post a job steps",
  "postJob.rail.groups": "What",
  "postJob.rail.kind": "Kind of job",
  "postJob.rail.details": "Details",
  "postJob.rail.price": "Price",
  "postJob.rail.where": "When and where",
  "postJob.rail.review": "Review",
  "postJob.railDone": "{label}, done. Go back to this step",

  // Each screen's question and helper line
  "postJob.groupsQ": "What do you need done?",
  "postJob.groupsH": "Search, or pick a category.",
  "postJob.kindH": "Tap one to keep going.",
  "postJob.kindQ.moving_errands": "What kind of moving or errand?",
  "postJob.kindQ.events": "What kind of event help?",
  "postJob.kindQ.trades": "What kind of trade job?",
  "postJob.kindQ.home": "What kind of home job?",
  "postJob.kindQ.yard": "What kind of yard job?",
  "postJob.kindQ.auto": "What kind of auto job?",
  "postJob.kindQ.pets": "What kind of pets job?",
  "postJob.kindQ.other": "What kind of something else job?",
  "postJob.detailsQ": "Tell us about it",
  "postJob.detailsH": "A few words and a photo help Helprs say yes.",
  "postJob.priceQ": "What will you pay?",
  "postJob.whereQ": "When and where?",
  "postJob.whereH": "Helprs see the area now and your street address after you hire.",

  // The group grid
  "postJob.searchCategories": "Search categories",
  "postJob.searchPlaceholder": "e.g. wash my driveway",
  "postJob.matchingCategories": "Matching categories",
  "postJob.matches": "Matches",
  "postJob.noMatch": "No category matches \"{query}\". Pick a group below, or Something else.",
  "postJob.categoryGroups": "Category groups",
  "postJob.inGroup": "In {group}",
  "postJob.group.home": "Home",
  "postJob.group.yard": "Yard",
  "postJob.group.moving_errands": "Moving & errands",
  "postJob.group.auto": "Auto",
  "postJob.group.pets": "Pets",
  "postJob.group.events": "Events",
  "postJob.group.trades": "Trades",
  "postJob.group.other": "Something else",
  "postJob.groupEx.home": "Cleaning, handyman, painting",
  "postJob.groupEx.yard": "Mowing, leaves, hedges",
  "postJob.groupEx.moving_errands": "Moving, errands, delivery",
  "postJob.groupEx.auto": "Car repair, small engines",
  "postJob.groupEx.pets": "Walking, sitting, feeding",
  "postJob.groupEx.events": "Setup, serving, cleanup",
  "postJob.groupEx.trades": "Electrical, plumbing, HVAC",
  "postJob.groupEx.other": "Anything not listed",

  // The other ways to start (links under the grid) and the panels they open
  "postJob.otherWays": "Other ways to start",
  "postJob.useTemplate": "Use a template",
  "postJob.hireSaved": "Hire a saved Helpr",
  "postJob.describeAi": "Describe it with AI",
  "postJob.repost": "Repost a recent job",
  "postJob.templatesQ": "Pick a template",
  "postJob.templatesH": "Start from a common job, then edit anything.",
  "postJob.offerQ": "Pick a saved Helpr",
  "postJob.offerH": "They get first refusal for a window you set, before it opens to everyone.",
  "postJob.aiQ": "Describe the job",
  "postJob.aiH": "In your own words. AI fills in the form, and you check it.",
  "postJob.repostH": "The quickest way to ask for the same help again.",
  "postJob.showFewer": "Show fewer",
  "postJob.showAllTemplates": "Show all {count} templates",
  "postJob.noRecent": "No recent jobs to repost yet.",
  "postJob.draftTitle": "Pick up your draft",
  "postJob.draftBody": "Continue the request you saved earlier. A draft keeps your words, so add your photos and video again.",

  // The Continue button
  "postJob.continue": "Continue",
  "postJob.continueWith": "Continue with {category}",
  "postJob.pickToContinue": "Pick a category to continue",
  "postJob.setBudget": "Set a budget to continue",
  "postJob.reviewThenPay": "Review, then pay",
  "postJob.addAddress": "Add the address to continue",
  "postJob.pickDate": "Pick a date to continue",
  "postJob.pickStart": "Pick a start time to continue",
  "postJob.pickLater": "Pick a later start to continue",
  "postJob.review": "Review",
} as const;

addEnglish(enPostJob);
