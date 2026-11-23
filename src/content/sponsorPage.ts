/**
 * 25 Days of Louisiana Giveaways: EVERY word on /sponsor and /25days lives in
 * this one file (owner spec 2026-11-09). Edit the text here; nothing else needs
 * to change.
 *
 * NO RULES ON THE WEBSITE (owner 2026-11-21: "All the rules will be on Facebook
 * not our website."). How to enter and the official rules live only on the
 * Facebook post; /25days says so in one line and /25days/rules redirects to
 * /25days (vercel.json + src/App.tsx). Never add an entry method or a rule here
 * (src/test/twentyFiveDaysRulesOnFacebook.test.tsx).
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
 */
import { LOUISIANA_HELPR_FACEBOOK } from "./giftGuideConstants";

export const sponsorPage = {
  // The browser-tab title, search description and link-preview text are NOT here: they live in
  // src/lib/publicPageMeta.mjs (PUBLIC_PAGE_META "/25days", NOINDEX_PAGE_META "/sponsor"), the one table the
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
    facebookPage: LOUISIANA_HELPR_FACEBOOK,
    // UNKNOWN: the "Visit our Facebook Group" buttons stay hidden until this is a real URL.
    facebookGroup: "[FACEBOOK GROUP URL]",
    email: "admin@louisianahelpr.com",
    privacy: "/privacy",
    // Owner 2026-11-16: the Holiday gift guides page, linked from this page's footer.
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
    countdownLabel: "Giveaways start in",
    countdownLive: "The giveaways are live! Day {day} of 25",
    /**
     * Under the countdown (short: the hero has little room). Owner 2026-11-18: sign-ups never close; we only ask
     * brands to sign up by Sunday, November 22 so they make the full lineup.
     */
    deadline: "Sign up by Sunday, Nov 22. Late sponsors welcome!",
    countdownUnits: { days: "days", hours: "hours", minutes: "min", seconds: "sec" },
  },

  /**
   * /25days, the page for PEOPLE ENTERING (owner 2026-11-19: "most people will see it from Facebook traffic"). The
   * brand pitch and sign-up form live on /sponsor only. Never say HOW to enter here, and no rules (owner 2026-11-21:
   * "All the rules will be on Facebook not our website."): the button opens the entry post (sponsor_settings.entry_url,
   * else the Facebook Page).
   */
  entrant: {
    headlineLead: "Free to enter!",
    /**
     * Opens where people enter. WHERE it goes is not in this file: the iOS app bundles this code, so the link lives in
     * the database, sponsor_settings.entry_url (20261119200128), and changes with no app build. Until it is set, the
     * button opens links.facebookPage.
     */
    subhead: "Every day from December 1 to 25, Louisiana businesses are giving away gifts to Louisiana neighbors.",
    enterCta: "Entry details on our Facebook page",
    sponsorsCta: "See the sponsors",
    /** The one line about entering (owner 2026-11-21): the entry method and the rules are on the Facebook post only. */
    rulesOnFacebook: "How to enter and the official rules are on our Facebook post.",
    businessAsk: "Are you a Louisiana business?",
    businessLink: "Become a sponsor →",
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
   * the tracker's calendar (176 giveaways as of 2026-11-20 6:45 PM; 175 after the owner dropped one Dec 5 sponsor on 2026-11-20). Check drift with `node scripts/check-25days-lineup.mjs`,
   * regenerate with `--print` (manual; never in CI).
   * Business names, prizes and Facebook Page links ONLY: never a contact person's name, email or phone (this page and repo are public).
   * Owner 2026-11-19: three sponsors show by their own name (David Rabalais; Tevin Lewis, District 2 Alderman, linked to his own page;
   * Haylie Rudisill · Custom wreath sashes). The allowlist is PUBLIC_NAMES in scripts/check-25days-lineup.mjs.
   */
  lineup: {
    title: "This year's sponsors",
    intro: "The Louisiana businesses and brands giving away prizes this December. Tap a name to visit their page.",
    // Owner 2026-11-17: shown under the intro and by the sign-up day picker (claim.daysNote), and in the FAQ.
    daysNote: "Days may still change as the calendar fills up. We'll confirm each brand's final day before December 1.",
    /** Phone only: the list opens with its first few sponsors and this button. */
    showAll: "Show all {n} sponsors",
    /**
     * Owner 2026-11-19: "We can link their facebooks or website for people to reach out." Each business name links to
     * its Facebook Page, from the tracker's `h.fb` (const S). A business page only: never a contact's email or phone.
     */
    links: {
      "3 Redneck Tenors": "https://www.facebook.com/profile.php?id=100063637686864",
      "Active Beauty": "https://www.facebook.com/RealActiveBeauty/",
      "Aeva Beauty": "https://www.facebook.com/Aevabeautyllc",
      "AllWays Lounge & Cabaret (New Orleans)": "https://www.facebook.com/TheAllWaysLoungeAndCabaret",
      "aosu": "https://www.facebook.com/aosulife",
      "Arey": "https://www.facebook.com/areygrey",
      "Basic Bee": "https://www.facebook.com/basicbeeshop",
      "Beaver's Abundance": "https://www.facebook.com/Beaversabundance",
      "Boston Mints": "https://www.facebook.com/BostonMints",
      "Botanical Nail and Skin Studio": "https://www.facebook.com/BotanicalNailandSkinStudio",
      "Britt Creates": "https://www.facebook.com/profile.php?id=100092393785790",
      "Candle Bloom Confections": "https://www.facebook.com/profile.php?id=61560992382547",
      "Cat 5 Fishing Charters (Lake Charles)": "https://www.facebook.com/CaptBradleyLaningham",
      "Cat Lady / CatLadyBox": "https://www.facebook.com/catladybox/",
      "Cher Bebe Embroidery": "https://www.facebook.com/profile.php?id=61589742615756",
      "City Sightseeing New Orleans": "https://www.facebook.com/CitySightseeingNewOrleans",
      "CMI Entertainment: A Christmas Carol": "https://www.facebook.com/profile.php?id=100064790676343",
      "Crabtrap Functional Fitness": "https://www.facebook.com/profile.php?id=61575510953985",
      "Crew Dog": "https://www.facebook.com/profile.php?id=100092617234356",
      "Criquet Shirts": "https://www.facebook.com/criquetshirts",
      "Deming Delights": "https://www.facebook.com/profile.php?id=61555440822423",
      "Dolly's Boutique": "https://www.facebook.com/shopgirldolly",
      "Dupuy's Abbeville": "https://www.facebook.com/dupuys",
      "Faith & Fire BBQ": "https://www.facebook.com/profile.php?id=100093226599423",
      "Faulk's Game Call Co.": "https://www.facebook.com/Faulkcalls",
      "Forgiven Hearts": "https://www.facebook.com/forgivenheartsllc",
      "GentleStyle Brush (CLM Creations)": "https://www.facebook.com/gentlestylebrush",
      "God's Country RV Resort": "https://streamsideparks.com/gods-country-resort-shreveport-la/",
      "Grand Kyiv Ballet: Swan Lake (Symphony of Lights)": "https://www.facebook.com/grandkyivballet",
      "Hannahbelle Photography": "https://www.facebook.com/profile.php?id=61570091493348",
      "Hello Darlin'": "https://www.facebook.com/profile.php?id=61596204632534",
      "Hilma": "https://www.facebook.com/HILMA.CO",
      "homerunPET": "https://www.facebook.com/Homerunpet",
      "HOTWORX Denham Springs": "https://www.facebook.com/HOTWORXDenhamSprings",
      "IDRA Wellness": "https://www.facebook.com/idrawellnessforyou",
      "IOKA Skin+Science": "https://www.facebook.com/iokaskinscience",
      "Jessica Lanham Photography": "https://www.facebook.com/jessicalanhamphotography",
      "K18 Hair": "https://www.facebook.com/k18hair",
      "Le Petit Theatre (New Orleans)": "https://www.facebook.com/LePetitNOLA",
      "Let's Create LLC": "https://www.facebook.com/letscreatellc",
      "LMNT": "https://www.facebook.com/drinkLMNT",
      "Manta Sleep": "https://www.facebook.com/mantasleep",
      "Megan Benoit's Closet": "https://www.facebook.com/profile.php?id=100095652008390",
      "Mystic Forests Nursery": "https://www.facebook.com/profile.php?id=61561396051654",
      "Oyu Botanica": "https://www.facebook.com/OYUBotanica",
      "Paddlewheeler Creole Queen (New Orleans)": "https://www.facebook.com/PaddlewheelerCreoleQueen/",
      "Playtopia Lafayette": "https://www.facebook.com/playtopialafayette",
      "Rip Van Winkle Gardens": "https://www.facebook.com/rvwgardens",
      "Ripley's Crawfish": "https://www.facebook.com/profile.php?id=61571086266228",
      "Rock Bottom Golf": "https://www.facebook.com/rockbottomgolf",
      "RoseMae Eimear Creations": "https://www.facebook.com/profile.php?id=100089280845471",
      "RYSE": "https://www.facebook.com/RYSESupps",
      "Salty Cat": "https://www.facebook.com/saltycattreats",
      "Saranoni": "https://www.facebook.com/saranoniblanket",
      "SRI Labs": "https://www.facebook.com/SRIBeautyLabs",
      "Suzi Marques Photography": "https://www.facebook.com/suzimarquesphotography",
      "David Rabalais": "https://www.facebook.com/davidrabalaisfilm/",
      // Owner 2026-11-19: "just link to his personal page" (the tracker's h.fb for Tevin Lewis).
      "Tevin Lewis, District 2 Alderman": "https://www.facebook.com/profile.php?id=61562244154656",
      "The Sculpt Society": "https://www.facebook.com/sculptsociety",
      "The Soft Life Collective": "https://www.facebook.com/profile.php?id=61594580516352",
      "Tiffany Morton Cosmetic Tattooing": "https://www.facebook.com/profile.php?id=61591561239859",
      "Timeless Skin Care": "https://www.facebook.com/timelesshaskin/",
      "Tufted Artworks": "https://www.facebook.com/TuftedArtworks",
      "Tushbaby": "https://www.facebook.com/TushBabyShop/",
      "Whimsies from Within": "https://www.facebook.com/profile.php?id=61593916496429",
      // Consistency audit 1122 #10: her public page (Wanderlust by Abby, Baton Rouge), found 11-22.
      "Wanderlust by Abby": "https://www.facebook.com/wanderlustbyabby",
      "Wicks NOLA Candle Company": "https://www.facebook.com/wicksnola504",
      "World Ballet Company: The Nutcracker": "https://www.facebook.com/WorldBalletCompany",
      "Written on the River": "https://www.facebook.com/writtenontheriver",
      "Zydeco Chop Chop": "https://www.facebook.com/ZydecoChopChop",
      // Holiday audit C4 (11-20): the names that had no link get the website they gave on the sign-up form
      // (sponsor_signups.website), else the Facebook or Instagram page from the form or the tracker's h.fb / h.ig.
      // Still none (no business page found yet): Breads and Sweets by Babs, Bake & Brush, Summar T. Photography,
      // Haylie Rudisill, Bayou Grace Outfitters, Barclell Photography, Louisiana Helpr (us). Lead 11-22: Mary Kay
      // links the consultant's page and Ace Bungee Fitness its booking page (no IG or FB found for them).
      "Ace Bungee Fitness": "https://calendly.com/acebungeefitness",
      "Mary Kay": "https://www.instagram.com/crystalfakier/",
      "Bashi": "https://www.drinkbashi.com/",
      "Cajun Belle Studio": "https://www.instagram.com/cajunbellestudio/",
      "Celebration Station (Baton Rouge)": "https://www.facebook.com/CelebrationStationBatonRougeLA/",
      "Everyday Dose": "https://www.instagram.com/everydaydose/",
      "FELCO North America": "https://america.felco.com/",
      "Hair Fashion and Spa (Opelousas)": "https://www.facebook.com/profile.php?id=100090986499631",
      "Handmade By Hayli": "https://www.handmadebyhayli.com/",
      "Kate McLeod": "https://www.instagram.com/katemcleod/",
      "Krazy Bull Kreations": "https://www.instagram.com/krazybullkreations/",
      "Mind the Skin Labs": "https://mindtheskinlabs.com/",
      "Monarch Books (Baton Rouge)": "https://www.instagram.com/monarchbooksbr/",
      "Olivia Grace Photography": "https://www.instagram.com/oliviagracephotography.24/",
      "Phyllis Guy Dance Center": "https://www.facebook.com/danceatpgdc",
      "Proof & Pour Wax Co.": "https://www.instagram.com/proofpourwaxco/",
      "Sky & Sol": "https://www.instagram.com/skyandsolco/",
      "Sprinkle in Time Too (Sulphur)": "https://www.facebook.com/profile.php?id=61575637593930",
      "Tays Sweet Shop": "https://www.tayssweets.org/",
      "The Crab Man Plus": "https://thecrabmanplus.com/",
      "Ty's Boutique Shop": "https://tysboutiqueshop.bigcartel.com/",
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
          { brand: "Olivia Grace Photography", prize: "One-hour photo session, up to 2 outfits, 30+ edited images" },
          { brand: "RYSE", prize: "A 12-pack of RYSE Fuel ($30)" },
          { brand: "CMI Entertainment: A Christmas Carol", prize: "Family four-pack to A Christmas Carol, Strand Theatre Shreveport, Dec 6" },
          { brand: "Rip Van Winkle Gardens", prize: "Gift certificate: 2 house tours + $50 café gift certificate" },
          { brand: "Paddlewheeler Creole Queen (New Orleans)", prize: "Dinner Jazz Cruise for a party of two" },
          { brand: "Le Petit Theatre (New Orleans)", prize: "One pair of tickets to THE SECRET GARDEN (runs Dec 3–27, 2026)" },
        ],
      },
      {
        day: 2,
        partners: [
          { brand: "Texas Beard Company", prize: "Beard Oil + Balm, winner's choice of scents" },
          { brand: "RYSE", prize: "A 12-pack of RYSE Fuel ($30)" },
          { brand: "World Ballet Company: The Nutcracker", prize: "Pair of Nutcracker tickets, Strand Theatre Shreveport, Dec 8" },
          { brand: "Cher Bebe Embroidery", prize: "Tea towel of choice + custom wreath sash" },
          { brand: "Wicks NOLA Candle Company", prize: "8 oz scented candle" },
          { brand: "Suzi Marques Photography", prize: "Family mini session on Sun Dec 20 at Moncus Park, Lafayette: 15 minutes of photography + 8 professionally edited digital images (one per winner; 6 winners)" },
          { brand: "Dupuy's Abbeville", prize: "$25 gift certificate" },
        ],
      },
      {
        day: 3,
        partners: [
          { brand: "Tevin Lewis, District 2 Alderman", prize: "$25 Shucks gift card" },
          { brand: "RYSE", prize: "A 12-pack of RYSE Fuel ($30)" },
          { brand: "Crabtrap Functional Fitness", prize: "Free month membership" },
          { brand: "Bake & Brush", prize: "Bake & Brush gift card" },
          { brand: "Everyday Dose", prize: "Coffee+ 15-serving + Medium Roast Coffee+ + Matcha+ + ~12 Matcha+ samples" },
          { brand: "Birdwell's", prize: "$50 gift card" },
          { brand: "Suzi Marques Photography", prize: "Family mini session on Sun Dec 20 at Moncus Park, Lafayette: 15 minutes of photography + 8 professionally edited digital images (one per winner; 6 winners)" },
        ],
      },
      {
        day: 4,
        partners: [
          { brand: "K18 Hair", prize: "K18 FutureIQ" },
          { brand: "RYSE", prize: "A 12-pack of RYSE Fuel ($30)" },
          { brand: "Monarch Books (Baton Rouge)", prize: "Book bundle + 2 coffee mugs with stickers and bookmarks" },
          { brand: "Kate McLeod", prize: "One Daily Stone (body moisturizer)" },
          { brand: "Wicks NOLA Candle Company", prize: "8 oz scented candle" },
          { brand: "Tays Sweet Shop", prize: "$50 gift card for any shippable bakery item (one per day)" },
          { brand: "Jessica Lanham Photography", prize: "$300 photography gift certificate: covers the $100 session fee + $200 toward any package (one per winner; 4 winners)" },
        ],
      },
      {
        day: 5,
        partners: [
          { brand: "Oyu Botanica", prize: "Winter Radiance Duo stocking stuffer (one each day)" },
          { brand: "RYSE", prize: "A 12-pack of RYSE Fuel ($30)" },
          { brand: "Breads and Sweets by Babs", prize: "$25 gift certificate" },
          { brand: "FELCO North America", prize: "FELCO 2 pruner + FELCO 910 holster" },
          { brand: "AllWays Lounge & Cabaret (New Orleans)", prize: "Gift certificate: 2 show tickets + 2 free cocktails" },
          { brand: "Jessica Lanham Photography", prize: "$300 photography gift certificate: covers the $100 session fee + $200 toward any package (one per winner; 4 winners)" },
        ],
      },
      {
        day: 6,
        partners: [
          { brand: "IOKA Skin+Science", prize: "$50 gift card" },
          { brand: "RYSE", prize: "A 12-pack of RYSE Fuel ($30)" },
          { brand: "Mystic Forests Nursery", prize: "5-gallon Rising Sun redbud" },
          { brand: "homerunPET", prize: "Pet-friendly space heater (PH20)" },
          { brand: "Perfectly Planned Events", prize: "A custom event invitation + a decor shopping list for your budget" },
          { brand: "Jessica Lanham Photography", prize: "$300 photography gift certificate: covers the $100 session fee + $200 toward any package (one per winner; 4 winners)" },
          { brand: "Haylie Rudisill · Custom wreath sashes", prize: "Santa wreath sash" },
        ],
      },
      {
        day: 7,
        partners: [
          { brand: "RYSE", prize: "A 12-pack of RYSE Fuel ($30)" },
          { brand: "Ace Bungee Fitness", prize: "Private bungee fitness party for 6" },
          { brand: "Wicks NOLA Candle Company", prize: "8 oz scented candle" },
          { brand: "Mind the Skin Labs", prize: "1 pack Signal (pre-flare patch) + 1 pack Surge (active-flare patch)" },
          { brand: "Suzi Marques Photography", prize: "Family mini session on Sun Dec 20 at Moncus Park, Lafayette: 15 minutes of photography + 8 professionally edited digital images (one per winner; 6 winners)" },
          { brand: "Cat 5 Fishing Charters (Lake Charles)", prize: "$100 gift card toward a fishing charter trip" },
        ],
      },
      {
        day: 8,
        partners: [
          { brand: "RYSE", prize: "A 12-pack of RYSE Fuel ($30)" },
          { brand: "Timeless Skin Care", prize: "Skincare package" },
          { brand: "Written on the River", prize: "Mug or tile with her Louisiana design" },
          { brand: "Tays Sweet Shop", prize: "$50 gift card for any shippable bakery item (one per day)" },
          { brand: "Active Beauty", prize: "B.Skin Tight marine collagen + electrolyte drink" },
          { brand: "Candle Bloom Confections", prize: "Candle flower bouquet" },
          { brand: "God's Country RV Resort", prize: "One-night stay in a Conestoga Glamping Wagon at God's Country RV Resort, Shreveport (sleeps 4: king bed + twin bunks, climate control, mini fridge, microwave, Keurig; covered patio, private fire pit + grill; bathhouse nearby)" },
        ],
      },
      {
        day: 9,
        partners: [
          { brand: "RYSE", prize: "A 12-pack of RYSE Fuel ($30)" },
          { brand: "Let's Create LLC", prize: "Permanent jewelry stainless steel bracelet" },
          { brand: "CHIC by dmo", prize: "Deep Cleanse Scalp Scrub + Hand and Body Wash" },
          { brand: "Suzi Marques Photography", prize: "Family mini session on Sun Dec 20 at Moncus Park, Lafayette: 15 minutes of photography + 8 professionally edited digital images (one per winner; 6 winners)" },
          { brand: "City Sightseeing New Orleans", prize: "Two 3-Day Hop-On Hop-Off Passes + Guided Walking Tours of the Garden District and French Quarter" },
          { brand: "Ripley's Crawfish", prize: "$25 gift certificate" },
        ],
      },
      {
        day: 10,
        partners: [
          { brand: "Wicks NOLA Candle Company", prize: "8 oz scented candle" },
          { brand: "RYSE", prize: "A 12-pack of RYSE Fuel ($30)" },
          { brand: "GentleStyle Brush (CLM Creations)", prize: "GentleStyle Brush" },
          { brand: "Restore Hyper Wellness Mandeville", prize: "10 wellness sessions (cryo, infrared sauna, red light, compression)" },
          { brand: "Everyday Dose", prize: "Coffee+ 15-serving + Medium Roast Coffee+ + Matcha+ + ~12 Matcha+ samples" },
          { brand: "RoseMae Eimear Creations", prize: "Soap bar or bath soak (winner picks) + candle (winner picks scent)" },
        ],
      },
      {
        day: 11,
        partners: [
          { brand: "Boston Mints", prize: "One lip gloss each day" },
          { brand: "RYSE", prize: "A 12-pack of RYSE Fuel ($30)" },
          { brand: "aosu", prize: "Aosu IndoorCam P1 Pro" },
          { brand: "Beaver's Abundance", prize: "$50 gift card (plants only)" },
          { brand: "Celebration Station (Baton Rouge)", prize: "Family Four Fun Pack: unlimited attractions for four people" },
          { brand: "Ripley's Crawfish", prize: "$25 gift certificate" },
          { brand: "Suzi Marques Photography", prize: "Family mini session on Sun Dec 20 at Moncus Park, Lafayette: 15 minutes of photography + 8 professionally edited digital images (one per winner; 6 winners)" },
        ],
      },
      {
        day: 12,
        partners: [
          { brand: "Criquet Shirts", prize: "$150 Criquet gift certificate" },
          { brand: "RYSE", prize: "A 12-pack of RYSE Fuel ($30)" },
          { brand: "Oyu Botanica", prize: "Winter Radiance Duo stocking stuffer (one each day)" },
          { brand: "Tree Frogs Adventure Park", prize: "2 Tree Top Adventure Course (aerial) tickets" },
          { brand: "Tays Sweet Shop", prize: "$50 gift card for any shippable bakery item (one per day)" },
          { brand: "IDRA Wellness", prize: "Body lotion + body oil" },
          { brand: "Suzi Marques Photography", prize: "Family mini session on Sun Dec 20 at Moncus Park, Lafayette: 15 minutes of photography + 8 professionally edited digital images (one per winner; 6 winners)" },
        ],
      },
      {
        day: 13,
        partners: [
          { brand: "SRI Labs", prize: "DryQ blow dryer + KeeWee shampoo" },
          { brand: "RYSE", prize: "A 12-pack of RYSE Fuel ($30)" },
          { brand: "The Crab Man Plus", prize: "Seasoning + tumbler" },
          { brand: "Faulk's Game Call Co.", prize: "CA-11 Cane Duck Call" },
          { brand: "Cajun Belle Studio", prize: "Alligator earrings" },
          { brand: "Hello Darlin'", prize: "Sweet Hello Package: free 2-hr vintage audio guest book rental ($125)" },
        ],
      },
      {
        day: 14,
        partners: [
          { brand: "Crew Dog", prize: "Cream LSU Teddy Embroidered Crewneck, size L" },
          { brand: "Aeva Beauty", prize: "$25 e-gift card" },
          { brand: "Deming Delights", prize: "16 oz candle + mystery 6-pack of wax melts" },
          { brand: "The Sculpt Society", prize: "Workout membership for a mama" },
          { brand: "Everyday Dose", prize: "Coffee+ 15-serving + Medium Roast Coffee+ + Matcha+ + ~12 Matcha+ samples" },
          { brand: "Rock Bottom Golf", prize: "$50 Rock Bottom Golf gift card" },
        ],
      },
      {
        day: 15,
        partners: [
          { brand: "RYSE", prize: "A 12-pack of RYSE Fuel ($30)" },
          { brand: "Zydeco Chop Chop", prize: "Seasoning gift basket" },
          { brand: "Sky & Sol", prize: "1 full-size tube of sunscreen" },
          { brand: "Wanderlust by Abby", prize: "Private after-hours shopping party at Wanderlust by Abby (Baton Rouge): 6+ guests, 6:30-8:30 PM, 25% off the whole store, drinks + bites; winner 21+; winner texts Abby to set the date" },
          { brand: "Cat Lady / CatLadyBox", prize: "$60 digital gift card (Cat Lady Box or catlady.com items)" },
          { brand: "Whimsies from Within", prize: "Mixed media wall hanging ($130)" },
          { brand: "Britt Creates", prize: "Resume refresh + headshot session" },
        ],
      },
      {
        day: 16,
        partners: [
          { brand: "RYSE", prize: "A 12-pack of RYSE Fuel ($30)" },
          { brand: "GoodWolf Power Yoga", prize: "5 Class Pass (yoga, barre or any fitness class)" },
          { brand: "Handmade By Hayli", prize: "Hair glitter + car diffuser" },
          { brand: "Tays Sweet Shop", prize: "$50 gift card for any shippable bakery item (one per day)" },
          { brand: "3 Redneck Tenors", prize: "Pair of tickets, Feb 26 2027, Strand Theatre Shreveport" },
          { brand: "Sprinkle in Time Too (Sulphur)", prize: "2 free sundaes (redeem at the shop in Sulphur, LA)" },
          { brand: "Forgiven Hearts", prize: "$25 gift certificate" },
        ],
      },
      {
        day: 17,
        partners: [
          { brand: "Dolly's Boutique", prize: "Faux fur collar wrap cape coat (one size)" },
          { brand: "LMNT", prize: "LMNT Variety Pack (ships to winner)" },
          { brand: "Bayou Grace Outfitters", prize: "T-shirt (winner picks design + size)" },
          { brand: "Wicks NOLA Candle Company", prize: "8 oz scented candle" },
          { brand: "Mind the Skin Labs", prize: "1 pack Signal + 1 pack Surge" },
          { brand: "Accesorios Para Niñas", prize: "$50 of girls' hair accessories" },
          { brand: "Jessica Lanham Photography", prize: "$300 photography gift certificate: covers the $100 session fee + $200 toward any package (one per winner; 4 winners)" },
        ],
      },
      {
        day: 18,
        partners: [
          { brand: "Boston Mints", prize: "One lip gloss each day" },
          { brand: "RYSE", prize: "A 12-pack of RYSE Fuel ($30)" },
          { brand: "Basic Bee", prize: "Flavored honey cube gift set + a large bourbon honey" },
          { brand: "Saranoni", prize: "Saranoni Patterned Faux Fur Throw (Clove)" },
          { brand: "Megan Benoit's Closet", prize: "$30 gift card" },
          { brand: "Wanderlust by Abby", prize: "Private after-hours shopping party at Wanderlust by Abby (Baton Rouge): 6+ guests, 6:30-8:30 PM, 25% off the whole store, drinks + bites; winner 21+; winner texts Abby to set the date" },
          { brand: "BIME Beauty", prize: "3-brush set (scalp therapy + self-cleaning brushes)" },
        ],
      },
      {
        day: 19,
        partners: [
          { brand: "Ty's Boutique Shop", prize: "Women's two-piece set, winner's choice ($30)" },
          { brand: "RYSE", prize: "A 12-pack of RYSE Fuel ($30)" },
          { brand: "Hannahbelle Photography", prize: "Free 20-minute photoshoot" },
          { brand: "aosu", prize: "Aosu IndoorCam P1 Pro" },
          { brand: "Everyday Dose", prize: "Coffee+ 15-serving + Medium Roast Coffee+ + Matcha+ + ~12 Matcha+ samples" },
          { brand: "Tushbaby", prize: "2-in-1 Convertible Carrier (winner picks color)" },
          { brand: "Manta Sleep", prize: "Manta PRO Sleep Mask" },
        ],
      },
      {
        day: 20,
        partners: [
          { brand: "RYSE", prize: "A 12-pack of RYSE Fuel ($30)" },
          { brand: "Proof & Pour Wax Co.", prize: "8 oz candle + wax melt (one set each day)" },
          { brand: "Tiffany Morton Cosmetic Tattooing", prize: "Gift certificate: service of choice" },
          { brand: "Krazy Bull Kreations", prize: "$25 shop credit (freshies)" },
          { brand: "Salty Cat", prize: "Salty Cat starter pack bundle + Salty Cat tote bag" },
          { brand: "Tays Sweet Shop", prize: "$50 gift card for any shippable bakery item (one per day)" },
        ],
      },
      {
        day: 21,
        partners: [
          { brand: "RYSE", prize: "A 12-pack of RYSE Fuel ($30)" },
          { brand: "The Soft Life Collective", prize: "Giving Book Bundle (3 books)" },
          { brand: "David Rabalais", prize: "The Fois t-shirt (winner size) + koozie + toy Magnalite pot + roux spoon + Roundhouse Ya Maw Maw seasoning" },
          { brand: "Boston Mints", prize: "One lip gloss each day" },
          { brand: "Cajun Fiya", prize: "A case of Cajun Fiya seasoning" },
          { brand: "Phyllis Guy Dance Center", prize: "One month of kids' dance classes (1 class a week; winner picks ballet, tap, jazz, hip hop, modern or musical theatre)" },
          { brand: "Ripley's Crawfish", prize: "$25 gift certificate" },
        ],
      },
      {
        day: 22,
        partners: [
          { brand: "LMNT", prize: "LMNT Variety Pack (ships to winner)" },
          { brand: "RYSE", prize: "A 12-pack of RYSE Fuel ($30)" },
          { brand: "Botanical Nail and Skin Studio", prize: "$50 gift card toward any service" },
          { brand: "Bashi", prize: "Gift card for their new products launching in January" },
          { brand: "Barclell Photography", prize: "Family photo sitting + 11x14 wall portrait" },
          { brand: "Wanderlust by Abby", prize: "Private after-hours shopping party at Wanderlust by Abby (Baton Rouge): 6+ guests, 6:30-8:30 PM, 25% off the whole store, drinks + bites; winner 21+; winner texts Abby to set the date" },
          { brand: "Ripley's Crawfish", prize: "$25 gift certificate" },
        ],
      },
      {
        day: 23,
        partners: [
          { brand: "Bashi", prize: "Gift card for their new products launching in January" },
          { brand: "Jaboom Baits", prize: "Jaboom hat + shirt + 15 packs of soft plastic baits" },
          { brand: "Hilma", prize: "Daily Pre + Probiotic + Herbs" },
          { brand: "Mary Kay", prize: "Mary Kay gift set" },
          { brand: "Hair Fashion and Spa (Opelousas)", prize: "$25 gift card" },
          { brand: "Arey", prize: "Arey The System (hair serum + supplements, 1-month supply)" },
          { brand: "Faith & Fire BBQ", prize: "Bible + seasoning + t-shirt" },
        ],
      },
      {
        day: 24,
        partners: [
          { brand: "LMNT", prize: "LMNT Variety Pack (ships to winner)" },
          { brand: "Tays Sweet Shop", prize: "$50 gift card for any shippable bakery item (one per day)" },
          { brand: "Tufted Artworks", prize: "Handmade tufted fleur de lis Mardi Gras rug, ready to hang on the wall (~30 x 20 in.)" },
          { brand: "Bashi", prize: "Gift card for their new products launching in January" },
          { brand: "K18 Hair", prize: "K18 Molecular Repair Hair Mask" },
          { brand: "Playtopia Lafayette", prize: "1Play Package (1 child): sand play, soft play, book nook, RC Racetrack 30 min, RC Digger Pit 30 min, Lizard Wall 15 min" },
          { brand: "Summar T. Photography", prize: "15-minute mini session (winner messages Summar T. Photography to book)" },
        ],
      },
      {
        day: 25,
        partners: [
          { brand: "Louisiana Helpr", prize: "$100 Louisiana Helpr gift card" },
          { brand: "Proof & Pour Wax Co.", prize: "8 oz candle + wax melt (one set each day)" },
          { brand: "Bashi", prize: "Gift card for their new products launching in January" },
          { brand: "Mind the Skin Labs", prize: "1 pack Signal + 1 pack Surge" },
          { brand: "HOTWORX Denham Springs", prize: "1-month Sweat Basic membership + free equipment rental" },
          { brand: "Grand Kyiv Ballet: Swan Lake (Symphony of Lights)", prize: "Family four-pack: 4 tickets, The Strand Theatre Shreveport, Fri Jan 22 2027, 7 PM" },
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
    deadline: "Please sign up by Sunday, November 22 so we can include you in the full lineup. Late sponsors are always welcome.",
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
      { q: "How do people enter the giveaways?", a: "How to enter and the official rules are on our Facebook post." },
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
    privacyLink: "Privacy Policy",
    giftGuidesLink: "Holiday gift guides",
  },
} as const;
