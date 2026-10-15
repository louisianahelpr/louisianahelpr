# Louisiana Helpr as the main hub for Louisiana — roadmap

Owner vision (2026-10-14): "a main hubspot for Louisiana". Process (owner pop-up 2026-10-14): every
section gets its own decision record with EVERY question decided by the owner BEFORE building, then it
is built in slices behind a hidden switch, ONE section at a time. Research/prep may run in parallel.

## Sections, in order
| # | Section | Status (2026-10-14) | Spec |
|---|---------|---------------------|------|
| 1 | Jobs (Helpr marketplace) | Live | — |
| 2 | Declutter (sell used household items) | Building: slices 1-3 built, 3b payments building, 4 handover next; launch web-first | docs/specs/declutter-auctions.md |
| 3 | Landlord hub: rentals with FULL applications + leases (owner choice), maintenance requests -> Helpr jobs | Prep/research running | docs/specs/landlord-hub-prep.md |
| 4 | Local shops: makers, bakers, home-grown, things people build; rentals (party equipment etc.); orders the maker accepts | Prep/research running | docs/specs/local-shops-prep.md |
| 5 | Business promotion: FREE profile + paid boosts (owner choice) | Prep with #4 | docs/specs/local-shops-prep.md |

Owner said "launch agent on each": prep agents run per section now; building waits its turn.

## Approved hub features (owner pop-up 2026-10-14) — each gets its own question round before building
| # | Feature | Owner's description |
|---|---------|---------------------|
| H1 | Storm hub | During hurricanes/floods: "I need help" / "I can help" board, debris and tarp jobs, generator rentals, neighbor check-ins, links to official alerts and shelters |
| H2 | Local events calendar | Festivals, crawfish boils, church fairs, markets, game days by parish; free to post; businesses can boost events |
| H3 | Licensed pros directory | Plumbers, electricians, roofers with the Louisiana contractor license checked against the state's public lookup, plus reviews |
| H4 | Local hiring board | Local businesses post regular part-time/full-time jobs (not just gigs) |
| H5 | Deals & local gift cards | Businesses post coupons/specials; people buy gift cards to local shops through the app |
| H6 | Community board | Lost and found (incl. pets), neighborhood notices, volunteer and donation drives |
| H7 | Hub-wide rewards | Points for jobs done, items sold, reviews; spend as credit with local businesses or on fees |

Not chosen: parish home pages. Ruled out by Claude as high legal risk (not offered): ride sharing, childcare.

Declutter's own growth features (rows 71-90) live in docs/specs/declutter-auctions.md.

## Hub-wide decisions (owner pop-ups 2026-10-14)
| # | Question | Decision |
|---|----------|----------|
| G1 | Name | Keep "Louisiana Helpr" for the whole hub; sections are plain names (Declutter, Rentals, Local Shops...) |
| G2 | Navigation | Home is the central page. Bottom bar: Home · Jobs · Declutter · Shops · More (Rentals, Events, Storm Hub, Pros, Hiring, Deals, Community; promote a section to the bar when it gets popular). Order chosen by Claude per owner ("however you think") |
| G3 | Messages + Profile | Move to top-right corner icons on every screen (unread badge on Messages) |
| G4 | Home screen | Mixed "near you" feed: your own items first (jobs, sales, pickups), then new jobs, items, events, shops near you |
| G5 | Launch focus | City/area with most users, app stays open statewide. MEASURED 2026-10-14 (prod, non-seed): 34 members, 30 in Acadiana (Vermilion 10, Iberia 7, Lafayette 6, Acadia 3, St. Landry 3, St. Martin 1); jobs last 90 days: Vermilion 8, Iberia 4 -> focus ACADIANA (Vermilion/Iberia/Lafayette) |
| G6 | Ad budget | $0 for now: free posts, Facebook groups, flyers, word of mouth |
| G7 | Ambassadors | Yes: a few well-known locals per parish with personal invite links, paid in app credit per sign-up that completes something |
| G8 | First partners | Churches, local businesses (free profile + first boost free + window sticker), landlords & property managers, schools & teams |
| G9 | Wallet | NO wallet: earnings always pay out to the bank via Stripe; only credit we give (rewards, referrals, ambassadors) is spendable in the app (avoids money-transmitter licensing) |
| G10 | ID checks | Required (Stripe Identity) for every money role: Helprs, shop owners, landlords, Declutter sellers; optional "ID-verified" badge for buyers |
| G11 | Ratings | One overall star rating everywhere + per-section breakdown on the profile |
| G12 | Support | Help center articles + AI helper answering from them + "Talk to a person" button reaching the owner |

