# Local Makers & Rentals + Business Promotion: prep before the owner decides

Prep for the owner's 2026-10-14 ask: Louisiana Helpr becomes "the main hub for Louisiana".
Two new sections, decided question by question BEFORE any build (the owner's Declutter
process: "lets go over every question before building so we arent working backwards"):

- **(A) Local Makers & Rentals.** Home bakers, home-grown produce, eggs and honey, people who
  build or make things, and people who rent things out (party equipment and the like). Each
  has a "store"; buyers browse it and place orders; the maker ACCEPTS each order.
- **(B) Business Promotion.** Every business gets a FREE profile. Businesses pay only for
  BOOSTS: featured at the top of a section or area for a week or a month.

Written by a prep agent 2026-10-14 (read-only: no code, no migrations, no prod access).
Model: docs/specs/declutter-auctions.md (on ready/declutter-3 @ 9d90c9977).
Codebase read at origin/main e5e09c44a and the Declutter worktree ~/.lh-wt/declutter-3 @ 9d90c9977.
Not an OPEN.md item (owner order 10-13: no new to-do items). Question ids below are L1..L92,
not queue numbers.

## Decided
| # | Question | Decision | When |
|---|----------|----------|------|
| 1 | Business promotion model | Every business gets a FREE profile; businesses pay for BOOSTS (featured at the top of a section/area for a week or a month) | 2026-10-14 |

Everything else is below as owner questions (L1..L92).

## Words used in this file (plain meanings)
- **Shop**: one member's store page (a maker, a renter, or a business). Any member can open one.
- **Order request**: a buyer asks for items; nothing is charged until the shop accepts.
- **Card hold**: the money is set aside on the buyer's card but not taken. It drops off if not used.
- **Boost**: a paid spot at the top of a list, always marked "Ad".
- **Handover**: the moment the buyer gets the order (QR scan, 4-digit code, or "I got it").

---

## 1. What we can reuse (measured in the code 2026-10-14)

### From the Declutter engine (branch ready/declutter-3 @ 9d90c9977, NOT on main yet)
| Piece | Where | Use for shops |
|---|---|---|
| Member gate (signed in, not banned, < 3 strikes, 18+, payouts set up) | `declutter_assert_member` in supabase/migrations/20261014193955_declutter_foundation.sql | Same gate for opening a shop and ordering |
| Hidden switch + admin review card | src/config/featureSwitches.ts, src/components/admin/settings/DeclutterReviewCard.tsx, FeatureSwitchesCard.tsx | New keys `local_shops`, `business_boosts` |
| Photo rules (3-12 photos, re-encode, EXIF/GPS strip, owner-folder storage, purge on delete) | src/lib/declutter/photos.ts, supabase/functions/_shared/purgeBuckets.ts | Shop and item photos |
| AI listing help + banned-item check | supabase/functions/declutter-ai-draft/index.ts (+ sanitize.ts) | Item drafts; food "low-risk list" check; ad check for boosts |
| Admin approval of a new seller's first 3 listings | `declutter_admin_pending_items` / `declutter_admin_review_item` (migration 20261014200728) | First items of a new shop; permit checks |
| Area label that can't leak the address; coarse public point; nearest-first browse | `declutter_area_label_problem`, src/lib/declutter/distance.ts | Shop area + "nearest first" |
| Public Q&A through the contact-leak filter; private messages only after checkout | slice 1 Q&A RPCs | Questions on a shop item |
| Offers/accept race safety (lock item, one winner, cart line) | `declutter_take_item`, scripts/declutter/race-accept.mjs | Order accept; rental double-booking |
| Cart: one checkout per seller, fee as a table CHECK, 48 h deadline, supersede-safe | `declutter_start_checkout` (migration 20261014210518), src/lib/declutter/money.ts | Shop checkout |
| Saved card store (service-role writes, brand + last 4 readable) | `declutter_buyer_cards` | Card holds for orders and rental deposits |
| Strikes (1 year expiry, 3 = out), deadline sweep cron, price-drop cron pattern | `declutter_strikes`, cron `declutter-deadlines` | Shop strikes, order deadlines |
| Business-like seller flag + tax refusal hook | `declutter_seller_flags`, `seller_tax_not_ready` | Shops are businesses: tax ON from day one |
| Account deletion refused while a sale is in flight | findActiveWork (slice 3) | Same for open orders/rentals |
| Data export sections | src/test/helpers/dataExportInventory.ts | Add shop sections before go-live |
| Planned, not built yet: Stripe step (slice 3b), QR handover + auto-pay (slice 4), Helpr delivery (slice 5), storm pause (row 39), strike appeals (row 49) | spec rows 25-29, 39, 49; B38 | Shops should wait for these and share them |

