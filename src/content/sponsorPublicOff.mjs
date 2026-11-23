/**
 * 25 Days sponsors who said No to being shown publicly: they keep their giveaway day (the day's post still tags them),
 * but they are never on the website: not in the public lineup (/25days, /sponsor), the sponsors guide, the gift-guide
 * logo row, the gift types or the search index.
 *
 * Helping Hands Gallery: their sign-up form said "OK on wall = No", and the owner ruled on 2026-11-21 (tracker):
 * "respect their No: leave Helping Hands OFF the public sponsor wall and public lineup (still post their day + tag them)".
 *
 * Sprinkle in Time Too (Sulphur): their sign-up form (Nov 19, 3:41 PM) said "not OK on the wall", the same answer as
 * Helping Hands, and no owner OK to show them was found (night audit 2026-11-23, 25days M10). Handled the same way:
 * their Dec 16 day, graphic and tag stay; the tracker keeps them on their day.
 *
 * Read by scripts/check-25days-lineup.mjs (the tracker still lists them on their day, so the drift check leaves them out)
 * and scripts/gift-guide-sponsor-logos.mjs readLineup (which scripts/gift-guide-picks.mjs also reads); guarded by
 * src/test/sponsorPublicOff.test.tsx.
 */
export const PUBLIC_OFF_SPONSORS = ["Helping Hands Gallery", "Sprinkle in Time Too"];
