# Builder 3 handoff (11-20, 8:47 PM to 9:15 PM)

Branch: fix/gg-photos-links-1120c (based on fix/gg-photos-covers-1120b @ 859330d6db). Code head: 560c711f45 (this file is one commit after it). No PR opened, nothing merged.

## Fixed (12)
- Task 1, same item, right link/photo/price: 7 picks (cef1cfaacf): heroes Rothco cap, Colors Carhartt beanie, Mejuri Stevie Hoops (photo + cutout), Stanley All Day Slim, Stanley Reserve Wine Tumbler, Ulta BaBylissPRO, Best Buy Pokemon box. Saltair was already right.
- Task 3, clean cutouts from the retailer's plain photo: 3 (94bb16b8b9): Melissa & Doug dentist set, Glow Recipe niacinamide serum, Weezie hand towels.
- Task 4: 2 shop-small cards now show the name only (560c711f45): The Fois, Tiffany Morton Cosmetic Tattooing. Their files were a headshot and a couple's photo.

## Remains
Task 1
- Bombas Sunday Slipper (dad): bombas.com returned 429; not changed.
- FootJoy Quantum, men's (dad): needs a ShopMy link minted (zappos.com is not on the host allowlist) and a photo not hosted on Amazon. Zappos showed 139.95.
- Mejuri Stevie Hoops: the ShopMy link still lands on the non-US site; needs a US link to mejuri.com/products/stevie-hoops. The 171 price is a sale price ending 11-22.
- Stanley prices set are sale prices; will need a re-check when the sale ends.
- Colors beanie is now Carhartt Brown (B002G9UDY6): a judgment call, lead to confirm.

Task 2: no price was changed. Findings for the lead:
- outdoors-and-travel "YETI Roadie 60 Wheeled Cooler" (375): its source link is the yeti.com Roadie 32 Wheeled page (262.50 now, sale from 375). Name and link disagree, and work-life already holds a Roadie 32 Wheeled. Needs a decision.
- Carhartt Canvas Mesh-Back Cap: source points at a dxl.com Odessa cap page (different cap).
- Nike Phoenix Fleece crew: price source is a full-zip hoodie URL.
- Skipped, on cut lists: Corsair K70, Lodge skillet.

Task 3, still bad or untried
- No clean source found: Katie Kime ice bucket (plain photo exists, but the white lid on white defeats the cutout), Saranoni throw, Mayfair Empathy crewneck (family), Mayfair wide-leg sweatpants (home-and-kitchen), Criquet shirt, Frisco cat tree, Innova scanner (Amazon link, not editable), UGG Tasman II (life-moments), Printfresh Long PJ Set (mom).
- Not attempted: Lasyone's, City Sightseeing, RYSE Fuel, CLM brush.
- Skipped, on cut lists: Material platter, Pura Vida advent (clean cutouts made for both, not installed), Mayfair Angels crewneck (friends), Terrain clogs, MacKenzie-Childs spoon rest, Columbia Tamiami, both Furhaven beds.
- Left to Builder 1 (her, him, kids, teens): Free People Summit, Timeless bundle, UGG Tasman, Mayfair Empathy Always/Angels, M&D salon, Yoto bundles, Micro Kickboard, Caden Lane footie and stool, Glow kit.

Task 4
- Deming Delights: not changed. public/gift-guides/sponsors/deming-delights.webp is a real round logo; its friends-and-coworkers card uses the business's own site image. I could not see what the audit called wrong.
- The Fois: davidrabalaisfilm.com has a "David Rabalais" wordmark (assets.cdn.filesafe.space/0JZCkRDni588pYJ0ndp4/media/68068e4098e519514a7c288c.png) and the film poster; neither is a "The Fois" logo. If the lead wants the wordmark, put it in the logos folder and drop the slug from NO_LOGO in scripts/gift-guide-small-biz.mjs.
- Tiffany Morton: only a Facebook profile.php page, not readable without login.

## Prices not readable
Slap Ya Mama (target.com), YETI Roadie 24 (rei.com) and Roadie 8 (llbean.com), Nike Phoenix Fleece crew, Best Buy Pokemon box (91.99 kept). Not attempted: Best Buy Powerbeats Pro 2, HOKA Rincon 5 / Transport 2 / Bondi 9, Sam's Club Every Man Jack kit, Tractor Supply YETI Roadie, Oura Ring 5, Bombas, and the unpriced store-page picks (Apple, BaubleBar, lululemon, Crocs, YETI, HOKA).

## Tests
- Run: npx vitest run --maxWorkers=2 src/test/giftGuide: 312 of 323 pass. The same 11 fail before and after my commits; none names my items. I did not check them against a clean base branch.
- Run: node scripts/check-gift-cover-in-guide.mjs: passes.
- Not run: full suite, typecheck, lint, browser checks.

## Notes for the lander
- Never commit the full output of the cover script; only the Colors cover/og changed here.
- 8623b48720 (already on the base branch range) is a plain regenerate from current sources and is separable.
- The Weezie cutout is marginal: a thin light strip remains between the two towels.
- Shop-small now has 35 logos and 2 more name-only cards; the two jpg files were removed by the generator.