### From the live app (origin/main e5e09c44a)
| Piece | Where | Use |
|---|---|---|
| Job boosts: $3 / 24 h, 20% Pro discount, monthly free boosts per tier | supabase/functions/create-boost-payment/index.ts, _shared/productPrices.ts (`BOOST_FEE_CENTS` 300, `BOOST_DURATION_HOURS` 24), `claim_monthly_free_boost` (migration 20260915043201) | Business boost purchase + Pro perks |
| Boost ranking in browse | `ORDER BY j.boosted_at DESC NULLS LAST` in the browse RPCs (e.g. migration 20261012185633) | "Boosted first" pattern |
| Boost return handling | src/pages/home/useBoostReturn.ts, src/components/JobBoostDialog.tsx | Return from web checkout |
| Pro membership tiers ($5/$10/$15/$20, fee ladder 12% -> 8%) + Apple IAP path | src/lib/subscriptionTiers.ts, src/components/profile/SubscriptionTab.tsx, supabase/functions/verify-apple-iap, create-pro-checkout | Shop fee discounts / free boosts by tier |
| Stripe Connect Express payouts (`business_type: "individual"` today) | supabase/functions/stripe-connect/index.ts:270-285 | Shop payouts (a company-type option needed for LLCs) |
| Separate charges + transfers, payout at release | supabase/functions/create-payment, release-payout | Pay the shop at handover |
| Stripe Identity check | supabase/functions/stripe-idv-start, profiles.stripe_identity_verified | "ID checked" badge |
| Credentials upload + admin queue | src/components/profile/CredentialsTab.tsx, src/components/admin/AdminCredentialQueue.tsx, table helper_credentials | Food permit, Fire Marshal plate, insurance certificate, contractor license |
| Reviews (blind until both / 14 days) | table reviews, src/components/reviewPanel/*, src/lib/reviewWindow.ts | Shop reviews |
| Messages + contact-leak filter, report, block | src/pages/messages/*, `contact_leak_reason` (migration 20260907005738), ReportDialog.tsx, BlockUserDialog.tsx, user_blocks | Order chat, safety |
| Strikes ladder | `apply_consequence_ladder` (migration 20260829030000), user_violations | Model for shop strikes |
| Disputes | table disputes, AdminDisputes.tsx, execute-dispute-split | Rental damage claims, food problems |
| Notifications (push + bell + email) | create-notification, notifications table, send-notification-email | Order/rental alerts |
| Recurring series (day picker, off-session charges) | migration 20260820010000, charge-recurring-visits | Later: weekly produce box / standing orders |
| Sales tax authority (Stripe Tax codes, enumerated services) | supabase/functions/_shared/salesTax.ts, calculate-tax | Tax on shop goods and rentals |
| Saved helpers / saved searches | favorite_helpers, saved_searches | "Follow a shop" |
| Drive time (client only) | src/hooks/useDrivingTime.ts | Distance display (server price still needed, Declutter note) |
| profiles.business_name (a text field only) | src/integrations/supabase/types.ts | Seed for the business profile name |
| AI (Gemini) builder | supabase/functions/ai-job-builder | Shop/ad text help |

**Do not resurrect:** the old `businesses` / `business_members` "business seats" backend was removed on purpose
(migrations 20260828004538, 20260828011811: 4 rows, all test). The `job_boosts` table was dropped
(20260830072801); boosts live on `jobs.boosted_at` / `boost_expires_at` now. A business profile should be a new,
small table owned by one member (CLAUDE.md: never role-based, every account can open one).

**Existing store risk to fix anyway:** Q1796 (MEDIUM) already tracks that Job Boost is sold through Stripe
inside the iOS app (guideline 3.1.1). Business boosts must not copy that path (see 2.6).

---

## 2. Law and platform rules (research 2026-10-14)

VERIFIED = I read the primary text (statute page, enrolled act, agency page or platform rule) on 2026-10-14.
NOT VERIFIED = search excerpt, secondary source, or I could not open the text. Not legal advice; the lawyer/CPA
list is in section 4.

### 2.1 Home bakers (cottage food) and home-made food
- VERIFIED: **La. R.S. 40:4.9** "Low-risk foods; preparation in home for public consumption"
  (https://legis.la.gov/Legis/Law.aspx?d=98431):
  - Home-prepared low-risk foods are exempt from the state Sanitary Code equipment/construction rules (A(1)(a)).
  - The low-risk list (E): baked goods, candies, cane syrup, dried mixes, honey and honeycomb products, jams,
    jellies and preserves, pickles and acidified foods, sauces and syrups, spices. **None may contain animal
    muscle protein or fish protein.**
  - Breads, cakes, cookies, pies: sanitary conditions in A(2) (pests, no pets, clean equipment, perishables at
    45 F or below, pasteurized milk for custard/cream fillings with cooking/chilling rules); the exemption does
    not apply if the baker EMPLOYS someone to help make them (A(1)(b)); they may not be sold to a retailer or
    anyone for resale (C).
  - Label (D(1)): foods offered for sale must be labeled that they were not produced in a licensed or regulated
    facility. Raw honey not pasteurized/filtered is exempt from the label.
  - Registration (D(2)): the seller must be registered to collect local sales tax, shown by a current sales tax
    certificate from the parish collector where sales occur.
  - CBD (F): no food containing cannabidiol unless FDA approves it as a food additive.
  - Cap (B): the code page still reads **$30,000** gross annual sales (last amended Acts 2022, No. 357).
- VERIFIED: **Act No. 801 of the 2026 Regular Session (HB 403, enrolled)** amends R.S. 40:4.9(B) from $30,000 to
  **$100,000** (https://www.legis.la.gov/Legis/ViewDocument.aspx?d=1481239). NOT VERIFIED: the governor's
  approval date and the effective date (the enrolled copy's "APPROVED" line is blank; regular-session acts usually
  take effect Aug 1, not checked). Until confirmed, design for "the state cap", stored as a setting.
- VERIFIED by absence in the statute text: R.S. 40:4.9 says nothing about online ordering, delivery or shipping.
  NOT VERIFIED: the Louisiana Department of Health's position (no LDH cottage-food page found; third-party guides
  disagree about shipping). Ask LDH in writing (section 4).
- NOT VERIFIED (ldh.la.gov search excerpts): the Sanitary Code treats any establishment that prepares, sells or
  gives away food as a retail food establishment needing an LDH permit. Practical meaning: anything NOT on the
  low-risk list (plate lunches, gumbo, jambalaya, boudin, meat pies, tamales, seafood, cut fruit, raw milk)
  needs a permitted kitchen.
- What the app cannot see: a baker's sales outside the app. The app can only count its own sales.

### 2.2 Eggs, produce, honey, plants
- VERIFIED: **La. R.S. 3:826** "Producers selling eggs of their own production are exempt from the provisions of
  this Part" (the Louisiana Egg Grading and Marketing Law) (https://legis.la.gov/Legis/Law.aspx?d=86863).
- VERIFIED (agency page, https://www.ldaf.la.gov/food/selling/eggs): "If you produce, distribute, or process eggs,
  you must have an Egg Marketing License", $100/yr. This reads against R.S. 3:826; ask LDAF which applies to a
  backyard flock (section 4).
- NOT VERIFIED (2011 Justia copy): R.S. 3:845 exempts producers with fewer than 500 hens who sell direct from the
  farm from licensing; R.S. 3:828 bars quality words ("fresh", "Grade A") on ungraded eggs; R.S. 3:830 candling.
- Honey: on the cottage list (VERIFIED above); raw honey needs no "not inspected" label.
- Whole, uncut produce: no rule found or read. NOT VERIFIED.
- Plants, seedlings, cut flowers: NOT VERIFIED (ldaf.la.gov search excerpts): the Horticulture law requires a
  nursery stock dealer permit to sell nursery stock and a floral dealer permit ($100/yr) for cut flowers/potted
  plants; no home-seller exemption found.

### 2.3 Home-made non-food goods
- No general Louisiana license for selling crafts was found (absence NOT VERIFIED). Local occupational licenses
  and home-business zoning are parish/city matters (NOT VERIFIED).
- Children's products (toys, baby clothes, blankets): NOT VERIFIED (cpsc.gov search excerpts, pages not opened):
  every children's product needs a Children's Product Certificate; registered "small batch" makers can skip SOME
  third-party tests, never the "Group A" ones (lead in paint, small parts, cribs, pacifiers, baby bouncers).
  Hard for a home maker to meet.
- Soaps, lotions, cosmetics (FDA MoCRA), pet treats (LDAF commercial feed): NOT VERIFIED; treat as lawyer questions.
- **INFORM Consumers Act** VERIFIED (FTC guidance page,
  https://www.ftc.gov/business-guidance/resources/informing-businesses-about-inform-consumers-act): a
  "high-volume third party seller" = 200+ sales of NEW or unused consumer products and $5,000+ gross in any
  12 months (of the past 24) that the marketplace processed payment for. Within 10 days the marketplace must
  collect bank account, tax ID and contact info, verify it within 10 days, recertify yearly, and suspend a
  seller who doesn't answer in 10 days. Sellers with $20,000+ a year must show full name, physical address and
  contact on listings or order confirmations (limited exception for sellers working only from home). Penalty
  $53,088 per violation. Declutter's used items mostly fall outside; **makers' goods are new, so INFORM applies
  to shops.** Stripe Connect onboarding already collects bank + tax ID; the yearly recertification and the
  $20k display are new work.

### 2.4 Sales tax for shops (they are businesses, not occasional sellers)
- VERIFIED: **La. R.S. 47:340.1** (https://www.legis.la.gov/legis/Law.aspx?d=1186690): a marketplace facilitator
  "facilitates a sale for a marketplace seller"; once gross revenue for retail sales delivered into Louisiana
  exceeds $100,000, it is "deemed a dealer for all sales occurring thereafter"; apply within 30 days and collect
  within 60 days; last amended Acts 2025 No. 82 and No. 433 (eff. July 1, 2025). The collection duty is written
  for "taxable remote sales for delivery into Louisiana". NOT VERIFIED: whether a Louisiana shop selling to a
  Louisiana neighbor is a "remote sale" the platform must collect on, or whether each shop collects itself
  (CPA question).
- Unlike Declutter, shops get NO "isolated or occasional sale" exemption (R.S. 47:305(A), verified in the
  Declutter spec): they sell regularly. Cottage bakers must hold a parish sales tax certificate (VERIFIED above).
- NOT VERIFIED: food for home consumption is exempt from the state rate but taxed by parishes; prepared food
  is taxed fully. CPA question.
- The app's tax authority today taxes only some job labor (supabase/functions/_shared/salesTax.ts, measured);
  goods and rentals need new Stripe Tax codes.

### 2.5 Equipment rentals
- VERIFIED: **La. R.S. 47:302(B)** (https://legis.la.gov/Legis/Law.aspx?d=101816) levies the 2% state tax on the
  lease or rental of tangible personal property (B(1) gross proceeds where renting is an established business or
  incidental to one; B(2) the monthly rental price paid by the renter). Other state levies and parish taxes apply
  on top (NOT VERIFIED: LDR rulings put the total state rate at 5%). Rentals are taxable; CPA confirms rates and
  who collects.
- VERIFIED: **Civil Code art. 2687**: the renter "is liable for damage to the thing caused by his fault" or by
  anyone using it with his consent (https://legis.la.gov/legis/Law.aspx?d=109749).
- VERIFIED: **Civil Code art. 2699**: the owner's warranty that the thing is free of defects can be waived only in
  clear language brought to the renter's attention; a waiver does NOT cover defects the owner knew or should have
  known about, is void where it conflicts with art. 2004, and in a consumer lease cannot waive defects that
  seriously affect health or safety (https://legis.la.gov/legis/Law.aspx?d=109761).
- VERIFIED: **Civil Code art. 2004**: "Any clause is null that, in advance, excludes or limits the liability of
  one party for causing physical injury to the other party" (also intentional or gross fault)
  (https://www.legis.la.gov/Legis/Law.aspx?d=109260). **Injury waivers do not work in Louisiana.** Insurance and
  safe equipment do; a rental agreement can still cover damage to the item.
- VERIFIED: **Inflatables (bounce houses)**: R.S. 40:1484.4 (https://legis.la.gov/Legis/Law.aspx?d=97555): an
  "owner" of an inflatable amusement device must register each one with the State Fire Marshal BEFORE use, with an
  inspection certificate dated within 60 days, general liability insurance listing every inflatable on the
  declarations page, yearly renewal, and a registration plate + decal on the device. R.S. 40:1484.3
  (https://www.legis.la.gov/Legis/Law.aspx?d=97554) defines "owner" as someone who owns an amusement attraction,
  an amusement ride, or **more than two** inflatable devices. So a person with one or two bounce houses may fall
  outside the registration law (lawyer/OSFM to confirm; safety and injury liability remain either way).
- VERIFIED (Stripe docs, https://docs.stripe.com/payments/place-a-hold-on-a-payment-method): an online card hold
  lasts 7 days (Visa 4 days 18 h for merchant-started holds); capture can be for less than the hold, then the rest is
  released; card networks may restrict $1 holds you don't mean to capture. **A deposit hold cannot cover a rental
  longer than about 5-7 days**; longer rentals need a charged-then-refunded deposit or a saved card charged for
  proven damage (chargeback risk).
- Deposits: no Louisiana deposit statute for movable rentals was found (R.S. 9:3251 is residential leases; NOT
  VERIFIED). Don't call held money "escrow" (Declutter note on Stripe wording).

### 2.6 Business promotion, ads and the app stores
- VERIFIED: **FTC "Native Advertising: A Guide for Businesses"**
  (https://www.ftc.gov/business-guidance/resources/native-advertising-guide-businesses): terms consumers understand
  are "Ad", "Advertisement", "Paid Advertisement", "Sponsored Advertising Content"; do NOT use "Promoted" or
  "Promoted Stories"; "Sponsored by [X]" can mislead; put the label in front of or above the headline (on the
  image if the image is the focus); in a list mixing ads and non-ads, label EACH ad. "Featured" is not on the
  understood list: use **"Ad"**.
- VERIFIED: **FTC Consumer Review Rule, 16 CFR 465.7** (https://www.law.cornell.edu/cfr/text/16/465.7): no hiding
  reviews because of their rating or negative sentiment while implying the shown reviews are all or most of them.
  Allowed removals must use the same rules for every review (abuse, personal info, clearly false, fake, unrelated).
  **A paying business can never get a bad review removed or buried; boosts must never touch reviews.** Part 465
  also covers fake reviews (465.2), buying reviews (465.4), insider reviews (465.5) (section titles VERIFIED, text
  of those sections not read).
- VERIFIED: **Apple App Review Guidelines** (https://developer.apple.com/app-store/review/guidelines/):
  - 3.1.3(g): "Digital purchases for content that is experienced or consumed in an app, including buying
    advertisements to display in the same app (such as sales of "boosts" for posts in a social media app) must use
    in-app purchase."
  - 3.1.1(a): entitlements "are not required for developers to include buttons, external links, or other calls to
    action in their United States storefront apps". So on the US storefront, the iPhone app may send a business to
    the WEBSITE to buy a boost; selling it through Stripe inside the app is the Q1796 problem.
  - 3.1.3(e): physical goods and services used outside the app MUST use a non-IAP payment (Stripe is right for
    shop orders and rentals).
  - 2.3.1(a) hidden features (Declutter row 51) applies here too.
- VERIFIED: **Google Play Payments policy** (https://support.google.com/googleplay/android-developer/answer/9858738):
  in-app digital features must use Play billing unless an exception applies (physical goods/services, peer-to-peer,
  online auctions); advertising is not an exception; alternative billing / external links exist in "eligible
  countries/regions" (US eligibility NOT VERIFIED).
- NOT VERIFIED: Louisiana contractor licensing (LSLBC, R.S. 37:2150 ff.) limits who may advertise contracting work;
  home improvement registration threshold reported as $7,500. If businesses in licensed trades advertise, check
  licenses (lawyer).

### 2.7 Stripe
- Read 2026-10-14 (https://stripe.com/legal/restricted-businesses, fetched summary; treat as NOT VERIFIED line by
  line): no home-food category; CBD edibles above local THC limits prohibited; tobacco/vape restricted; weapons
  restricted/prohibited; counterfeit and unauthorized brand goods prohibited; precious metals/stones restricted
  (jewelry makers); "sales of online traffic or engagement" prohibited (our boosts are ad placement inside our own
  app, likely fine; confirm with Stripe).
- Measured: Connect accounts are created as Express, `business_type: "individual"` (stripe-connect/index.ts:270-273).
  LLC shops need a company option.
- Bidding: shops must NOT let several buyers bid against each other (Declutter legal findings: Louisiana auction law
  R.S. 37:3103 reaches online bidding). A maker's single quote for a custom order is not an auction.

---

## 3. Owner questions (rounds of 4, plain words)

Each question: options, **recommended first**, one line why. The owner answers by round; answers go into "Decided".

### Round 1: Shape
- **L1. Where does it live in the app?**
  (a) **One new tab "Local" with three parts: Makers, Rentals, Businesses** — the phone dock has room for one more
  idea at most (Declutter could not add a 6th tab at 375 wide, B21). (b) Inside the Declutter tab. (c) A separate
  tab for each part.
- **L2. What do we call it?**
  (a) **"Local"** — short, fits the dock, covers makers, rentals and businesses. (b) "Shop Local". (c) "Louisiana Made".
- **L3. Who can open a shop?**
  (a) **Any member 18+ with payouts set up, same gate as a Declutter seller** — one rulebook, never role-based.
  (b) Only after an ID check. (c) Only after an admin approves the shop.
- **L4. Are a maker's shop and a business profile the same thing?**
  (a) **Yes: one shop per member, free; it can sell items, take orders, rent things, and buy boosts** — one build,
  every business can sell. (b) Two kinds: maker shops and business profiles. (c) Business profiles are only ad
  pages (no selling).

### Round 2: Home food
- **L5. Home-baked food at launch?**
  (a) **Yes, only what state law allows from a home kitchen: baked goods, candy, cane syrup, dry mixes, honey, jams
  and jellies, pickles, sauces and syrups, spices; nothing with meat or fish** — legal without a health permit
  (R.S. 40:4.9). (b) Yes, plus anything from sellers who upload a health-department permit. (c) No food at launch.
- **L6. Plate lunches, gumbo, boudin, meat pies, seafood (these need a health permit)?**
  (a) **Only from shops that upload a current health-department permit, checked by an admin** — legal, and real
  Louisiana food businesses can join. (b) Not at launch. (c) Never.
- **L7. The "made in a home kitchen" label the law requires?**
  (a) **Both: the app shows the notice on every home-food item, and the baker ticks "my package label says it"** —
  covers the buyer in the app and the package in hand. (b) App notice only. (c) Baker's own label only.
- **L8. The yearly sales limit for home bakers ($30,000 now; a 2026 act raises it to $100,000)?**
  (a) **Baker confirms each year they are under the limit; the app counts their app sales, warns at 80% and stops new
  home-food orders at the limit** — the app can only see its own sales. (b) Baker confirms only. (c) No check.

### Round 3: Farm goods and plants
- **L9. Eggs?**
  (a) **Yes, from the seller's own hens only; seller confirms own hens, kept cold, cracked/dirty eggs removed** —
  state law exempts eggs of your own production (R.S. 3:826). (b) Only with the state egg license uploaded.
  (c) No eggs.
- **L10. Fruit and vegetables?**
  (a) **Whole, uncut, home-grown only** — cut or cooked produce needs a permit. (b) Also cut/processed with a permit.
  (c) Not at launch.
- **L11. Plants, seedlings, cut flowers?**
  (a) **Not at launch, until the agriculture department answers whether a home grower needs a dealer permit** — a
  permit law exists and no home exemption was found. (b) Allowed with a permit uploaded. (c) Allowed freely.
- **L12. Home-made children's items (toys, baby clothes, blankets)?**
  (a) **Not at launch** — federal safety testing for children's products is hard for a home maker. (b) Allowed if the
  maker confirms the federal children's product certificate. (c) Allowed, except baby sleep items and toys for under-3s.

### Round 4: What else can be sold
- **L13. Banned list for shops?**
  (a) **Declutter's banned list plus: alcohol, anything with CBD/THC, raw milk, home-canned vegetables/meat, meat or
  seafood without a permit, vapes, live animals, medicines and supplements** — same list everywhere, food extras where
  the law bites. (b) Declutter list only. (c) Owner writes a new list.
- **L14. Soaps, lotions, candles, crafts?**
  (a) **Candles, crafts, decor, furniture, clothing (adult), art: yes. Skin products (soap, lotion, balms): wait for
  the lawyer** — cosmetics have federal rules not checked yet. (b) All allowed now with an ingredient list.
  (c) Crafts only.
- **L15. Can shops sell services (cake classes, photography, DJ)?**
  (a) **No: services stay in Jobs, which already handles them** — no second payment system for services.
  (b) Yes, as shop items. (c) Only rentals that come with a person (DJ with speakers).
- **L16. Can a shop sell used things?**
  (a) **No: used household items go in Declutter** — different tax and strike rules. (b) Yes, marked "used".
  (c) Yes, with no difference.

### Round 5: How an order works
- **L17. The basic order flow?**
  (a) **Buyer picks items and a date and sends an order request; the card is HELD (not charged); it is charged only
  when the maker accepts; the hold drops if the maker says no or doesn't answer** — one step for the buyer, never
  charged unless the maker says yes (Stripe holds last 7 days). (b) Declutter way: maker accepts, then the buyer
  has 48 h to come back and pay. (c) Buyer pays up front, refunded if declined.
- **L18. How long does the maker have to accept?**
  (a) **24 hours, then the request expires and the hold drops** — fast enough for bakery orders. (b) 12 hours.
  (c) 48 hours.
- **L19. Custom orders (a cake with a name, a table built to size)?**
  (a) **Buyer sends a request with details and photos; the maker answers with a price and a ready date; the buyer
  says yes and the card is charged** — one quote, no bidding (auction law). (b) Fixed-price items only.
  (c) Maker and buyer agree in messages, then the maker makes a custom item.
- **L20. Items always in stock (jars of jam on a shelf)?**
  (a) **Maker can mark an item "ready now" with a count; buying it still goes to the maker to accept** — one flow
  to build and test. (b) "Ready now" items sell instantly without accept. (c) No stock counts.

### Round 6: Dates and handover
- **L21. Ready dates?**
  (a) **Each item has a lead time (e.g. 2 days); the shop sets which days it fills orders; the buyer picks a date
  from open days** — no back-and-forth. (b) The maker proposes a date when accepting. (c) Buyer types a date.
- **L22. Limit orders per day?**
  (a) **Yes: maker sets a max per day; full days grey out** — stops overbooking. (b) No limit. (c) Per-item limits.
- **L23. Proving the buyer got it?**
  (a) **Same as Declutter: maker scans the buyer's QR (4-digit code backup) or buyer taps "I got it"; auto-done 24 h
  after the date unless the buyer reports a problem** — one handover system. (b) Photo of the handover. (c) Buyer
  confirm only.
- **L24. Delivery?**
  (a) **Pickup, maker delivers (maker sets the fee), or Helpr delivery with Declutter's pricing** — reuses Declutter
  slice 5. (b) Pickup only at launch. (c) Helpr delivery only.

### Round 7: Rentals, what and how
- **L25. What can be rented at launch?**
  (a) **Party things (tables, chairs, tents, linens, coolers, speakers, decorations), tools, outdoor and sports gear.
  Not: vehicles, boats, trailers, firearms, anything with an engine that carries people** — common, lower-risk items
  first. (b) Anything not on the banned list. (c) Party items only.
- **L26. Bounce houses and other inflatables?**
  (a) **Allowed only with the State Fire Marshal registration plate number, a current inspection and an insurance
  certificate, checked by an admin, even for one bounce house** — the law covers owners of 3+, injury waivers don't
  work in Louisiana, and one injured child is the worst case. (b) Not at launch. (c) Allowed freely.
- **L27. Booking a rental?**
  (a) **Item calendar; renter picks start and end dates; owner accepts like an order; booked dates block out** —
  same accept rule as makers, no double booking. (b) Instant booking with no accept. (c) Message first.
- **L28. Rental price?**
  (a) **Per day, with optional weekend and weekly prices** — how party rentals are priced. (b) Per hour too.
  (c) Per day only.

### Round 8: Rental money
- **L29. Damage deposit?**
  (a) **A card HOLD for the deposit from pickup until 48 h after return for rentals up to 5 days; for longer rentals the
  deposit is charged and refunded after return** — card holds only last 5-7 days (Stripe). (b) Always charge and
  refund. (c) No deposits.
- **L30. Deposit limit?**
  (a) **Owner picks, up to the item's value, at most $500** — keeps renters from huge holds. (b) No cap.
  (c) Fixed at 25% of the item's value.
- **L31. Damage claims?**
  (a) **Pickup and return photos are required in the app; owner files a claim within 48 h of return; renter answers;
  an admin decides; the deposit pays up to its amount** — fair, uses the disputes queue. (b) Owner decides alone.
  (c) No claims; renting is at the owner's risk.
- **L32. Late returns?**
  (a) **One day's price per late day, taken from the deposit, plus a strike after 3 days late** — clear and automatic.
  (b) Owner sets their own late fee. (c) Strike only.

### Round 9: Rental safety
- **L33. Rental terms?**
  (a) **The app's standard Louisiana rental terms: renter pays for damage they cause; owner must tell about known
  defects and keep things safe; NO injury waiver (Louisiana voids them)** — written once by the lawyer, same for all.
  (b) Each owner writes their own. (c) Both, owner's on top.
- **L34. Insurance?**
  (a) **Required for inflatables and tents; suggested for everything else** — the riskiest items carry it. (b)
  Required for every rental owner. (c) Never required.
- **L35. Renter ID check?**
  (a) **ID check (Stripe Identity, already in the app) for rentals with a deposit over $100** — stops theft without
  slowing small rentals. (b) Always. (c) Never.
- **L36. Rental age limit?**
  (a) **18+ to rent and to rent out, same as everything else** — one rule. (b) 21+ for tools/power equipment.
  (c) 18+ only for renting out.

### Round 10: Fees
- **L37. How does the app earn on shop sales and rentals?**
  (a) **Shop fee taken from the shop's payout (10%); the buyer pays the price plus only the card fee, like jobs** —
  makers are businesses, and buyers dislike extra fees on food. (b) Buyer fee like Declutter (15%, at least $1), shop
  keeps 100%. (c) Both smaller: 5% shop + 5% buyer.
- **L38. Pro membership and the shop fee?**
  (a) **The Pro tiers lower the shop fee on the same ladder as Helprs (12% to 8%)** — reuses tiers and gives makers a
  reason to subscribe. (b) Pro gives free boosts only. (c) No link.
- **L39. The card fee?**
  (a) **Buyer sees it in one total; the app never absorbs it (owner rule 10-14)** — consistent everywhere.
  (b) Shop pays it. (c) Split.
- **L40. When does the shop get paid?**
  (a) **At handover (QR / "I got it" / auto after 24 h), like Declutter** — the buyer is protected until they have it.
  (b) When the maker accepts. (c) Weekly.

### Round 11: Cancels and refunds
- **L41. Buyer cancels after the maker accepted?**
  (a) **Free until 24 h before the ready date (price back, card fee kept); after that no refund for custom or
  perishable orders** — the maker has already bought ingredients. (b) Maker sets their own policy. (c) Always refund.
- **L42. Maker cancels after accepting?**
  (a) **Buyer gets everything back incl. the card fee; the card fee is charged to the maker; maker gets a strike** —
  Declutter row 60. (b) Refund, no strike. (c) Strike only after the second time.
- **L43. Something wrong with the order (wrong, spoiled, damaged)?**
  (a) **Buyer reports at handover or within 24 h with a photo; an admin decides; refund of the price, card fee kept
  unless it was our mistake** — owner fee rule; food can't be returned. (b) Maker decides. (c) Always refund.
- **L44. Rental cancellation?**
  (a) **Free until 48 h before the start; after that the renter pays one day's price** — owners hold dates for
  parties. (b) Owner sets their own policy. (c) Always free.

### Round 12: Trust
- **L45. Strikes?**
  (a) **One marketplace strike count shared with Declutter (3 = out of both, each expires after 1 year)** — someone
  struck in one shouldn't move to the other. (b) Separate counts. (c) Shops get 5 strikes.
- **L46. Reviews?**
  (a) **Both ways after handover, on the same star rating as jobs (hidden until both review or 14 days)** — one
  reputation per person. (b) A separate shop rating. (c) Buyers review shops only.
- **L47. Badges?**
  (a) **"ID checked" (Stripe Identity), "Permit on file", "Insured", "Licensed", each checked by an admin** —
  reuses the credentials queue. (b) "ID checked" only. (c) No badges.
- **L48. Talking before ordering?**
  (a) **Public questions on the item before ordering; private messages after an order, through the contact-leak
  filter** — Declutter row 35; keeps payments in the app. (b) Private messages anytime. (c) No messages.

### Round 13: The shop page
- **L49. Outside links and phone numbers on a shop page?**
  (a) **No phone, email or website on the page; only a "Message" button after an order** — keeps orders and
  protection in the app. (b) Website link allowed for businesses. (c) Everything allowed.
- **L50. What a shop page shows?**
  (a) **Name, logo, cover photo, about, area (not address), order days and hours, items, reviews, badges, a
  "Follow" button** — enough to trust and order. (b) Add opening hours map pin. (c) Minimal: name and items.
- **L51. AI help?**
  (a) **Yes: from photos the app drafts item title, description, category, and flags banned or non-home-legal food;
  the maker edits** — same AI as Declutter. (b) Text help only. (c) None.
- **L52. Admin checks?**
  (a) **A new shop's first 3 items wait for an admin; every permit, plate, insurance and license upload is checked;
  AI-flagged items wait** — Declutter row 33 plus the paperwork. (b) Only AI-flagged items. (c) Every item.

### Round 14: Business profiles
- **L53. What a free business profile has?**
  (a) **Name, logo, photos, category, parishes served, hours, description, reviews, badges; it can also open the shop
  side to sell** — free and useful, boosts are the paid part. (b) Profile only, no selling. (c) Profile plus a
  "request a quote" job button.
- **L54. Business categories?**
  (a) **A fixed list (food and drink, home services, beauty, events and party, shopping, health and fitness, pets,
  auto, other)** — clean browsing and boost areas. (b) Free text. (c) Fixed list plus tags.
- **L55. Licensed trades (contractors, electricians, plumbers)?**
  (a) **Must enter their state license number; an admin checks it before "Licensed" shows; unlicensed ones can't
  list in those categories** — Louisiana limits who may advertise contracting work (lawyer to confirm). (b)
  Self-declared. (c) Those categories not at launch.
- **L56. Proof the business is real?**
  (a) **Owner passes the ID check; optional Louisiana Secretary of State number shows "Registered business"** —
  simple, no paperwork wall. (b) Secretary of State number required. (c) No proof.

### Round 15: Boost price and place
- **L57. Boost prices (week / month, owner's choice of lengths)?**
  (a) **$10 a week, $30 a month, per section per parish** — low enough for a home baker, job boosts are $3/day.
  (b) $5 / $15. (c) $25 / $75.
- **L58. Where a boost shows?**
  (a) **At the top of the chosen section (Makers, Rentals or a business category) for buyers in the chosen parishes,
  marked "Ad"** — the place the owner described. (b) Also on the home screen. (c) Everywhere in Local.
- **L59. How many boosted spots per list?**
  (a) **At most 3 per section per parish; sold first come, with a waitlist** — the list stays useful and spots are
  worth buying. (b) Unlimited, taking turns. (c) Highest price wins (not recommended: complex, feels like bidding).
- **L60. Area unit?**
  (a) **Per parish; pick one or more parishes, price per parish** — Louisiana thinks in parishes. (b) Miles around the
  business. (c) All of Louisiana at one price.

### Round 16: Boost rules
- **L61. The boost label?**
  (a) **"Ad" on every boosted card, before the name** — the FTC lists "Ad" as clearly understood and warns against
  "Promoted". (b) "Sponsored". (c) "Featured" (not on the FTC's understood list).
- **L62. Who can buy a boost?**
  (a) **Any approved shop or business with no active strikes** — open, but bad actors can't buy reach. (b) Pro
  members only. (c) Anyone.
- **L63. Pro perks for boosts?**
  (a) **Same as job boosts: 20% off on paid tiers and the monthly free boosts count for business boosts too** —
  reuses `claim_monthly_free_boost`. (b) Separate free business boosts. (c) No perks.
- **L64. Boost refunds?**
  (a) **Unused days refunded if we take the ad down by mistake; no refund if it broke the rules** — fair and simple.
  (b) Never. (c) Always pro-rata.

### Round 17: Paying for boosts on phones
- **L65. Buying a boost from the iPhone app?**
  (a) **A "Buy on our website" button that opens the website checkout (allowed for US App Store apps)** — Apple
  requires its own payment for boosts bought inside the app (3.1.3(g)); the US link-out avoids Apple's share.
  (b) Apple in-app purchase (Apple keeps a share). (c) Stripe inside the app like job boosts today (App Store risk,
  already filed as Q1796).
- **L66. Android?**
  (a) **Same website button, if Google allows it in the US; otherwise Google Play billing** — Google's US rules not
  checked yet. (b) Google Play billing. (c) Website only, no button in the app.
- **L67. Month boosts renew by themselves?**
  (a) **No: reminder 3 days before it ends, one tap to buy again** — no subscription rules or surprise charges.
  (b) Auto-renew, cancel anytime. (c) Choice at purchase.
- **L68. Ad review before it runs?**
  (a) **AI checks the ad photo and text; flagged ones wait for an admin; others run at once** — fast, same as listings.
  (b) Admin checks every ad. (c) No check.

### Round 18: Ranking and fairness
- **L69. Order of everything that isn't an ad?**
  (a) **Nearest first, then rating** — same as Declutter, local first. (b) Best rated first. (c) Newest first.
- **L70. Can paying ever change reviews or hide bad ones?**
  (a) **Never; reviews are hidden only by the same rules for everyone (abuse, personal info, fake)** — federal
  review rule (16 CFR 465.7). (b) (no other legal option).
- **L71. Low-rated shops buying boosts?**
  (a) **Allowed, but an ad always shows the real star rating** — honest, and ads can't hide a bad record. (b) No
  boosts under 3.5 stars. (c) No rating on ads.
- **L72. Boosts per business?**
  (a) **One boost per section per parish at a time** — stops one business taking all 3 spots. (b) Unlimited. (c) Two.

### Round 19: Admin
- **L73. Admin queue?**
  (a) **One "Local" queue: new shops' first items, paperwork (permits, plates, insurance, licenses), AI flags, ads,
  damage claims, strike appeals** — one place to work. (b) Separate queues. (c) Add to the Declutter queue.
- **L74. Storms?**
  (a) **Declutter's storm pause covers Local too: order, pickup and rental clocks freeze, no strikes, boosts get the
  paused days back** — one switch for a hurricane. (b) Separate pause. (c) None.
- **L75. Admin removes a shop?**
  (a) **Open orders are refunded in full (our action, so full), boosts refunded for unused days, shop hidden** — buyers
  never lose money to our decision. (b) Orders finish first. (c) Admin chooses each time.
- **L76. Reports?**
  (a) **Report button on every shop, item and ad, into the existing reports queue** — reuses ReportDialog. (b) Shops
  only. (c) Separate report flow.

### Round 20: Taxes
- **L77. Sales tax on shop sales?**
  (a) **The app adds the tax at checkout and files it itself for all shop sales from day one (the eBay/Etsy way); the
  CPA confirms first** — makers never file app sales themselves and nothing goes untaxed. (b) Each shop collects and
  files its own; the app shows "tax not included". (c) Wait until the $100,000 point, then the app collects.
- **L78. Rentals tax?**
  (a) **Same as L77: the app adds rental tax (state + parish) and files it** — rentals are taxable (R.S. 47:302(B)).
  (b) Owner files. (c) Same as whatever L77 says.
- **L79. One yearly sales counter?**
  (a) **One counter for jobs + Declutter + Local for the $100,000 point** — the law counts the platform's total.
  (b) Separate counters. (c) None.
- **L80. Tax on boosts?**
  (a) **Treated like job boosts today (no tax) until the CPA answers** — same as current code. (b) Add tax now.
  (c) Price includes tax.

### Round 21: Identity and big sellers
- **L81. Big sellers (federal INFORM rule: 200+ sales and $5,000+ a year)?**
  (a) **The app checks bank, tax ID and contact through payout setup, asks them to reconfirm once a year, pauses sales
  if they don't answer in 10 days, and shows name and city (home-based) for $20,000+ sellers** — the federal rule
  requires it; most is already in payout setup. (b) Only payout setup. (c) Lawyer decides.
- **L82. Under 18?**
  (a) **Can't buy, order, rent, or open a shop (greyed out + server refuses)** — same as jobs and Declutter.
  (b) Can buy, can't sell. (c) No limit.
- **L83. Several people running one shop?**
  (a) **One owner per shop at launch** — the old multi-member business backend was removed on purpose. (b) Owner +
  helpers. (c) Owner + one manager.
- **L84. Vacation mode?**
  (a) **Yes: a pause button; open orders still finish; boosts pause and resume** — makers take breaks.
  (b) Hide the shop only. (c) No.

### Round 22: Alerts and launch
- **L85. Alerts?**
  (a) **Push + bell for everything (new order, accepted, declined, ready, pickup, rental return, boost ending); email
  only for money (receipts, refunds) and accepted orders** — Declutter row 44. (b) Email for everything.
  (c) Push only.
- **L86. When to build?**
  (a) **After Declutter's checkout, handover and delivery are working (its slices 3b-5), reusing them** — no second
  copy of the money code. (b) In parallel now. (c) Business profiles + boosts first (no order money), shops after.
- **L87. Launch area?**
  (a) **All of Louisiana, nearest first** — same as Declutter. (b) One city first. (c) A few parishes.
- **L88. First shops?**
  (a) **Owner invites 10-20 real makers and renters as testers; their first month of boosts is free** — real shops
  on day one. (b) Open to all at once. (c) Testers only, no free boosts.

### Round 23: App Store and switches
- **L89. App Store review?**
  (a) **Describe Local in the review notes and What's New and switch it on for the Apple reviewer account** —
  Declutter row 51, guideline 2.3.1(a). (b) Hide it until approved (risky). (c) Separate build.
- **L90. Switches?**
  (a) **Two hidden switches: "Local" (shops, orders, rentals) and "Business boosts"** — boosts can launch or stop on
  their own. (b) One switch. (c) Three (makers, rentals, businesses).
- **L91. Switch turned off mid-order?**
  (a) **Accepted orders and booked rentals finish; nothing new starts; no strikes for interrupted orders** —
  Declutter row 62. (b) Everything refunded. (c) Admin decides.
- **L92. A follow button and "new from shops you follow" alerts?**
  (a) **Yes, at launch** — brings buyers back to local makers. (b) Later. (c) No.

**Total: 92 owner questions in 23 rounds of 4.**

---

## 4. Lawyer, CPA and agency questions (not for the owner to answer)

Lawyer:
- LAW1. Rentals: our standard rental terms under Civil Code arts. 2687, 2699, 2004; is the PLATFORM liable for an
  injury from a rented item (bounce house, tent, tool), and what insurance should Louisiana Helpr itself carry?
- LAW2. Inflatables: does R.S. 40:1484.3 "more than two inflatable devices" really leave a one- or two-bounce-house
  owner outside registration? Should we require registration anyway (L26)?
- LAW3. Home food: liability if a home-baked item makes someone sick (allergens); allergen notice wording.
- LAW4. Children's products (CPSIA), cosmetics (MoCRA), pet treats: what a home maker must have before we allow them.
- LAW5. Licensed trades advertising (LSLBC): what we must check before a contractor business appears or buys a boost.
- LAW6. INFORM Act: exact $20,000 display for home-based sellers; is Stripe Connect's verification enough?
- LAW7. Business terms of service + ad policy (what ads can't say; Louisiana Unfair Trade Practices Act, not checked).
- LAW8. Apple: does a "Buy on website" boost button in the iPhone app pass review under 3.1.1(a) / 3.1.3(g) for a
  US-only app? Google Play equivalent in the US.

CPA / Louisiana Department of Revenue (PolicySales@la.gov, as in the Declutter spec):
- CPA1. Does R.S. 47:340.1 require the app to collect on in-state shop sales (local pickup, Louisiana seller and
  buyer), or only on "remote sales"? May the app collect and file for every shop voluntarily from day one?
- CPA2. Tax on home-made food (state food-for-home-consumption exemption vs parish tax; prepared food).
- CPA3. Rental tax: R.S. 47:302(B) plus other state levies and parish rates; who collects when the app takes payment.
- CPA4. Are business boosts (ad placement inside our app) taxable (digital products / enumerated services)?
- CPA5. Do jobs + Declutter + shops all count toward one $100,000 facilitator total?
- CPA6. 1099-K for shops: confirm Stripe Connect Express files them (not checked).

Agencies:
- LDH (Sanitarian Services): may a home baker take online orders and deliver (or ship) under R.S. 40:4.9? In writing.
- LDAF Egg program ((225) 925-3772): backyard flock selling own eggs: license needed or exempt (R.S. 3:826)?
- LDAF Horticulture: does a home grower selling seedlings/plants/cut flowers need a dealer permit?
- State Fire Marshal: confirm inflatable registration rules for small owners.
- Stripe: confirm boosts are not "sales of online traffic or engagement"; confirm rental deposit holds and
  damage charges on saved cards are allowed for our account.
- Louisiana Legislature: confirm Act 801 of 2026's approval and effective date ($100,000 cottage cap).

---

## 5. Build slices (proposal; every slice behind the hidden switch, OFF until the owner flips it)

Engineering rule: shops REUSE the Declutter engine. Before slice S3, the shared parts of Declutter (member gate,
photos, cart/checkout, card store, handover, strikes, deadline sweep) are lifted into one "marketplace core" that
both Declutter and Local call, so money code exists once. Do this after Declutter slice 4 lands, not during it.

- **S0 Decisions.** Owner answers L1-L92; this file becomes the decision record (like declutter-auctions.md).
- **S1 Shop foundation (switch `local_shops`).** `shops` table (one per member, free), shop page, categories,
  area label (Declutter's no-address check), order days/hours, vacation mode, follow; credentials upload for
  permits / Fire Marshal plate / insurance / licenses through the credentials queue; admin approval; export + purge
  + is_seed from birth; 18+ / strike / ban gate via the shared member gate.
- **S2 Items.** Item kinds `made`, `home_food`, `farm`, `rental`; lead time, daily capacity, stock count;
  photos + AI draft/check (declutter-ai-draft extended with the low-risk food list and the shop banned list);
  home-food label attestation; yearly cottage-cap counter; first-3-items admin review.
- **S3 Orders.** Order request -> card hold -> accept within 24 h -> capture; decline/expiry releases the hold;
  custom quotes (one maker quote, never bidding); cancel rules (L41-L44); strikes; race-safe accept (lock pattern
  from `declutter_take_item`); fee as a table CHECK like Declutter's premium; never absorb a fee.
- **S4 Handover and payout.** Declutter slice 4's QR / code / "I got it" / auto-pay, transfer at handover,
  problem reports into disputes, reviews both ways.
- **S5 Rentals.** Availability calendar with a no-overlap database constraint, booking by date range, deposit hold
  (<= 5 days) or charge-and-refund (longer), required pickup/return photos, damage claims, late fees, rental terms
  page (lawyer text), inflatable paperwork gate.
- **S6 Delivery.** Declutter slice 5's Helpr delivery for shops and rentals (truck rule for large items).
- **S7 Business profiles and boosts (switch `business_boosts`).** Profile fields on the shop; `business_boosts`
  table (section, parish, starts/ends, paid/free source) with a cap of 3 per section per parish; web checkout reusing
  create-boost-payment's pattern and `claim_monthly_free_boost`; iPhone "Buy on website" button (no Stripe inside
  the app); "Ad" label component placed before the name on each boosted card; boosted-first ordering in the Local
  browse RPCs; ad check (AI + admin); reminder before the end; storm-pause credit.
- **S8 Tax and big sellers.** Stripe Tax codes for goods, food and rentals; one $100,000 counter across jobs,
  Declutter and Local; INFORM yearly recertification + $20,000 display + 10-day pause.
- **S9 Launch.** Admin "Local" queue, visual checks at 375 and 1440, App Store notes + reviewer account switch,
  tester shops, then everyone.

---

## 6. Top legal risks (summary)
1. **Home food beyond the law** — only the low-risk list, no meat/fish, the label, the parish tax certificate,
   and a $30,000 cap (Act 801 of 2026 raises it to $100,000; effective date not confirmed). R.S. 40:4.9 VERIFIED;
   LDH's view on online orders/delivery NOT VERIFIED.
2. **Rental injuries** — Louisiana voids injury waivers (Civil Code art. 2004), limits defect waivers (art. 2699);
   inflatables need Fire Marshal registration + insurance for owners of 3+ (R.S. 40:1484.3/.4). All VERIFIED;
   the platform's own exposure NOT VERIFIED (lawyer).
3. **Boost payment inside the iPhone app** — Apple 3.1.3(g) requires in-app purchase for in-app ad boosts; the US
   storefront allows a link to the website (3.1.1(a)). VERIFIED. Existing job boosts: Q1796.
4. **Ads and reviews** — every boosted card labeled "Ad" (FTC native-ad guide) and no review ever hidden for being
   negative (16 CFR 465.7). VERIFIED.
5. **Tax and seller identity** — shops are businesses (no occasional-sale exemption); R.S. 47:340.1 $100,000
   facilitator rule VERIFIED but its reach to in-state local sales NOT VERIFIED (CPA); rentals taxable
   (R.S. 47:302(B), VERIFIED); INFORM applies to makers' new goods (FTC page VERIFIED).

## Owner answers (pop-ups 2026-10-14)
| Q | Decision |
|---|----------|
| L1-L2 | Lives in the "Shops" bottom-bar tab (roadmap G2): makers, bakers, local trades, equipment rentals and businesses |
| L3 | Any adult (18+) with Stripe payout setup (incl. the ID check, roadmap G10) can open a shop |
| L4 | One free shop per member; it can sell items, take orders, rent things out and buy boosts (a shop IS the business profile) |
| L5 | Home food: what Louisiana allows from a home kitchen (R.S. 40:4.9 list, no meat/fish) AND anything else from sellers who upload a health-department permit |
| L6 | Permit foods (plate lunches, gumbo, boudin, meat pies, seafood): only from shops with a current health-department permit checked by an admin |
| L7 | Home-food label: the app shows the required "made in a home kitchen" notice on every home-food item AND the baker ticks "my package label says it" |
| L8 | Home-food yearly limit: baker confirms yearly; the app counts their app sales, warns at 80%, stops new home-food orders at the limit |
| L9-L10 | Eggs from the seller's own hens only (kept cold, no cracked/dirty); whole, uncut, home-grown produce only |
| L11-L12 | Plants/seedlings/flowers and homemade children's items: NOT at launch (plant-dealer permit question; federal children's product testing) |
| L13 | Banned in Shops: Declutter's list + alcohol, CBD/THC, raw milk, home-canned vegetables/meat, meat or seafood without a permit, vapes, live animals, medicines and supplements |
| L14 | Candles, crafts, decor, furniture, adult clothing, art: yes; soap/lotion/balms wait until Claude checks federal cosmetics rules |
| L15 | Services (classes, photography, DJ, trades like welding) stay in Jobs; a shop page may link "Hire me" in Jobs |
| L16 | No used items in Shops (Declutter) |
| L17 | Order: buyer picks items + date; card HELD, charged only when the maker accepts; hold drops on decline/no answer |
| L18 | Maker has 24 h to accept, then the order expires and the hold drops |
| L19 | Custom orders: request with details/photos -> maker quotes price + ready date -> buyer says yes -> charged (one quote, no bidding) |
| L20 | "Ready now" items with a stock count; buying still goes to the maker to accept |
| L21 | Ready dates: per-item lead time + shop's open days; buyer picks an open date |
| L22 | Maker sets a max orders per day; full days grey out |
| L23 | Handover same as Declutter: QR (4-digit backup) or buyer "I got it"; auto-done 24 h after the date unless the buyer reports a problem |
| L24 | Delivery: pickup, maker delivers (maker's fee), or Helpr delivery with Declutter's per-mile pricing once built |
| L25 | Anything not on the banned list can be rented out (banned list still excludes vehicles, boats, firearms, etc.) |
| L26 | Inflatables (bounce houses): only with State Fire Marshal registration, current inspection and insurance certificate, admin-checked, even for one |
| L27 | Booking: item calendar, renter picks start/end, owner accepts, booked dates block out |
| L28 | Pricing: per hour, per day, plus optional weekend/weekly prices |
| L29 | Deposit: card HOLD from pickup to 48 h after return for rentals up to 5 days; longer rentals charge + refund after return |
| L30 | Deposit set by the owner, up to item value, max $500 |
| L31 | Deposit covers late fees + simple damage: owner may keep part for damage shown in pickup vs return photos; renter may object; admin decides only on disagreement; nothing beyond the deposit (owner first said "no claims", clarified by pop-up) |
| L32 | Late returns: one day's price per late day from the deposit, strike after 3 days late |
| L33 | One standard set of Louisiana rental terms, written by Claude from the primary law (no lawyer); no injury waivers (art. 2004) |
| L34 | Insurance required for inflatables + tents; suggested for everything else |
| L35 | Renter ID check (Stripe Identity) for deposits over $100 |
| L37 | Earnings: 15% BUYER fee like Declutter (min $1), card fee INSIDE the 15% (clarified by pop-up); the shop keeps 100% of its price |
| L38 | Pro for shops: BOTH free boost days each month + "Pro" badge AND a lower buyer fee at Pro shops (e.g. 10% instead of 15%; exact % to confirm when building) |
| L39 | Card fee: inside the buyer's one total (never absorbed beyond the premium, as Declutter) |
| L40 | Shop paid at handover (QR / "I got it" / auto after 24 h) |
| L41 | Buyer cancels after accept: the MAKER sets their own cancellation policy (shown before ordering) |
| L42 | Maker cancels after accepting: buyer full refund, card fee charged to the maker, maker strike |
| L43 | Problem with an order: buyer reports at handover or within 24 h with a photo; admin decides; refund of the price, card fee kept unless our mistake |
| L44 | Equipment rental cancellation: the OWNER sets their own policy (shown before booking) |
| L45 | One marketplace strike count shared with Declutter (3 = out of both; each expires after 1 year) |
| L46 | Reviews both ways after handover, on the one shared star rating with a "shop" breakdown |
| L47 | Badges: "ID checked", "Permit on file", "Insured", "Licensed", each admin-checked via the credentials queue |
| L48 | Private messages ANY time (incl. before ordering), still through the contact-leak filter (blocks phones/emails/payment apps) |
| L49 | No phone, email or website on shop pages; Message button only |
| L50 | Full shop page (name, logo, cover, about, area, order days/hours, items, reviews, badges, Follow) PLUS a map pin (owner chose; for storefront businesses — a home maker's pin must stay approximate/area-level, never their house) |
| L51 | AI help from photos (title, description, category; flags banned / not-allowed home food); maker edits |
| L52 | New shop's first 3 items wait for admin OK; every permit/inflatable registration/insurance/license upload checked; AI-flagged items wait |
| L53 | Free business profile = full profile; each business chooses whether it SELLS (shop side), takes REQUEST-A-QUOTE (creates a job request), or both — "depends on the business" |
| L54 | Fixed category list, LONG (owner: "there are a lot I would like to include"). Starter list proposed 2026-10-14 (owner adds/removes): Food & drink (bakery, catering, food truck, restaurant, coffee, snowballs, crawfish & seafood, BBQ, meal prep); Home services (cleaning, lawn & landscaping, pest control, pressure washing, pool, moving, junk removal, organizing); Trades (electrical, plumbing, HVAC, roofing, welding, carpentry, flooring, concrete & masonry, fencing, painting, remodeling, appliance repair, handyman); Auto & marine (mechanic, detailing, towing, tires, boat repair); Beauty (hair, barber, nails, lashes & brows, makeup, spa, tattoo); Events & party (DJ, photography, videography, venues, decor, party rentals, bounce houses, florist, cakes); Health & fitness (personal trainer, gym, yoga, massage, nutrition); Pets (grooming, sitting & walking, training, boarding); Shopping (boutique, crafts & gifts, home decor, plants & garden, farmers market); Learning (tutoring, music lessons, driving school, classes); Professional (real estate, insurance, tax & bookkeeping, notary, printing, IT & phone repair); Outdoors (fishing charters, hunting guides, swamp tours); Other |
| L55 | Licensed trades may list; license number shown as "Licensed" once an admin checks it; unlicensed may list without the badge; Claude researches and warns on work Louisiana says needs a license |
| L56 | ID check required; optional Louisiana Secretary of State number shows "Registered business". Owner confirmed: unregistered small businesses may still call themselves a business with a full profile, just without that badge |
| L57 | Boost prices: $5 a week, $15 a month, per section per parish |
| L58 | Boost shows at the top of the chosen section (Makers, Rent equipment, or a business category) for people in the chosen parishes, labelled "Ad" |
| L59 | Max 3 boosted spots per section per parish, first come with a waitlist; one per business at a time |
| L60 | Boost area = per parish (one or more, price per parish) |
| L61 | Boost label "Ad" on every boosted card, before the name |
| L62 | Any approved shop/business with no active strikes may buy a boost |
| L63 | (Pro: free monthly boost days count for business boosts — L38) |
| L65 | iPhone app: boosts bought via Apple IN-APP PURCHASE (owner chose; Apple keeps its share, 15% under the Small Business Program if enrolled — not checked); website purchases use Stripe |
| L67 | Monthly boosts do NOT auto-renew: reminder 3 days before the end, one tap to buy again |
| L64 | Boost refunds only for unused days when we remove an ad by mistake; none if it broke the rules |
| L66 | Android: Google Play billing for in-app boost purchases |
| L68 | AI checks ad photo + text; flagged ads wait for admin; others run at once |
| L69 | Non-ad order: nearest first, then rating |
| L70 | Paying never changes or hides reviews (federal rule 16 CFR 465.7) — no question needed |
| L71 | Low-rated shops may boost; the ad always shows the real star rating |
| L72 | One boost per business per section per parish (L59) |
| L73 | One "Shops" admin queue (first items, paperwork, AI flags, ads, damage disagreements, strike appeals) |
| L74 | Same storm pause as Declutter (order/pickup/rental clocks freeze, no strikes, boosts get paused days back) |
| L75 | Admin removes a shop: open orders refunded IN FULL (our decision), unused boost days refunded, shop hidden |
| L77-L78 | Sales tax: the APP collects state + parish tax on Shops sales AND rentals and files it, from day one (Etsy/eBay way; Stripe Tax calculates) |
| L79 | One yearly sales counter (jobs + Declutter + Shops) for the $100,000 facilitator point |
| L80 | No tax on boosts (same as job boosts today) |
| L81 | Federal INFORM rule followed: payout setup verifies bank/tax ID/contact; yearly reconfirm; sales pause after 10 days without answer; $20,000+ sellers show name + city |
| L82 | Under 18: can't buy, order, rent or sell (greyed out + server refuses) |
| L83 | One owner per shop (roadmap B3: one person per business) |
| L84 | Vacation mode: pause button; new orders stop, open orders finish, boosts pause and resume |
| L85 | Alerts: push + bell for everything; email only for receipts, refunds and accepted orders |
| L86 | Build AFTER Declutter's checkout/handover/delivery work, reusing them (money code exists once) |
| L87 | Launch: all of Louisiana, nearest first |
| L88 | Open to all at once (owner chose; no invite-only tester phase, no free boost month) |
| L89 | App Store: described in Review Notes + What's New, switched on for the Apple reviewer (same as Declutter row 51) |
| L90 | ONE hidden switch for the whole Shops section (owner: "business and shops should be the same things" — a shop IS the business; an ads-only off switch can be added later if needed) |
| L91 | Switch turned off mid-order: accepted orders/booked rentals finish, nothing new starts, no strikes (same as Declutter row 62) |
| L92 | Follow button + "new from shops you follow" alerts at launch |

ALL 92 local-shops questions answered (2026-10-14).

## Build defaults (Shops slice S2, items, 2026-10-16)
Where the answers above leave a choice open, the S2 lane (migration 20261016212915_shops_items) took the safest
default. Each row is a **default chosen by lane, owner to confirm**. Cited in the code as D<n>.

| # | Question left open | Default chosen | When | Status |
|---|--------------------|----------------|------|--------|
| D1 | L5/L6 permit foods (plate lunches, gumbo, boudin, seafood) from shops with a health permit | Not listable yet: no permit-food type exists until a food-permit credential type and its admin check exist (docs/OPEN.md Q1859). Home food is the R.S. 40:4.9(E) low-risk list only | 2026-10-16 | default chosen by lane, owner to confirm |
| D2 | L8 which yearly limit | $30,000 (the code page today), stored as a setting row (`shop_cottage_settings`) so it moves to $100,000 once Act 801 of 2026's effective date is confirmed. Warn at 80% | 2026-10-16 | default chosen by lane, owner to confirm |
| D3 | Item price range | $1 to $1,000 per item, Declutter's cap | 2026-10-16 | default chosen by lane, owner to confirm |
| D4 | L21 "the shop sets which days it fills orders" | The shop's opening days (slice 1's hours) are its order days; an item cannot be published until the shop has at least one. Lead time 0 to 60 days per item; L22's daily limit is per shop, 1 to 200 | 2026-10-16 | default chosen by lane, owner to confirm |
| D5 | L8 "yearly" | The calendar year in Louisiana time (Jan 1 to Dec 31, America/Chicago); the baker confirms again each January | 2026-10-16 | default chosen by lane, owner to confirm |
| D6 | Items per shop | At most 100 items a shop keeps (withdrawn ones do not count) | 2026-10-16 | default chosen by lane, owner to confirm |
| D7 | Photos per item | 3 to 12, the Declutter rule (section 1 reuse table) | 2026-10-16 | default chosen by lane, owner to confirm |
| D8 | L13/L51 the banned list on the server | Besides the AI photo check, a server word check (alcohol, CBD/THC, vapes, raw milk, medicines, live animals, weapons, used, children's items, skin products, plants, and meat or fish in home food) never refuses: a hit sends the item to an admin with the reason | 2026-10-16 | default chosen by lane, owner to confirm |
| D9 | L7 raw honey (the statute exempts it from the label) | The app notice shows on every home-food item, honey included, and the baker still ticks "my package label says it" | 2026-10-16 | default chosen by lane, owner to confirm |
| D10 | Editing a live item | Stock count and lead time change in place; any other edit takes the item off the shop page (back to draft) until it is published again, so nothing an admin or the AI judged changes while it stays up | 2026-10-16 | default chosen by lane, owner to confirm |
| D12 | A shop that turns selling off (quotes only) | Its live items stop showing to members (they stay listed for the owner and come back when selling is on again), and no item is approved for it | 2026-10-16 | default chosen by lane, owner to confirm |
| D11 | The kind `rental` | Reserved in the item table (section 5 lists it in S2) but refused by every call until the rentals slice (S5, docs/OPEN.md Q1856) | 2026-10-16 | default chosen by lane, owner to confirm |
