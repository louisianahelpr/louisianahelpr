/**
 * 25 Days of Louisiana Giveaways: EVERY word on /sponsor (also /25days) and
 * /25days/rules lives in this one file (owner spec 2026-11-09). Edit the text
 * here; nothing else needs to change.
 *
 * PLACEHOLDERS: any text inside [square brackets] is a placeholder the owner
 * must fill in. The page never shows a placeholder to visitors: the card, line,
 * button, stat or FAQ answer that holds one is HIDDEN until the brackets are
 * replaced with the real value (src/lib/sponsor/placeholders.ts). Never invent
 * a number, testimonial, logo or press mention to fill one.
 *
 * Numbers the owner may change without a code change (the reach stats, the
 * founder photo, testimonials, the per-day sponsor cap) are set in
 * /admin/sponsors and override the values here.
 *
 * The rules page shows a "DRAFT" banner until `rules.approved` is true. It may
 * only be set true once no [placeholder] is left in `rules` (checked by
 * src/test/sponsorPageContent.test.ts).
 */
export const sponsorPage = {
  // The browser-tab title, search description and link-preview text are NOT here: they live in
  // src/lib/publicPageMeta.mjs (NOINDEX_PAGE_META "/sponsor", "/25days", "/25days/rules"), the one table the
  // server reads to build a shared link's preview before the page runs. The preview picture is public/og-25days.png.

  /** The giveaway runs Dec 1–25, 2026, Louisiana time. */
  event: {
    year: 2026,
    firstDay: 1,
    lastDay: 25,
    timeZone: "America/Chicago",
  },

  links: {
    website: "https://www.louisianahelpr.com",
    websiteLabel: "louisianahelpr.com",
    facebookPage: "https://www.facebook.com/louisianahelpr",
    // UNKNOWN: the "Visit our Facebook Group" buttons stay hidden until this is a real URL.
    facebookGroup: "[FACEBOOK GROUP URL]",
    email: "admin@louisianahelpr.com",
    privacy: "/privacy",
    rules: "/25days/rules",
    // Owner 2026-11-16: the Holiday Gift Guides page, linked from this page's footer.
    giftGuides: "/gift-guides",
  },

  hero: {
    /** Shown only when ?ref= matches a brand added in /admin/sponsors. {brand} is that brand's name. */
    greeting: "Hey {brand}! 🎄 We'd love to have you.",
    eyebrow: "December 1–25 · Louisiana",
    headlineLead: "You're invited!",
    headline: "25 Days of Louisiana Giveaways",
    subhead:
      "Join the giveaways this December and get your brand in front of Louisiana families shopping for the holidays.",
    primaryCta: "Join the Giveaways 🎁",
    secondaryCta: "How It Works",
    /**
     * The shoppers' button (owner 11-19): opens where people enter. Never say HOW they enter here (owner: "don't say
     * exactly what the plan is"). WHERE it goes is not in this file: the iOS app bundles this code, so the link lives in
     * the database, sponsor_settings.entry_url (20261119200128), and changes with no app build. Until it is set, the
     * button opens links.facebookPage.
     */
    enterCta: "How to enter",
    countdownLabel: "Giveaways start in",
    countdownLive: "The giveaways are live! Day {day} of 25",
    /**
     * Under the countdown (short: the hero has little room). Owner 2026-11-18: sign-ups never close; we only ask
     * brands to sign up by Sunday, November 22 so they make the full lineup.
     */
    deadline: "Sign up by Sunday, Nov 22.",
    countdownUnits: { days: "days", hours: "hours", minutes: "min", seconds: "sec" },
  },

  trustStrip: [
    "Louisiana-owned & run",
    "Based in Delcambre, LA",
    "Easy prize delivery",
    "Real local families, not bots",
  ],

  about: {
    title: "What is Louisiana Helpr?",
    body:
      "Louisiana Helpr is a homegrown community website and app built for the people of Louisiana. It's one place where neighbors can find local jobs and help, and buy and sell with Declutter. Along with louisianahelpr.com, we run the Louisiana Helpr Facebook page and the Louisiana Helpr Community Facebook group, where Louisiana families connect, share and support each other every day.",
    /**
     * `href` is set only for a section that is open to everyone today. A card
     * with `href: null` shows `soonLabel` instead of a link (Homes & Rentals
     * and Shops are not open to everyone yet).
     */
    features: [
      // /browse, not /jobs: /jobs asks a guest to sign in first (design audit area 01 #3, 2026-11-18).
      { icon: "briefcase", title: "Jobs", body: "Hire local help or find work near you.", href: "/browse", soonLabel: null },
      // The section is called Homes everywhere in the app (owner 2026-10-18; src/test/homesNotRentalsInCopy.test.ts).
      { icon: "home", title: "Homes", body: "Local homes and rentals, from your neighbors.", href: null, soonLabel: "Coming soon" },
      { icon: "bag", title: "Shop & Declutter Local", body: "Buy and sell used things with Louisiana neighbors.", href: "/declutter", soonLabel: null },
    ],
    groupButton: "Visit our Facebook Group",
    pageButton: "Visit our Facebook Page",
    websiteButton: "Explore the site",
  },

  founder: {
    // Owner 11-10: the page shows no founder section and no personal name. Kept as data for a possible return.
    show: false,
    title: "Hi, I'm Lexi! 👋",
    // The photo is uploaded in /admin/sponsors. Until then no photo frame shows.
    photoAlt: "Lexi, founder of Louisiana Helpr",
    /** One entry per sentence group: an entry holding a [placeholder] is hidden until filled. */
    paragraphs: [
      "I'm the founder of Louisiana Helpr, and I live right here in Delcambre, Louisiana, on the Iberia–Vermilion Parish line.",
      "I'm a local small business owner myself [I own and manage rental properties in the area], so I know how hard it is to get your name in front of the right people.",
      "I started Louisiana Helpr because [YOUR REASON, e.g. I wanted one place where Louisiana people could help each other find work, homes and great local businesses].",
      "25 Days of Louisiana Giveaways is my way of saying thank you to our community this Christmas, and of cheering on the brands that make Louisiana special.",
      "When you sign up, you're working directly with me, a real person who will answer your emails.",
    ],
    signature: "— Lexi, Founder, Louisiana Helpr",
  },

  howItWorks: {
    title: "How it works",
    steps: [
      { icon: "calendar", title: "Pick a day", body: "Choose any day (or days!) from December 1–25. Brands share days, and each brand's prize gets its own winner." },
      { icon: "gift", title: "Tell us your prize", body: "Donate anything you'd like: a product, a gift card, a service or a bundle." },
      { icon: "sparkle", title: "We do the work", body: "We design the graphics, write and publish the posts, tag and link your brand, run the entries and pick a winner at random." },
      { icon: "chart", title: "Your brand shines", body: "A Louisiana neighbor wins your prize, and local families see your brand." },
    ],
  },

  brandGets: {
    title: "What your brand gets",
    items: [
      { icon: "star", title: "Featured on our socials", body: "Your brand and prize featured in the giveaway post on your day, alongside any other brands that share it." },
      { icon: "link", title: "Tags & links everywhere", body: "Your brand tagged and linked on our Facebook page, our group and our website." },
      { icon: "heart", title: "Real local engagement", body: "Louisiana families commenting, sharing and following, right in the middle of holiday shopping." },
      { icon: "wall", title: "Featured on our sponsor wall", body: "Your logo on the 25 Days page all month, linked to your site." },
    ],
  },

  whatWeAsk: {
    title: "What we ask",
    body:
      "Donate a prize, anything you'd like (a product, a gift card, a service or a bundle). The easiest way is to ship it or drop it off to us in Delcambre, and we deliver it to the winner. You can also ship it straight to the winner, email a digital gift card, or have the winner pick it up from you. That's it. We handle the graphics, the posts and picking the winner.",
  },

  reach: {
    title: "Our reach",
    /**
     * Each stat shows only when it is a real number (set here or in
     * /admin/sponsors, which wins). "[X]" = not filled = hidden. The whole
     * section hides when no stat is filled.
     */
    stats: [
      { key: "group_members", value: "[X]", label: "group members" },
      { key: "page_followers", value: "[X]", label: "page followers" },
      { key: "monthly_visitors", value: "[X]", label: "monthly site visitors" },
    ],
  },

  preview: {
    title: "A peek at a giveaway post",
    note: "A sample giveaway post. When brands share a day, every one of them is featured and tagged.",
    /** A sample card, so it shows a sample day number. */
    sampleDay: "5",
    cardDayLine: "Day {day} of 25 Days of Louisiana Giveaways 🎄",
    cardSponsorLine: "Featuring: YOUR BRAND HERE!",
    logoPlaceholder: "Your logo",
    caption:
      "🎁 GIVEAWAY TIME! Today's giveaway features YOUR BRAND HERE, a Louisiana favorite. Entry details coming soon on our Facebook page. Good luck, y'all! ⚜️",
  },

  sponsorWall: {
    title: "Brands already joining the fun!",
  },

  /**
   * The final lineup (owner 2026-11-16: "each person will have their own day" is no longer true; some days have
   * two or three brands, each with its own winner). Source: the owner's 25 Days Sponsor Tracker (const S and D); owner 2026-11-17: every sponsor who said yes by
   * email or Facebook is listed on their tracker day. Owner 2026-11-18 (nothing stale anywhere): lineup.days is exactly
   * the tracker's calendar (109 giveaways as of 2026-11-17 11:20 PM). Check drift with `node scripts/check-25days-lineup.mjs`,
   * regenerate with `--print` (manual; never in CI).
   * Business names, prizes and Facebook Page links ONLY: never a contact person's name, email or phone (this page and repo are public).
   */
  lineup: {
    title: "The lineup",
    intro: "The Louisiana businesses and brands giving away prizes this December. Tap a name to visit their page.",
    // Owner 2026-11-17: shown under the intro and by the sign-up day picker (claim.daysNote), and in the FAQ.
    daysNote: "Days may still change as the calendar fills up. We'll confirm each brand's final day before December 1.",
    /** Phone only: the list opens with its first few partners and this button. */
    showAll: "Show all {n} partners",
    /**
     * Owner 2026-11-19: "We can link their facebooks or website for people to reach out." Each business name links to
     * its Facebook Page, from the tracker's `h.fb` (const S). A business page only: never a contact's email or phone.
     */
    links: {
"homerunPET": "https://www.facebook.com/Homerunpet",
      "RYSE": "https://www.facebook.com/RYSESupps",
      "CMI Entertainment: A Christmas Carol": "https://www.facebook.com/profile.php?id=100064790676343",
      "Oil Center (Lafayette Festival of Lights)": "https://www.facebook.com/oilcenter",
      "Faith & Fire BBQ": "https://www.facebook.com/profile.php?id=100093226599423",
      "Boston Mints": "https://www.facebook.com/BostonMints",
      "World Ballet Company: The Nutcracker": "https://www.facebook.com/WorldBalletCompany",
      "The Fois": "https://www.facebook.com/davidrabalaisfilm/",
      "Cher Bebe Embroidery": "https://www.facebook.com/profile.php?id=61589742615756",
      "Manta Sleep": "https://www.facebook.com/mantasleep",
      "Crabtrap Functional Fitness": "https://www.facebook.com/profile.php?id=61575510953985",
      "RoseMae Eimear Creations": "https://www.facebook.com/profile.php?id=100089280845471",
      "K18 Hair": "https://www.facebook.com/k18hair",
      "Megan Benoit's Closet": "https://www.facebook.com/profile.php?id=100095652008390",
      "Britt Creates": "https://www.facebook.com/profile.php?id=100092393785790",
      "Oyu Botanica": "https://www.facebook.com/OYUBotanica",
      "R&R Wedding Co.": "https://www.facebook.com/profile.php?id=61589566719811",
      "IOKA Skin+Science": "https://www.facebook.com/iokaskinscience",
      "Mystic Forests Nursery": "https://www.facebook.com/profile.php?id=61561396051654",
      "Whimsies from Within": "https://www.facebook.com/profile.php?id=61593916496429",
      "Rock Bottom Golf": "https://www.facebook.com/rockbottomgolf",
      "Ripley's Crawfish": "https://www.facebook.com/profile.php?id=61571086266228",
      "Written on the River": "https://www.facebook.com/writtenontheriver",
      "Timeless Skin Care": "https://www.facebook.com/timelesshaskin/",
      "Let's Create LLC": "https://www.facebook.com/letscreatellc",
      "GentleStyle Brush (CLM Creations)": "https://www.facebook.com/gentlestylebrush",
      "IDRA Wellness": "https://www.facebook.com/idrawellnessforyou",
      "Rip Van Winkle Gardens": "https://www.facebook.com/rvwgardens",
      "SRI Labs": "https://www.facebook.com/SRIBeautyLabs",
      "Hello Darlin'": "https://www.facebook.com/profile.php?id=61596204632534",
      "The Sculpt Society": "https://www.facebook.com/sculptsociety",
      "Crew Dog": "https://www.facebook.com/profile.php?id=100092617234356",
      "Aeva Beauty": "https://www.facebook.com/Aevabeautyllc",
      "The Humble Home Decor & Candles": "https://www.facebook.com/profile.php?id=61591928826991",
      "Zydeco Chop Chop": "https://www.facebook.com/ZydecoChopChop",
      "3 Redneck Tenors": "https://www.facebook.com/profile.php?id=100063637686864",
      "LMNT": "https://www.facebook.com/drinkLMNT",
      "Dolly's Boutique": "https://www.facebook.com/shopgirldolly",
      "HOTWORX Baton Rouge (Millerville)": "https://www.facebook.com/hotworxbatonrougemillerville",
      "Basic Bee": "https://www.facebook.com/basicbeeshop",
      "Hannahbelle Photography": "https://www.facebook.com/profile.php?id=61570091493348",
      "Tushbaby": "https://www.facebook.com/TushBabyShop/",
      "Dupuy's Abbeville": "https://www.facebook.com/dupuys",
      "Salty Cat": "https://www.facebook.com/saltycattreats",
      "The Soft Life Collective": "https://www.facebook.com/profile.php?id=61594580516352",
      "Bourque's Cajun Country Seasoning": "https://www.facebook.com/profile.php?id=100069299407902",
      "Tiffany Morton Cosmetic Tattooing": "https://www.facebook.com/profile.php?id=61591561239859",
      "Hilma": "https://www.facebook.com/HILMA.CO",
      "Playtopia Lafayette": "https://www.facebook.com/playtopialafayette",
      "Grand Kyiv Ballet: Swan Lake (Symphony of Lights)": "https://www.facebook.com/grandkyivballet",
    } as Record<string, string>,
    /**
     * INTERNAL ONLY (owner rule 2026-11-17: "don't tell sponsors their day until it's final"): the page never shows
     * which day a brand is on. The Lineup renders an undated A-Z list of brands and prizes; these days feed only the
     * sign-up calendar's brand counts (ClaimSection tileCount).
     */
    days: [
      {
        day: 1,
        partners: [
          { brand: "homerunPET", prize: "Pet-friendly space heater (PH20)" },
          { brand: "RYSE", prize: "A 12-pack of RYSE Fuel ($30)" },
          { brand: "CMI Entertainment: A Christmas Carol", prize: "Family four-pack to A Christmas Carol, Strand Theatre Shreveport, Dec 6" },
          { brand: "Oil Center (Lafayette Festival of Lights)", prize: "Tickets to the Festival of Lights" },
          { brand: "Faith & Fire BBQ", prize: "Bible" },
        ],
      },
      {
        day: 2,
        partners: [
          { brand: "Boston Mints", prize: "One lip gloss each day" },
          { brand: "RYSE", prize: "A 12-pack of RYSE Fuel ($30)" },
          { brand: "World Ballet Company: The Nutcracker", prize: "Pair of Nutcracker tickets, Strand Theatre Shreveport, Dec 8" },
          { brand: "The Fois", prize: "The Fois t-shirt (winner size) + koozie" },
          { brand: "Cher Bebe Embroidery", prize: "Tea towel of choice" },
        ],
      },
      {
        day: 3,
        partners: [
          { brand: "District 2 Alderman", prize: "$25 Shucks gift card" },
          { brand: "RYSE", prize: "A 12-pack of RYSE Fuel ($30)" },
          { brand: "Manta Sleep", prize: "Manta PRO Sleep Mask" },
          { brand: "Crabtrap Functional Fitness", prize: "Free month membership" },
          { brand: "RoseMae Eimear Creations", prize: "Soap bar or bath soak (winner picks)" },
        ],
      },
      {
        day: 4,
        partners: [
          { brand: "K18 Hair", prize: "K18 FutureIQ" },
          { brand: "RYSE", prize: "A 12-pack of RYSE Fuel ($30)" },
          { brand: "Megan Benoit's Closet", prize: "$30 gift card" },
          { brand: "Kate McLeod", prize: "One Daily Stone (body moisturizer)" },
          { brand: "Britt Creates", prize: "Resume refresh" },
        ],
      },
      {
        day: 5,
        partners: [
          { brand: "Oyu Botanica", prize: "Winter Radiance Duo stocking stuffer (one each day)" },
          { brand: "RYSE", prize: "A 12-pack of RYSE Fuel ($30)" },
          { brand: "R&R Wedding Co.", prize: "Day-of wedding coordination discount" },
          { brand: "Breads and Sweets by Babs", prize: "$25 gift certificate" },
        ],
      },
      {
        day: 6,
        partners: [
          { brand: "IOKA Skin+Science", prize: "$50 gift card" },
          { brand: "RYSE", prize: "A 12-pack of RYSE Fuel ($30)" },
          { brand: "Mystic Forests Nursery", prize: "5-gallon Rising Sun redbud" },
          { brand: "Rusty's Seasoning", prize: "Seasoning bundle" },
        ],
      },
      {
        day: 7,
        partners: [
          { brand: "Whimsies from Within", prize: "Mixed media wall hanging ($130)" },
          { brand: "RYSE", prize: "A 12-pack of RYSE Fuel ($30)" },
          { brand: "Rock Bottom Golf", prize: "$50 Rock Bottom Golf gift card" },
          { brand: "Ripley's Crawfish", prize: "$100 gift card" },
        ],
      },
      {
        day: 8,
        partners: [
          { brand: "RYSE", prize: "A 12-pack of RYSE Fuel ($30)" },
          { brand: "Written on the River", prize: "Tumbler with her Louisiana design" },
          { brand: "Timeless Skin Care", prize: "Skincare package" },
          { brand: "The Fois", prize: "Toy Magnalite pot" },
        ],
      },
      {
        day: 9,
        partners: [
          { brand: "RYSE", prize: "A 12-pack of RYSE Fuel ($30)" },
          { brand: "Let's Create LLC", prize: "Permanent jewelry stainless steel bracelet" },
          { brand: "The Fois", prize: "Roux spoon + Roundhouse Ya Maw Maw seasoning" },
        ],
      },
      {
        day: 10,
        partners: [
          { brand: "GentleStyle Brush (CLM Creations)", prize: "GentleStyle Brush" },
          { brand: "RYSE", prize: "A 12-pack of RYSE Fuel ($30)" },
          { brand: "Handmade By Hayli", prize: "Hair glitter" },
          { brand: "Bake & Brush", prize: "Bake & Brush gift card" },
        ],
      },
      {
        day: 11,
        partners: [
          { brand: "Boston Mints", prize: "One lip gloss each day" },
          { brand: "RYSE", prize: "A 12-pack of RYSE Fuel ($30)" },
          { brand: "IDRA Wellness", prize: "Body lotion" },
        ],
      },
      {
        day: 12,
        partners: [
          { brand: "Oyu Botanica", prize: "Winter Radiance Duo stocking stuffer (one each day)" },
          { brand: "RYSE", prize: "A 12-pack of RYSE Fuel ($30)" },
          { brand: "Summar T. Photography", prize: "15-minute mini session (winner messages Summar T. Photography to book)" },
          { brand: "RoseMae Eimear Creations", prize: "Candle (winner picks scent)" },
          { brand: "Rip Van Winkle Gardens", prize: "Gift certificate: 2 house tours" },
        ],
      },
      {
        day: 13,
        partners: [
          { brand: "SRI Labs", prize: "DryQ blow dryer" },
          { brand: "RYSE", prize: "A 12-pack of RYSE Fuel ($30)" },
          { brand: "Hello Darlin'", prize: "Sweet Hello Package: free 2-hr vintage audio guest book rental ($125)" },
          { brand: "Kee's Pretty Little Things", prize: "Prize to be announced" },
        ],
      },
      {
        day: 14,
        partners: [
          { brand: "The Sculpt Society", prize: "Workout membership for a mama" },
          { brand: "Crew Dog", prize: "Cream LSU Teddy Embroidered Crewneck, size L" },
          { brand: "Aeva Beauty", prize: "$25 e-gift card" },
          { brand: "The Humble Home Decor & Candles", prize: "Prize to be announced" },
        ],
      },
      {
        day: 15,
        partners: [
          { brand: "RYSE", prize: "A 12-pack of RYSE Fuel ($30)" },
          { brand: "Britt Creates", prize: "Headshot session" },
          { brand: "Zydeco Chop Chop", prize: "Seasoning gift basket" },
          { brand: "Proof & Pour Wax Co.", prize: "8 oz candle + wax melt (one set each day)" },
        ],
      },
      {
        day: 16,
        partners: [
          { brand: "SRI Labs", prize: "KeeWee shampoo" },
          { brand: "RYSE", prize: "A 12-pack of RYSE Fuel ($30)" },
          { brand: "3 Redneck Tenors", prize: "Pair of tickets, Feb 26 2027, Strand Theatre Shreveport" },
          { brand: "Custom wreath sashes", prize: "Prize to be announced" },
        ],
      },
      {
        day: 17,
        partners: [
          { brand: "Cajun Belle Studio", prize: "Alligator earrings" },
          { brand: "LMNT", prize: "LMNT Variety Pack (ships to winner)" },
          { brand: "Bayou Grace Outfitters", prize: "T-shirt (winner picks design + size)" },
          { brand: "Dolly's Boutique", prize: "Faux fur collar wrap cape coat (one size)" },
        ],
      },
      {
        day: 18,
        partners: [
          { brand: "Boston Mints", prize: "One lip gloss each day" },
          { brand: "RYSE", prize: "A 12-pack of RYSE Fuel ($30)" },
          { brand: "HOTWORX Baton Rouge (Millerville)", prize: "1 month free membership" },
          { brand: "Basic Bee", prize: "Prize to be announced" },
        ],
      },
      {
        day: 19,
        partners: [
          { brand: "Ty's Boutique Shop", prize: "Women's two-piece set, winner's choice ($30)" },
          { brand: "RYSE", prize: "A 12-pack of RYSE Fuel ($30)" },
          { brand: "Hannahbelle Photography", prize: "Free 20-minute photoshoot" },
          { brand: "Tushbaby", prize: "2-in-1 Convertible Carrier (winner picks color)" },
        ],
      },
      {
        day: 20,
        partners: [
          { brand: "RYSE", prize: "A 12-pack of RYSE Fuel ($30)" },
          { brand: "Cher Bebe Embroidery", prize: "Custom wreath sash" },
          { brand: "Dupuy's Abbeville", prize: "$25 gift certificate" },
          { brand: "Salty Cat", prize: "Salty Cat treat bundle (cat treats)" },
          { brand: "Rip Van Winkle Gardens", prize: "$50 café gift certificate" },
        ],
      },
      {
        day: 21,
        partners: [
          { brand: "The Soft Life Collective", prize: "Giving Book Bundle (3 books)" },
          { brand: "RYSE", prize: "A 12-pack of RYSE Fuel ($30)" },
          { brand: "Bourque's Cajun Country Seasoning", prize: "Gift basket" },
          { brand: "Rusty's Seasoning", prize: "Seasoning bundle" },
        ],
      },
      {
        day: 22,
        partners: [
          { brand: "LMNT", prize: "LMNT Variety Pack (ships to winner)" },
          { brand: "RYSE", prize: "A 12-pack of RYSE Fuel ($30)" },
          { brand: "Krazy Bull Kreations", prize: "$25 shop credit (freshies)" },
          { brand: "Bashi", prize: "Gift card for their new products launching in January" },
          { brand: "Handmade By Hayli", prize: "Car diffuser" },
        ],
      },
      {
        day: 23,
        partners: [
          { brand: "Tiffany Morton Cosmetic Tattooing", prize: "Gift certificate: service of choice" },
          { brand: "Faith & Fire BBQ", prize: "Seasoning + t-shirt" },
          { brand: "Bashi", prize: "Gift card for their new products launching in January" },
          { brand: "Mary Kay", prize: "Mary Kay gift set" },
          { brand: "IDRA Wellness", prize: "Body oil" },
        ],
      },
      {
        day: 24,
        partners: [
          { brand: "LMNT", prize: "LMNT Variety Pack (ships to winner)" },
          { brand: "Hilma", prize: "Daily Pre + Probiotic + Herbs" },
          { brand: "Playtopia Lafayette", prize: "1Play Package (1 child): sand play, soft play, book nook, RC Racetrack 30 min, RC Digger Pit 30 min, Lizard Wall 15 min" },
          { brand: "Bashi", prize: "Gift card for their new products launching in January" },
          { brand: "K18 Hair", prize: "K18 Molecular Repair Hair Mask" },
        ],
      },
      {
        day: 25,
        partners: [
          { brand: "Louisiana Helpr", prize: "$100 Louisiana Helpr gift card" },
          { brand: "Grand Kyiv Ballet: Swan Lake (Symphony of Lights)", prize: "Family four-pack: 4 tickets, The Strand Theatre Shreveport, Fri Jan 22 2027, 7 PM" },
          { brand: "Proof & Pour Wax Co.", prize: "8 oz candle + wax melt (one set each day)" },
          { brand: "Bashi", prize: "Gift card for their new products launching in January" },
        ],
      },
    ],
  },

  testimonials: {
    title: "What our sponsors say",
  },

  claim: {
    title: "Join the giveaways",
    intro: "Pick one day or as many as you like. Brands share days, and every partner is featured and tagged on our socials.",
    dayCount: { one: "{n} brand joined", many: "{n} brands joined", none: "Open" },
    full: "Full",
    /** The sign-up section has room for the full ask (owner 2026-11-18: sign-ups never close). */
    deadline: "Please sign up by Sunday, November 22 so we can include you in the full lineup.",
    daysNote: "Days may still change as the calendar fills up. We'll confirm each brand's final day before December 1.",
    anyDay: "Any day is fine",
    selectedNone: "Pick at least one day, or tick the any-day box.",
    form: {
      brandName: "Brand name",
      contactName: "Your name",
      email: "Email",
      phone: "Phone (optional)",
      website: "Website (optional)",
      instagram: "Instagram (optional)",
      facebook: "Facebook (optional)",
      tiktok: "TikTok (optional)",
      prizeDescription: "Prize description",
      prizeDescriptionHint: "e.g. a candle gift set, a $50 gift card, a holiday bundle",
      logo: "Logo (optional)",
      logoHint: "PNG, JPG or SVG, up to 5 MB",
      // Owner 11-17: four ways to get the prize to the winner; shipping to us stays the first, easiest choice.
      shipTo: "Ship your prize to",
      shipAddress: "Louisiana Helpr, 314 Lynn Street, Delcambre, LA 70528",
      delivery: {
        legend: "How will your prize get to the winner?",
        /** Written into the sign-up's notes for the two choices ship_to cannot name. */
        noteLine: "Prize delivery: {option}",
        thankYou: "Prize delivery:",
        options: [
          { value: "helpr", label: "Ship or drop off to Louisiana Helpr (easiest)", hint: "314 Lynn Street, Delcambre, LA 70528. We deliver it to the winner." },
          { value: "winner", label: "Ship straight to the winner", hint: "We send you the winner's name and shipping address within 24 hours of the drawing. Please ship within a week and send us a photo of the prize for the post." },
          { value: "digital", label: "Email a digital gift card", hint: "To us or straight to the winner." },
          { value: "pickup", label: "Local pickup (will call)", hint: "The winner picks it up from you." },
        ],
      },
      notes: "Anything else? (optional)",
      agree: "I agree to provide the prize(s) I described for my giveaway day(s)",
      showOnWall: "OK to show our logo on the sponsor wall",
      submit: "Count Me In 🎁",
      submitting: "Sending…",
    },
    errors: {
      required: "This one's required.",
      email: "Enter a valid email address.",
      days: "Pick at least one day, or tick the any-day box.",
      agree: "Please check this box to continue.",
      logoType: "Logos can be PNG, JPG or SVG.",
      logoSize: "That logo is over 5 MB. Try a smaller file.",
      url: "Enter a full web address that starts with https://",
      full: "Sorry, {days} just filled up. Pick another day?",
      rateLimited: "Too many tries in a short time. Please wait a few minutes and try again.",
      generic: "Something went wrong and your sign-up wasn't saved. Please try again, or email admin@louisianahelpr.com.",
    },
  },

  thankYou: {
    title: "You're in! 🎉",
    body: "We'll be in touch within 48 hours.",
    yourDays: "Your requested day(s):",
    /** Area 11b M10: days are not final until we confirm them (owner rule 11-17). */
    daysNote: "We'll confirm your final day before December 1.",
    shipTo: "Ship your prize to:",
    anyDay: "Any day — we'll pick one together.",
    calendarEventTitle: "25 Days of Louisiana Giveaways — {brand}'s giveaway day",
    calendarEventAnyDay: "25 Days of Louisiana Giveaways begins",
    calendarEventBody: "Your brand's giveaway day with Louisiana Helpr. Questions? Email admin@louisianahelpr.com.",
  },

  faq: {
    title: "Questions? We've got answers",
    items: [
      { q: "Is this really free?", a: "Yes. There's no fee to join; all we ask is a prize to give away." },
      { q: "Who can enter the giveaways?", a: "[Louisiana residents 18+ — confirm]. Full details are in the Official Giveaway Rules." },
      { q: "How is the winner picked?", a: "At random from eligible entries, and announced publicly on our Facebook page and group." },
      { q: "How does the prize get to the winner?", a: "Your choice, four easy ways. 1) Easiest: ship it or drop it off to us at 314 Lynn Street, Delcambre, LA 70528, and we deliver it to the winner. 2) Ship it straight to the winner: we send you their name and shipping address within 24 hours of the drawing, you ship within a week, and you send us a photo of the prize for the post. 3) Email a digital gift card, to us or to the winner. 4) Local pickup: the winner picks it up from you." },
      { q: "Can I sponsor more than one day?", a: "Absolutely! Days may still change as the calendar fills up. We'll confirm each brand's final day before December 1." },
      { q: "Can more than one brand be on the same day?", a: "Yes. Some days have two or three brands, and each brand's prize has its own winner. Every partner is featured and tagged on our socials." },
      { q: "What if I have more questions?", a: "Email us at admin@louisianahelpr.com. A real person replies." },
      { q: "Is this affiliated with Facebook?", a: "No. This giveaway is in no way sponsored, endorsed or administered by, or associated with, Facebook/Meta." },
    ],
  },

  finalCta: {
    title: "Let's make this Louisiana's merriest December yet. 🎄⚜️",
    button: "Join the Giveaways",
  },

  footer: {
    brand: "Louisiana Helpr",
    based: "Based in Delcambre, Louisiana",
    pageLink: "Facebook Page",
    groupLink: "Facebook Group",
    rulesLink: "Official Giveaway Rules",
    privacyLink: "Privacy Policy",
    giftGuidesLink: "Holiday Gift Guides",
  },

  rules: {
    /** Set to true ONLY after the owner has reviewed every section and no [placeholder] is left. */
    // Shown to visitors instead of the rules while they are still a draft (owner 11-10).
    pendingNote: "The official rules for 25 Days of Louisiana Giveaways will be posted here before the first giveaway on December 1. Questions? Email admin@louisianahelpr.com.",
    approved: false,
    draftBanner: "DRAFT – review before publishing",
    title: "Official giveaway rules",
    subtitle: "25 Days of Louisiana Giveaways · December 1–25, 2026",
    backLink: "Back to the sponsor page",
    sections: [
      {
        heading: "No purchase necessary",
        body: "NO PURCHASE NECESSARY TO ENTER OR WIN. A purchase does not increase your chances of winning. Void where prohibited.",
      },
      {
        heading: "Who can enter",
        body: "Open to legal residents of [Louisiana] who are [18] years of age or older at the time of entry. Employees of Louisiana Helpr and of the sponsor of a given day, and their immediate family members, may not win that day's prize. [Confirm eligibility.]",
      },
      {
        heading: "Entry period",
        body: "Each day's giveaway opens when its post is published on that day between December 1 and December 25, 2026, and closes at [TIME] Central Time [on the following day]. Entries received after the close are not eligible.",
      },
      {
        heading: "How to enter",
        body: "Follow the steps in the official entry post on the Louisiana Helpr Facebook page. Automated or bulk entries are void.",
      },
      {
        heading: "How winners are chosen and notified",
        body: "One winner per sponsor per day is selected at random from all eligible entries within [24 hours] after the entry period closes. The winner is announced publicly on the Louisiana Helpr Facebook page and group and contacted by [Facebook message]. A winner who does not respond within [48 hours] forfeits the prize and an alternate winner may be selected at random.",
      },
      {
        heading: "Prizes and fulfillment",
        body: "Each prize is provided by that day's sponsor, and its description and approximate retail value are stated in the giveaway post. The sponsor delivers the prize in one of these ways: by shipping or dropping it off to Louisiana Helpr, which delivers it to the winner; by shipping it directly to the winner; by emailing a digital gift card to Louisiana Helpr or the winner; or by local pickup, where the winner picks it up from the sponsor. The winner's name and shipping address are shared with that day's sponsor only to deliver the prize, and are not used for anything else. Prizes are not transferable and no cash substitute is offered except at the sponsor's discretion. Winners are responsible for any taxes on their prize. [Confirm fulfillment terms.]",
      },
      {
        heading: "Facebook release",
        body: "This giveaway is in no way sponsored, endorsed or administered by, or associated with, Facebook or Meta. By entering, you release Facebook and Meta from any and all liability related to this giveaway. You are providing your information to Louisiana Helpr and the day's sponsor, not to Facebook.",
      },
      {
        heading: "General",
        body: "Louisiana Helpr may disqualify any entry it finds fraudulent or in violation of these rules, and may cancel or modify a giveaway if it cannot run as planned. Sponsor: [Louisiana Helpr legal name and address].",
      },
      {
        heading: "Questions",
        body: "Email admin@louisianahelpr.com.",
      },
    ],
  },
} as const;
