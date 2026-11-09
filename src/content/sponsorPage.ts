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
  meta: {
    title: "25 Days of Louisiana Giveaways — Sponsor a Day | Louisiana Helpr",
    description:
      "Claim your day this December and get your brand in front of Louisiana families shopping for the holidays. Free to join, no fees or contracts.",
    rulesTitle: "Official Giveaway Rules — 25 Days of Louisiana Giveaways",
    rulesDescription: "Official rules for the 25 Days of Louisiana Giveaways on Louisiana Helpr, December 1–25, 2026.",
  },

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
  },

  hero: {
    /** Shown only when ?ref= matches a brand added in /admin/sponsors. {brand} is that brand's name. */
    greeting: "Hey {brand}! 🎄 We'd love to have you.",
    eyebrow: "December 1–25 · Louisiana",
    headlineLead: "You're Invited!",
    headline: "25 Days of Louisiana Giveaways",
    subhead:
      "Claim your day this December and get your brand in front of Louisiana families shopping for the holidays.",
    primaryCta: "Claim Your Day 🎁",
    secondaryCta: "How It Works",
    countdownLabel: "Giveaways start in",
    countdownLive: "The giveaways are live! Day {day} of 25",
    countdownUnits: { days: "days", hours: "hours", minutes: "min", seconds: "sec" },
  },

  trustStrip: [
    "Louisiana-owned & run",
    "Based in Delcambre, LA",
    "Free to join, no fees or contracts",
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
      { icon: "home", title: "Homes & Rentals", body: "Local homes and rentals, from your neighbors.", href: null, soonLabel: "Coming soon" },
      { icon: "bag", title: "Shop & Declutter Local", body: "Buy and sell used things with Louisiana neighbors.", href: "/declutter", soonLabel: null },
    ],
    groupButton: "Visit our Facebook Group",
    pageButton: "Visit our Facebook Page",
    websiteButton: "Explore louisianahelpr.com",
  },

  founder: {
    title: "Hi, I'm Lexi! 👋",
    // The photo is uploaded in /admin/sponsors. Until then no photo frame shows.
    photoAlt: "Lexi, founder of Louisiana Helpr",
    /** One entry per sentence group: an entry holding a [placeholder] is hidden until filled. */
    paragraphs: [
      "I'm the founder of Louisiana Helpr, and I live right here in Delcambre, Louisiana, on the Iberia–Vermilion Parish line.",
      "I'm a local small business owner myself [I own and manage rental properties in the area], so I know how hard it is to get your name in front of the right people.",
      "I started Louisiana Helpr because [YOUR REASON, e.g. I wanted one place where Louisiana people could help each other find work, homes and great local businesses].",
      "25 Days of Louisiana Giveaways is my way of saying thank you to our community this Christmas, and of shining a big, bright spotlight on the brands that make Louisiana special.",
      "When you sign up, you're working directly with me, a real person who will answer your emails.",
    ],
    signature: "— Lexi, Founder, Louisiana Helpr",
  },

  howItWorks: {
    title: "How It Works",
    steps: [
      { icon: "calendar", title: "Pick your day", body: "Choose any day (or days!) from December 1–25. Multiple brands can share a day." },
      { icon: "gift", title: "Tell us your prize", body: "A product, gift card or bundle, any value you like." },
      { icon: "sparkle", title: "We do the work", body: "We design the graphics, write and publish the posts, tag and link your brand, run the entries and pick a winner at random." },
      { icon: "chart", title: "You get the results", body: "The winner gets your prize, and you get a recap of how your day performed." },
    ],
  },

  brandGets: {
    title: "What Your Brand Gets",
    items: [
      { icon: "star", title: "Your own spotlight", body: "A featured giveaway post on your day." },
      { icon: "link", title: "Tags & links everywhere", body: "Your brand tagged and linked on our Facebook page, our group and our website." },
      { icon: "heart", title: "Real local engagement", body: "Louisiana families commenting, sharing and following, right in the middle of holiday shopping." },
      { icon: "chart", title: "A results recap", body: "After your day we send you [reach, comments, shares, entries and screenshots]." },
      { icon: "wall", title: "Featured on our sponsor wall", body: "Your logo on the 25 Days page all month, linked to your site." },
    ],
  },

  whatWeAsk: {
    title: "What We Ask",
    body:
      "Just one prize for one winner (a product, gift card or bundle, your choice of value), shipped to the winner or to us. That's it. No fees, no contracts, no catch. We handle the graphics, posts, picking the winner and the recap.",
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
    title: "A Peek at Your Spotlight",
    note: "A sample of the kind of post your brand gets on its day.",
    /** A sample card, so it shows a sample day number. */
    sampleDay: "5",
    cardDayLine: "Day {day} of 25 Days of Louisiana Giveaways 🎄",
    cardSponsorLine: "Today's sponsor: YOUR BRAND HERE!",
    logoPlaceholder: "Your logo",
    caption:
      "🎁 GIVEAWAY TIME! Today's prize comes from YOUR BRAND HERE, a Louisiana favorite. To enter: like this post, comment your favorite holiday tradition and share it with a friend. A winner is picked at random tomorrow. Good luck, y'all! ⚜️",
  },

  sponsorWall: {
    title: "Brands already joining the fun!",
  },

  testimonials: {
    title: "What Our Sponsors Say",
  },

  claim: {
    title: "Claim Your Day",
    intro: "Pick one day or as many as you like. More than one brand can share a day, and every sponsor gets their own spotlight post.",
    dayCount: { one: "{n} brand joined", many: "{n} brands joined", none: "Open" },
    full: "Full",
    anyDay: "Any day is fine",
    selectedNone: "Pick at least one day, or choose “Any day is fine”.",
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
      prizeValue: "Approximate prize value ($)",
      logo: "Logo (optional)",
      logoHint: "PNG, JPG or SVG, up to 5 MB",
      shipTo: "Ship the prize to",
      shipToWinner: "The winner directly",
      shipToHelpr: "Louisiana Helpr",
      notes: "Anything else? (optional)",
      agree: "I agree to provide one prize per giveaway day I sign up for",
      showOnWall: "OK to show our logo on the sponsor wall",
      submit: "Claim My Day 🎁",
      submitting: "Sending…",
    },
    errors: {
      required: "This one's required.",
      email: "Enter a valid email address.",
      days: "Pick at least one day, or choose “Any day is fine”.",
      prizeValue: "Enter a dollar amount, like 50.",
      agree: "Please check this box to continue.",
      logoType: "Logos can be PNG, JPG or SVG.",
      logoSize: "That logo is over 5 MB. Try a smaller file.",
      url: "Enter a full web address, like https://yourbrand.com.",
      full: "Sorry, {days} just filled up. Pick another day?",
      rateLimited: "Too many tries in a short time. Please wait a few minutes and try again.",
      generic: "Something went wrong and your sign-up was NOT saved. Please try again, or email admin@louisianahelpr.com.",
    },
  },

  thankYou: {
    title: "You're in! 🎉",
    body: "Lexi will be in touch within 48 hours.",
    yourDays: "Your day(s):",
    anyDay: "Any day — we'll pick one together.",
    addToCalendar: "Add to calendar",
    calendarEventTitle: "25 Days of Louisiana Giveaways — {brand}'s giveaway day",
    calendarEventAnyDay: "25 Days of Louisiana Giveaways begins",
    calendarEventBody: "Your brand's giveaway day with Louisiana Helpr. Questions? Email admin@louisianahelpr.com.",
  },

  faq: {
    title: "Questions? We've Got Answers",
    items: [
      { q: "Is this really free?", a: "Yes. There's no fee to join; all we ask is one prize for one winner." },
      { q: "Who can enter the giveaways?", a: "[Louisiana residents 18+ — confirm]. Full details are in the Official Giveaway Rules." },
      { q: "How is the winner picked?", a: "At random from eligible entries, and announced publicly on our Facebook page and group." },
      { q: "How does the prize get to the winner?", a: "Ship it straight to the winner (we send you their shipping info), or send it to us and we handle delivery." },
      { q: "Can I sponsor more than one day?", a: "Absolutely!" },
      { q: "Can more than one brand be on the same day?", a: "Yes, and every sponsor gets their own spotlight post." },
      { q: "What do I get afterward?", a: "A recap of your day: [reach, engagement, entries, screenshots]." },
      { q: "What if I have more questions?", a: "Email Lexi at admin@louisianahelpr.com. A real person replies." },
      { q: "Is this affiliated with Facebook?", a: "No. This giveaway is in no way sponsored, endorsed or administered by, or associated with, Facebook/Meta." },
    ],
  },

  finalCta: {
    title: "Let's make this Louisiana's merriest December yet. 🎄⚜️",
    button: "Claim Your Day",
  },

  footer: {
    brand: "Louisiana Helpr",
    based: "Based in Delcambre, Louisiana",
    pageLink: "Facebook Page",
    groupLink: "Facebook Group",
    rulesLink: "Official Giveaway Rules",
    privacyLink: "Privacy Policy",
  },

  rules: {
    /** Set to true ONLY after the owner has reviewed every section and no [placeholder] is left. */
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

export type SponsorPageContent = typeof sponsorPage;
