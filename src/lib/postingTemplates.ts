export interface PostingTemplate {
  title: string;
  description: string;
  checklist: string[];       // "did you mention..." prompts
  quickTips: string[];       // shown below the description field
}

// Template descriptions ship with bracketed fill-ins like
// "[home/apartment/office]" or "[size]". They are starters, not postable
// copy — a job posted with them unedited reads as spam to helprs. This
// detects any leftover "[…]" token so the post flow can block until the
// poster swaps in their real details (LH-23).
const PLACEHOLDER_PATTERN = /\[[^\]]+\]/;

export function hasUnfilledPlaceholders(text: string): boolean {
  return PLACEHOLDER_PATTERN.test(text);
}

export const categoryTemplates: Record<string, PostingTemplate> = {
  cleaning: {
    title: "House cleaning needed",
    description: "Looking for help cleaning my [home/apartment/office]. The space is approximately [size] and needs [deep clean / regular maintenance / move-out cleaning].",
    checklist: [
      "How big is the space? (sq ft or # of rooms)",
      "Deep clean or regular maintenance?",
      "Any special areas — bathrooms, kitchen, windows?",
      "Do you have supplies, or should they bring their own?",
      "When do you need it done?",
    ],
    quickTips: [
      "Adding a room count helps Helprs gauge the job and apply",
      "Mention if you have pets",
    ],
  },
  yard_work: {
    title: "Yard work and lawn care needed",
    description: "Need help with yard work at my property in [neighborhood/city]. The yard is [size] and I need [mowing / trimming / leaf removal / general cleanup].",
    checklist: [
      "How large is the yard? (approximate sq ft)",
      "What specifically needs doing — mow, edge, trim, haul debris?",
      "Do you have equipment, or should they bring their own?",
      "One-time or recurring?",
    ],
    quickTips: ["Specify if it's overgrown — sets realistic expectations"],
  },
  moving: {
    title: "Moving help needed",
    description: "I'm moving [from/to] [neighborhood] and need help loading and unloading. It's a [studio/1BR/2BR/house] with approximately [N] rooms of furniture.",
    checklist: [
      "How many rooms / boxes?",
      "Any heavy items — piano, safe, gun safe?",
      "Stairs at either location?",
      "Do you have a truck, or do they need one?",
      "Exact move date and time window",
    ],
    quickTips: ["Specify stairs — it affects pricing"],
  },
  handyman: {
    title: "Handyman help needed",
    description: "I need a handyman for [describe the job] at my home in [neighborhood]. The job involves [brief description of what needs to be done].",
    checklist: [
      "What specifically needs to be fixed or installed?",
      "Any materials needed — do you have them or should they bring?",
      "Photos of the area or item (helps them size up the job)",
      "Any brand/model to match?",
    ],
    quickTips: ["Add a photo — posts with photos fill 40% faster"],
  },
  painting: {
    title: "Painting needed",
    description: "Looking for a painter for [interior/exterior] work at my home in [neighborhood]. I need [rooms/areas] painted, approximately [sq ft] total.",
    checklist: [
      "Interior or exterior (or both)?",
      "How many rooms / how many sq ft?",
      "Do you have paint, or should they supply it?",
      "Current color and desired color",
      "Any trim, ceilings, or accent walls?",
    ],
    quickTips: ["Paint color + current color helps them plan prep time"],
  },
  delivery: {
    title: "Delivery help needed",
    description: "I need help picking up and delivering [item] from [location] to [my address in neighborhood]. The item is [size/weight description].",
    checklist: [
      "What's being delivered? (size and weight)",
      "Pickup location and delivery address (neighborhood is fine)",
      "Does it need assembly at delivery?",
      "Time window for pickup and delivery",
    ],
    quickTips: [],
  },
  pet_care: {
    title: "Pet care needed",
    description: "I need someone to [walk / sit / check in on] my [dog/cat/pet] in [neighborhood]. My pet is [name], a [breed/type], [age] years old.",
    checklist: [
      "Type and breed of pet?",
      "How many pets?",
      "Walk, sitting, or drop-in visits?",
      "Any special needs — medications, anxiety, special diet?",
      "Dates and times needed",
    ],
    quickTips: ["Mention if your pet is friendly with strangers"],
  },
  assembly: {
    title: "Furniture assembly needed",
    description: "I need help assembling [furniture item] at my home in [neighborhood]. It's from [IKEA / Wayfair / Amazon / brand] and the box is [# of boxes].",
    checklist: [
      "What brand / item name? (IKEA Kallax, etc.)",
      "How many pieces?",
      "Do you have the instructions?",
      "Where in the home? (stairs involved?)",
    ],
    quickTips: ["Item name + brand = faster, better-matched applicants"],
  },
  storm_prep: {
    title: "Storm preparation help needed",
    description: "Need help preparing my home for [storm/hurricane season] in [neighborhood]. I need help with [boarding windows / generator setup / debris removal / sandbag placement].",
    checklist: [
      "What prep work is needed specifically?",
      "Do you have materials (plywood, sandbags, etc.) or do they need to get them?",
      "Single-story or multi-story?",
      "How many windows / doors to board?",
      "When do you need it done by?",
    ],
    quickTips: ["Post early — storm prep jobs fill very quickly"],
  },
  events: {
    title: "Event help needed",
    description: "Looking for help with [setup / service / cleanup] for a [type of event] in [neighborhood]. The event is on [date] from [time] to [time] at [venue type].",
    checklist: [
      "What's the event? (birthday, wedding, corporate, etc.)",
      "How many guests?",
      "What jobs — setup, serving, bartending, cleanup?",
      "Event date, start time, and expected end time",
      "Indoor or outdoor?",
    ],
    quickTips: ["Specify dress code if appearance matters"],
  },
  errands: {
    title: "Errand runner needed",
    description: "I need help running errands for me in [neighborhood/city]. Jobs include [grocery shopping / pharmacy pickup / package delivery / etc.].",
    checklist: [
      "What errands specifically?",
      "Which stores or locations?",
      "Do you provide cash/card, or will they use their own and be reimbursed?",
      "Time window you need it done",
    ],
    quickTips: [],
  },
  other: {
    title: "Help needed",
    description: "Looking for help with [describe your job] in [neighborhood]. This would involve [brief description of what needs to be done].",
    checklist: [
      "What specifically needs to be done?",
      "How long do you think it will take?",
      "Any equipment or materials needed?",
      "When do you need it done?",
    ],
    quickTips: ["More detail = better applicants and fewer questions"],
  },
};
