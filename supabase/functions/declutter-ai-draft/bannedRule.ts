/**
 * The not-allowed rule every Declutter photo check uses: one item's draft, a saved listing's check, Sell a bunch,
 * a moving-out room and a Wanted post's photos (index.ts). Its own file so a test can read the exact words the
 * model gets.
 *
 * Owner 10-31 ~6:00 PM (OWNER-DECISIONS.md, "Declutter photo check"): the old rule ("may be any of these ... If you
 * are not sure, set it to true") held six everyday listings for admin review: an acne cleanser, a USB body
 * massager, a lash and brow lifting kit, a toy metal cannon, a "Vera Bradley Style" duffel and a glass bottle with
 * a stopper. "no need for admin review they can be added. admin doesnt need to review stuff like that." So the rule
 * now flags only what truly cannot be sold, the list in the Terms ("What you can't sell"), and only when the item
 * IS one of them, and it names everyday items that only look like one as allowed. A malformed answer still fails
 * closed in sanitize.ts (anything but an explicit false is a flag).
 */
export const BANNED_RULE = `Set possibly_banned to true, with a short reason, ONLY when the item clearly IS one of these, which cannot be sold here: a real weapon (a firearm or its parts, a BB, pellet or air gun, a stun gun or taser, brass knuckles, or a knife made as a weapon) or ammunition; alcohol; prescription medicine or illegal drugs; vapes or e-cigarettes; a product under a recall; a crib made before mid-2011; a used car seat; a counterfeit, meaning an item sold AS a brand it is not (fake logos, "replica" or "1:1" claims); sexual or adult items; live animals; vehicles or boats; real estate.
Everyday items are allowed even when they sound close to one of those; set possibly_banned to false for them. For example: over-the-counter skincare, cosmetics and toiletries (an acne cleanser, a face wash, sunscreen, lotion); massagers, hair tools and personal care devices (a USB body massager, a heating pad); beauty kits (a lash and brow lifting kit, a nail kit); toys, models and decor shaped like a weapon (a toy metal cannon, a toy sword, a cap gun, a mounted decorative replica that cannot fire); kitchen knives and tool knives; bags and clothes described as a brand's "style" or "inspired" that do not claim to be that brand (a "Vera Bradley Style" duffel); empty bottles, jars and decanters (a glass bottle with a stopper).
When nothing in the photos or the words shows the item is one of the not-allowed kinds, set possibly_banned to false. Never flag an item only because of its category, its brand, or a word in its title.`;
