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
    /**
     * Last day to sign up (Louisiana time). After it the sign-up form is replaced by `claim.closed`, and the
     * sponsor-25days function refuses new sign-ups too (SPONSOR_SIGNUP_DEADLINE in
     * supabase/functions/_shared/sponsorSignup.ts must say the same date; src/test/sponsor25days.test.tsx checks).
     */
    signup_deadline: "2026-11-28",
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
    headlineLead: "You're Invited!",
    headline: "25 Days of Louisiana Giveaways",
    subhead:
      "Join the giveaways this December and get your brand in front of Louisiana families shopping for the holidays.",
    primaryCta: "Join the Giveaways 🎁",
    secondaryCta: "How It Works",
    countdownLabel: "Giveaways start in",
    countdownLive: "The giveaways are live! Day {day} of 25",
    /** Under the countdown and in the sign-up section while sign-ups are open. */
    deadline: "Sign up by Nov 28.",
    countdownUnits: { days: "days", hours: "hours", minutes: "min", seconds: "sec" },
  },

  trustStrip: [
    "Louisiana-owned & run",
    "Based in Delcambre, LA",
    "Prizes delivered to the winner by us",
    "Real local families, not bots",
  ],

  about: {
    title: "What is Louisiana Helpr?",
    body:
      "Louisiana Helpr is a homegrown community website and app built for the people of Louisiana. It's one place where neighbors can find local jobs, homes and rentals, declutter and sell, and discover local shops and businesses. Along with louisianahelpr.com, we run the Louisiana Helpr Facebook page and the Louisiana Helpr Community Facebook group, where Louisiana families connect, share and support each other every day.",
    /**
     * `href` is set only for a section that is open to everyone today. A card
     * with `href: null` shows `soonLabel` instead of a link (Homes & Rentals
     * and Shops are not open to everyone yet).
     */
    features: [
      { icon: "briefcase", title: "Jobs & Gigs", body: "Hire local help or find work near you.", href: "/jobs", soonLabel: null },
      // The section is called Homes everywhere in the app (owner 2026-10-18; src/test/homesNotRentalsInCopy.test.ts).
      { icon: "home", title: "Homes", body: "Local homes and rentals, from your neighbors.", href: null, soonLabel: "Coming soon" },
      { icon: "bag", title: "Shop & Declutter Local", body: "Buy and sell used things with Louisiana neighbors.", href: "/declutter", soonLabel: null },
    ],
    groupButton: "Visit our Facebook Group",
    pageButton: "Visit our Facebook Page",
    websiteButton: "Explore louisianahelpr.com",
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
    title: "How It Works",
    steps: [
      { icon: "calendar", title: "Pick a day", body: "Choose any day (or days!) from December 1–25. Brands share days, and each brand's prize gets its own winner." },
      { icon: "gift", title: "Tell us your prize", body: "Donate anything you'd like: a product, a gift card, a service or a bundle." },
      { icon: "sparkle", title: "We do the work", body: "We design the graphics, write and publish the posts, tag and link your brand, run the entries and pick a winner at random." },
      { icon: "chart", title: "Your brand shines", body: "A Louisiana neighbor wins your prize, and local families see your brand." },
    ],
  },

  brandGets: {
    title: "What Your Brand Gets",
    items: [
      { icon: "star", title: "Featured on our socials", body: "Your brand and prize featured in the giveaway post on your day, alongside any other brands that share it." },
      { icon: "link", title: "Tags & links everywhere", body: "Your brand tagged and linked on our Facebook page, our group and our website." },
      { icon: "heart", title: "Real local engagement", body: "Louisiana families commenting, sharing and following, right in the middle of holiday shopping." },
      { icon: "wall", title: "Featured on our sponsor wall", body: "Your logo on the 25 Days page all month, linked to your site." },
    ],
  },

  whatWeAsk: {
    title: "What We Ask",
    body:
      "Donate a prize, anything you'd like (a product, a gift card, a service or a bundle), dropped off or shipped to us in Delcambre. That's it. We handle the graphics, the posts and picking the winner.",
  },

  reach: {
    title: "Our Reach",
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
    title: "A Peek at a Giveaway Post",
    note: "A sample giveaway post. When brands share a day, every one of them is featured and tagged.",
    /** A sample card, so it shows a sample day number. */
    sampleDay: "5",
    cardDayLine: "Day {day} of 25 Days of Louisiana Giveaways 🎄",
    cardSponsorLine: "Featuring: YOUR BRAND HERE!",
    logoPlaceholder: "Your logo",
    caption:
      "🎁 GIVEAWAY TIME! Today's giveaway features YOUR BRAND HERE, a Louisiana favorite. To enter: like this post, comment your favorite holiday tradition and share it with a friend. A winner is picked at random tomorrow. Good luck, y'all! ⚜️",
  },

  sponsorWall: {
    title: "Brands already joining the fun!",
  },

  /**
   * The final lineup (owner 2026-11-16: "each person will have their own day" is no longer true; some days have
   * two or three brands, each with its own winner). Source: the owner's 25 Days Sponsor Tracker (const S and D).
   * Brand names and prizes ONLY: never a sponsor's contact name, email or phone (this page and repo are public).
   */
  lineup: {
    title: "The Lineup",
    intro: "25 days, one giveaway post a day. When brands share a day, each prize has its own winner, and every partner is featured and tagged on our socials.",
    winners: "{n} winners",
    days: [
      { day: 1, partners: [{ brand: "homerunPET", prize: "Pet-friendly space heater" }] },
      { day: 2, partners: [{ brand: "Boston Mints", prize: "Lip gloss" }] },
      { day: 3, partners: [{ brand: "Tevin Lewis, District 2 Alderman", prize: "$25 Shucks gift card" }] },
      { day: 4, partners: [{ brand: "K18 Hair", prize: "FutureIQ + Molecular Repair Hair Mask" }] },
      { day: 5, partners: [{ brand: "Oyu Botanica", prize: "Winter stocking stuffers" }] },
      { day: 6, partners: [{ brand: "IOKA Skin+Science", prize: "$50 gift card" }] },
      { day: 7, partners: [{ brand: "Whimsies from Within", prize: "Mixed media wall hanging" }] },
      { day: 8, partners: [{ brand: "Candle Bloom Confections", prize: "Candle flower bouquet" }] },
      { day: 9, partners: [{ brand: "Peigneur Property Rentals", prize: "$25 gift card" }] },
      { day: 10, partners: [{ brand: "GentleStyle Brush", prize: "GentleStyle Brush" }] },
      { day: 11, partners: [{ brand: "Boston Mints", prize: "Lip gloss" }] },
      { day: 12, partners: [{ brand: "Oyu Botanica", prize: "Winter stocking stuffers" }] },
      { day: 13, partners: [{ brand: "SRI Labs", prize: "DryQ blow dryer" }] },
      {
        day: 14,
        partners: [
          { brand: "Aeva Beauty", prize: "$25 e-gift card" },
          { brand: "The Sculpt Society", prize: "Workout membership for a mama" },
        ],
      },
      { day: 15, partners: [{ brand: "Berkana Crystal", prize: "Crystal piece" }] },
      { day: 16, partners: [{ brand: "SRI Labs", prize: "KeeWee shampoo" }] },
      {
        day: 17,
        partners: [
          { brand: "Cajun Belle Studio", prize: "Alligator earrings" },
          { brand: "RYSE", prize: "RYSE Fuel bundle" },
          { brand: "LMNT", prize: "LMNT Variety Pack" },
        ],
      },
      {
        day: 18,
        partners: [
          { brand: "Boston Mints", prize: "Lip gloss" },
          { brand: "RYSE", prize: "RYSE Fuel bundle" },
        ],
      },
      { day: 19, partners: [{ brand: "Ty's Boutique Shop", prize: "Women's two-piece set, winner's choice" }] },
      { day: 20, partners: [{ brand: "Pass the Everything", prize: "Family meal / dining experience" }] },
      { day: 21, partners: [{ brand: "The Soft Life Collective", prize: "Giving Book Bundle (3 books)" }] },
      {
        day: 22,
        partners: [
          { brand: "RYSE", prize: "RYSE Fuel bundle" },
          { brand: "LMNT", prize: "LMNT Variety Pack" },
        ],
      },
      { day: 23, partners: [{ brand: "Tiffany Morton Cosmetic Tattooing", prize: "Gift certificate for a service of choice" }] },
      {
        day: 24,
        partners: [
          { brand: "RYSE", prize: "RYSE Fuel bundle" },
          { brand: "LMNT", prize: "LMNT Variety Pack" },
          { brand: "Hilma", prize: "Daily Pre + Probiotic + Herbs" },
        ],
      },
      { day: 25, partners: [{ brand: "Louisiana Helpr", prize: "$100 Louisiana Helpr gift card" }] },
    ],
  },

  testimonials: {
    title: "What Our Sponsors Say",
  },

  claim: {
    title: "Join the Giveaways",
    intro: "Pick one day or as many as you like. Brands share days, and every partner is featured and tagged on our socials.",
    dayCount: { one: "{n} brand joined", many: "{n} brands joined", none: "Open" },
    full: "Full",
    deadline: "Sign up by Nov 28.",
    /** Shown in place of the calendar and form after signup_deadline. */
    closedTitle: "Sign-ups are closed",
    closed: "Sign-ups for the 25 Days of Louisiana Giveaways closed on November 28. Thank you to every brand that joined! Questions? Email admin@louisianahelpr.com.",
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
      // Owner 11-09: every prize ships to Louisiana Helpr; the form shows the address instead of asking.
      shipTo: "Ship your prize to",
      shipAddress: "Louisiana Helpr, 314 Lynn Street, Delcambre, LA 70528",
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
      closed: "Sign-ups closed on November 28, so this one was not saved. Questions? Email admin@louisianahelpr.com.",
      generic: "Something went wrong and your sign-up was NOT saved. Please try again, or email admin@louisianahelpr.com.",
    },
  },

  thankYou: {
    title: "You're in! 🎉",
    body: "We'll be in touch within 48 hours.",
    yourDays: "Your day(s):",
    shipTo: "Ship your prize to:",
    anyDay: "Any day — we'll pick one together.",
    addToCalendar: "Add to calendar",
    calendarEventTitle: "25 Days of Louisiana Giveaways — {brand}'s giveaway day",
    calendarEventAnyDay: "25 Days of Louisiana Giveaways begins",
    calendarEventBody: "Your brand's giveaway day with Louisiana Helpr. Questions? Email admin@louisianahelpr.com.",
  },

  faq: {
    title: "Questions? We've Got Answers",
    items: [
      { q: "Is this really free?", a: "Yes. There's no fee to join; all we ask is a prize to give away." },
      { q: "Who can enter the giveaways?", a: "[Louisiana residents 18+ — confirm]. Full details are in the Official Giveaway Rules." },
      { q: "How is the winner picked?", a: "At random from eligible entries, and announced publicly on our Facebook page and group." },
      { q: "How does the prize get to the winner?", a: "Ship it straight to the winner (we send you their shipping info), or send it to us and we handle delivery." },
      { q: "Can I sponsor more than one day?", a: "Absolutely!" },
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
    title: "Official Giveaway Rules",
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
        body: "Follow the entry steps listed in that day's giveaway post on the Louisiana Helpr Facebook page or group, for example [like the post, comment, and share]. Limit [one entry per person per day]. Automated or bulk entries are void.",
      },
      {
        heading: "How winners are chosen and notified",
        body: "One winner per sponsor per day is selected at random from all eligible entries within [24 hours] after the entry period closes. The winner is announced publicly on the Louisiana Helpr Facebook page and group and contacted by [Facebook message]. A winner who does not respond within [48 hours] forfeits the prize and an alternate winner may be selected at random.",
      },
      {
        heading: "Prizes and fulfillment",
        body: "Each prize is provided by that day's sponsor, and its description and approximate retail value are stated in the giveaway post. The sponsor ships the prize directly to the winner, or to Louisiana Helpr for delivery. Prizes are not transferable and no cash substitute is offered except at the sponsor's discretion. Winners are responsible for any taxes on their prize. [Confirm fulfillment terms.]",
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