## Trades in Jobs (owner pop-up 2026-10-14) — more questions before building
| # | Question | Decision |
|---|----------|----------|
| T1 | Trade categories | Add all common trades: electrical, plumbing, HVAC, roofing, welding, carpentry, auto & small-engine repair, appliance repair, flooring/tile, concrete & masonry, fencing, pressure washing; "Other: anything else" stays (owner: "i want everyone to feel welcomed to post what they wish") |
| T2 | Licensed trades | Anyone can apply by default; poster may choose "Licensed pros only" (existing CredentialTierSelector); Helprs with a checked license show a "Licensed" badge; Claude researches which jobs legally need a Louisiana license and warns posters on those |

Owner rule (2026-10-14): "before building all ask me questions to make sure we are on the same page for all" — EVERY section/feature gets a question round before any build, including Declutter slice 4.

## Fees across the hub (owner pop-ups 2026-10-14 night)
| # | Decision |
|---|----------|
| F1 | Declutter AND Shops buyer fee = 5% + $0.70 (match Vinted's "usually 5% + $0.70", read on vinted.com/help/342 2026-10-14), card cost included in it; raise later once more people sign up. REPLACES Declutter row 20/21 (15%, min $1) and Shops L37 — the built Declutter code (slices 3/3b: 15% + $1 minimum, table CHECKs) must change before launch |
| F2 | Pro shops: free boost days + badge only for now (no lower buyer fee) — replaces the "lower buyer fee" half of L38 |
| F3 | JOBS: "the percentages should be the same across the board": job POSTER pays NO fee; the same 5% + $0.70 comes out of the HELPR's pay (replacing today's Helpr commission). Card cost (~2.9% + 30c) comes OUT of the 5% + 70c (poster pays exactly the job price; on $100 the Helpr gets $94.30). Owner: change it RIGHT AWAY (not waiting for Apple). New jobs only; jobs already posted keep their old fees. Poster refunds = job price minus card cost (never-absorb rule; our-mistake refunds stay full) |
| F4 | MEMBERSHIPS (Pro) switched OFF entirely for now (owner 2026-10-14): everyone has the same features and the same flat fee. Measured on prod: 35 non-seed members, 0 with a subscription tier or Stripe subscription, so nobody is stranded. Switched off, not deleted, so it can return. Supersedes F2 / L38 / L63 Pro perks |

## Everyone welcome (owner 2026-10-14: "the Louisiana spot for everything... Everyone. No matter the age gender etc. I want all professional trades etc to feel included and seen. No matter how weird the hobby")
| # | Feature |
|---|---------|
| I1 | "Suggest a category" button everywhere a category is picked; admin approves; added for everyone; "Other" always works meanwhile |
| I2 | Interest groups & clubs for any hobby (posts + events), found locally |
| I3 | Profile skills & interests tags, searchable |
| I4 | Spanish + Vietnamese translations (after launch) |

## Spanish (owner 2026-10-14: "I really want Spanish residents to feel welcomed")
| # | Decision |
|---|----------|
| S1 | When: after all sections launch (owner chose; Claude recommended earlier) |
| S2 | Language chosen automatically from the phone's language, plus an "English / Español" switch on sign-up and in Settings |
| S3 | Messages: "Translate" button on each message (same AI as the app uses), original always visible |
| S4 | Job posts, listings and reviews: "Translate" button; anyone may write in either language |

Ownership (owner via lead session, 2026-10-14): THIS session builds the jobs flat fee (F3) and memberships off (F4); the lead session stays on the open list; landing on main stays one at a time.
| F5 | Boosts bought INSIDE the iPhone app: paused for BOTH job boosts and shop/business boosts (owner: "whatever you recommend"; Claude recommended both) — boosts sell on the website only for now; supersedes Shops L65/L66 (Apple/Google in-app purchase) until revisited |
