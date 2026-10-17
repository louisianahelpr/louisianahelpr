import { Award, BadgeCheck, Users2 } from "lucide-react";
import { JOB_CATEGORIES } from "@/lib/jobCategories";

// The category picker's options. Canonical order + labels come from
// `src/lib/jobCategories.ts` (most-requested first, "Other" last) so the
// posting grid, the browse filter and the map popup can't drift apart.
export const categories = JOB_CATEGORIES.map(({ value, label }) => ({ value, label }));

// 32, down from 100. A job card gives the title ONE line (line-clamp-1) in a
// ~254px column at the tightest breakpoint — the two-up grid — sharing that row
// with the price chip. Measured against the card's own italic display face:
// 40 still clipped real titles at 35-37 chars, and 32 is where they stop
// clipping ("Board windows ahead of the storm" is exactly 32 and fits).
//
// Enforced at the INPUT, where the poster sees a live n/32 counter and can
// choose their own wording, rather than silently cutting their words later on
// the board. line-clamp-1 stays only as a safety net for rows posted before
// this cap existed.
//
// If this proves too tight in practice, the lever is card LAYOUT, not the cap:
// the title currently yields ~90px of its row to the price chip, so moving the
// price into the meta line below would buy back roughly a third more room.
export const TITLE_MAX = 32;
export const DESCRIPTION_MAX = 1000;

// Categories where credential-tier requirements make sense (trade work).
// All others default to tier 0 (open) with the selector hidden.
//
// The test is not "could this job be done badly" — it is "does Louisiana
// license this work, and is this where unlicensed operators actually turn up".
// Four categories fail that test in a way that matters here:
//
//  - `storm_prep` (added 2026-09-06) is the one this list could least afford to
//    omit on a Louisiana marketplace. Tarping, board-up, roof and structural
//    repair after a hurricane sit squarely inside the state contractor
//    licensing regime, and a generator hookup is electrical work. It is also
//    the single best-documented magnet for unlicensed out-of-state operators in
//    the state — the storm-chaser pattern every post-hurricane advisory warns
//    about. A poster boarding up before landfall could not ask for a licensed,
//    insured pro; every other trade category could.
//  - `yard_work` (added 2026-09-06) carries tree removal, which Louisiana
//    licenses separately (LDAF arborist / utility arborist) and which is the
//    most dangerous thing anyone posts here — a felled limb damages a roof or a
//    neighbour, and an uninsured operator leaves the poster holding it.
//
// Deliberately NOT included: cleaning, errands, delivery, pet_care and events
// have no trade licence to require, so a "Licensed pros only" gate there would
// filter on a credential that does not exist and simply empty the applicant
// pool. `other` is a judgement call left open — it is the escape hatch that
// electrical, plumbing, HVAC and roofing land in when the poster doesn't pick
// Handyman, but it is equally where "help me carry boxes" lands, and offering a
// licensing gate on a job we know nothing about invites a mis-set filter. Flag
// for the owner rather than decided here.
//
// The trades (T2, owner 2026-10-14: "anyone can apply by default; the poster
// may choose Licensed pros only") join where Louisiana licenses or certifies
// the work (sources on LICENSE_WARNINGS below): electrical, plumbing, HVAC and
// roofing, the four building trades the contractor board licenses by project
// value (carpentry, flooring, concrete and masonry, fencing), and appliance
// repair (refrigerant work needs an EPA certificate). Welding, auto and small
// engine repair and pressure washing have no Louisiana trade license, so a
// "Licensed" gate there would filter on nothing and empty the pool.
export const CREDENTIAL_TIER_CATEGORIES = new Set([
  "handyman",
  "painting",
  "moving",
  "assembly",
  "storm_prep",
  "yard_work",
  "electrical",
  "plumbing",
  "hvac",
  "roofing",
  "carpentry",
  "flooring",
  "concrete_masonry",
  "fencing",
  "appliance_repair",
]);

// A plain-words heads-up for posters on jobs where Louisiana (or federal law)
// requires a license or certificate AT ANY PRICE (T2, owner 2026-10-14: warn,
// never block). Jobs here are capped at $1,000 (jobs_budget_range), so the
// contractor board's dollar thresholds never apply and are not warned about:
// R.S. 37:2150.1 (Acts 2025, No. 422) starts electrical, mechanical and
// plumbing contractor licensing at $10,000, home improvement at $7,500 and
// residential construction at $50,000 (read on legis.la.gov 2026-10-15).
// What does apply at any price, each read from the primary source:
//   plumbing    R.S. 37:1367 + 1377 (State Plumbing Board license for plumbing
//               work; Act 908 of 2026 moves plumber licensing to the contractor
//               board on 2027-01-01 and keeps it required).
//   hvac        40 CFR 82.161(a)(1): anyone who could open a refrigerant
//               circuit must hold an EPA Section 608 certificate.
//   appliance   the same EPA rule for fridges, freezers and window AC units.
//   electrical  no statewide electrician license below $10,000, but some
//               cities license electricians for any work (New Orleans:
//               nola.gov Class A electrical license).
//   yard_work   R.S. 3:3804: tree removal, trimming or pruning for pay needs an
//               LDAF arborist license (small pruning under 2 inches excepted).
//   moving      R.S. 45:162 + 45:164(E): hauling household goods within
//               Louisiana for pay needs a Public Service Commission certificate,
//               with cargo insurance, workers' comp and a bond (T2 research,
//               docs/OPEN.md Q1835; owner said YES to the warning 2026-10-17).
//               Labor-only help (loading, carrying, no hauling) was not
//               confirmed either way, so the copy speaks only of hauling.
// Copy is a heads-up, not legal advice, and offers the "Licensed" tier as the
// way to act on it.
export const LICENSE_WARNINGS: Readonly<Record<string, string>> = {
  plumbing:
    "Heads up: Louisiana requires a licensed plumber for most plumbing work, whatever the price. Choose \"Licensed\" below to get only licensed pros.",
  hvac:
    "Heads up: anyone who works on refrigerant (AC lines, recharging) must hold an EPA certificate. Choose \"Licensed\" below to get only licensed pros.",
  appliance_repair:
    "Heads up: fixing a fridge, freezer or window AC unit's cooling system needs an EPA-certified tech. Choose \"Licensed\" below to get only licensed pros.",
  electrical:
    "Heads up: some Louisiana cities, including New Orleans, require a licensed electrician for electrical work. Choose \"Licensed\" below to get only licensed pros.",
  yard_work:
    "Heads up: cutting, trimming or removing trees for pay needs a Louisiana arborist license. If your job includes tree work, choose \"Licensed\" below.",
  moving:
    "Heads up: hauling household goods for pay in Louisiana needs a state moving permit from the Public Service Commission, plus cargo insurance. If your job includes hauling your things, choose \"Licensed\" below.",
};

// The tier options rendered in the "Who can apply?" segmented control.
// No "ID-Verified" tier: every helper accepted for a job is already
// ID-verified, so it would never actually narrow the applicant pool.
// The only meaningful gates for trade work are licensing and insurance.
export const CREDENTIAL_TIERS = [
  { value: 0, label: "Open", sub: "Anyone can apply", Icon: Users2 },
  { value: 2, label: "Licensed", sub: "Licensed pros only", Icon: Award },
  { value: 3, label: "Licensed + Insured", sub: "Licensed & insured", Icon: BadgeCheck },
] as const;

// Category-specific title placeholders — once the poster picks a
// category the example title matches what they're actually posting,
// which both speeds entry and models a good, specific title.
export const titlePlaceholders: Record<string, string> = {
  cleaning: "e.g. Deep clean a 2-bedroom apartment",
  yard_work: "e.g. Mow & edge the front and back yard",
  moving: "e.g. Help me move a couch up two flights",
  errands: "e.g. Grocery run and a pharmacy pickup",
  handyman: "e.g. Mount a TV and hide the cables",
  painting: "e.g. Paint a 12×12 bedroom, one coat",
  delivery: "e.g. Pick up a dresser and drop it off",
  pet_care: "e.g. Walk my dog twice a day this week",
  assembly: "e.g. Assemble an IKEA wardrobe",
  storm_prep: "e.g. Board up windows before the storm",
  events: "e.g. Set up and break down a backyard party",
  electrical: "e.g. Replace two kitchen outlets",
  plumbing: "e.g. Fix a leaky kitchen faucet",
  hvac: "e.g. AC unit not cooling upstairs",
  roofing: "e.g. Replace shingles after a storm",
  welding: "e.g. Weld a broken trailer hitch",
  carpentry: "e.g. Build shelves in a closet",
  auto_repair: "e.g. Tune up my lawn mower engine",
  appliance_repair: "e.g. Dryer runs but won't heat",
  flooring: "e.g. Lay tile in a small bathroom",
  concrete_masonry: "e.g. Pour a small concrete pad",
  fencing: "e.g. Repair a wood privacy fence",
  pressure_washing: "e.g. Pressure wash the driveway",
  other: "e.g. Help me with a quick job",
};

// `descriptionHints` was removed 2026-08-10. It rendered a fixed
// per-category sentence directly above DescriptionField's adaptive
// "Tip:" line, so an empty description showed two serif-italic hints at
// once saying much the same thing. The adaptive one names what is
// actually still missing and self-dismisses, so it won.
