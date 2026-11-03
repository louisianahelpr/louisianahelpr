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
    description: "I need help assembling [furniture item] at my home in [neighborhood]. It's from [store or brand] and the box is [# of boxes].",
    checklist: [
      "What brand / item name?",
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
  declutter_help: {
    title: "Help selling my things",
    description: "Looking for help photographing and listing [number] items from my [home/garage/storage] in [neighborhood/city] on Declutter.",
    checklist: [
      "About how many items, and what kinds?",
      "Where are they — house, garage, storage unit?",
      "Do any need cleaning or testing before photos?",
      "When can the Helpr come by?",
    ],
    quickTips: [],
  },
  electrical: {
    title: "Electrical work needed",
    description: "Need help with [outlet / switch / light fixture / ceiling fan] at my [home/business] in [neighborhood/city].",
    checklist: [
      "What exactly needs doing — install, replace or repair?",
      "How many outlets, switches or fixtures?",
      "Is anything sparking, buzzing or tripping the breaker?",
      "Do you already have the fixture or parts?",
      "When do you need it done?",
    ],
    quickTips: [],
  },
  plumbing: {
    title: "Plumbing help needed",
    description: "Need help with a [leak / clog / faucet / toilet / water heater] at my [home/business] in [neighborhood/city].",
    checklist: [
      "What is the problem — leak, clog, install or replace?",
      "Which room and which fixture?",
      "Is water leaking right now? Can you shut it off?",
      "Do you already have the parts or fixture?",
      "When do you need it done?",
    ],
    quickTips: [],
  },
  hvac: {
    title: "Heating or cooling help needed",
    description: "My [AC / heater / thermostat / vents] at my [home/business] in [neighborhood/city] needs [service / repair / install].",
    checklist: [
      "What is happening — not cooling, not heating, noise, leak?",
      "What kind of system — central, window unit, mini-split?",
      "About how old is the system?",
      "Do you need a filter or thermostat swapped too?",
      "When do you need it done?",
    ],
    quickTips: [],
  },
  roofing: {
    title: "Roof work needed",
    description: "Need help with my roof at my [home/shed/business] in [neighborhood/city]: [leak / missing shingles / storm damage / gutters].",
    checklist: [
      "What is the problem — leak, missing shingles, storm damage?",
      "What kind of roof — shingle, metal, flat?",
      "How many stories is the building?",
      "Is water coming inside right now?",
      "When do you need it done?",
    ],
    quickTips: [],
  },
  welding: {
    title: "Welding work needed",
    description: "Need [repair / fabrication] welding on a [gate / trailer / railing / other] in [neighborhood/city].",
    checklist: [
      "What needs welding — repair or something new?",
      "What metal is it — steel, aluminum, iron?",
      "Can it be brought to the welder, or does it stay on site?",
      "About how big is the piece or the crack?",
      "When do you need it done?",
    ],
    quickTips: [],
  },
  carpentry: {
    title: "Carpentry work needed",
    description: "Need help [building / repairing] [shelves / trim / a deck / a door frame] at my [home] in [neighborhood/city].",
    checklist: [
      "What needs building or repairing?",
      "Rough size or measurements?",
      "Do you have the wood and hardware, or should they bring them?",
      "Indoor or outdoor?",
      "When do you need it done?",
    ],
    quickTips: [],
  },
  auto_repair: {
    title: "Auto or small engine help needed",
    description: "Need help with my [car / truck / mower / generator]: [what it is doing] in [neighborhood/city].",
    checklist: [
      "Year, make and model (or the engine type)?",
      "What is it doing — won't start, noise, leak?",
      "Can it be driven or moved, or does the work happen where it sits?",
      "Do you already have the parts?",
      "When do you need it done?",
    ],
    quickTips: [],
  },
  appliance_repair: {
    title: "Appliance repair needed",
    description: "My [washer / dryer / fridge / dishwasher / oven] in [neighborhood/city] is [what it is doing].",
    checklist: [
      "Which appliance, and its brand and model?",
      "What is it doing — not starting, leaking, noise, error code?",
      "About how old is it?",
      "Is it gas or electric?",
      "When do you need it done?",
    ],
    quickTips: [],
  },
  flooring: {
    title: "Flooring or tile work needed",
    description: "Need [install / repair] of [tile / laminate / vinyl / wood] in my [room] in [neighborhood/city].",
    checklist: [
      "Which room, and about how many square feet?",
      "What flooring — tile, laminate, vinyl, wood?",
      "Does old flooring need to come up first?",
      "Do you have the flooring already, or should they bring it?",
      "When do you need it done?",
    ],
    quickTips: [],
  },
  concrete_masonry: {
    title: "Concrete or masonry work needed",
    description: "Need help with a [driveway / patio / sidewalk / brick wall / steps] at my [home] in [neighborhood/city].",
    checklist: [
      "What needs doing — pour new, repair cracks, brick or block work?",
      "About how big is the area (length and width)?",
      "Does old concrete or brick need to come out first?",
      "Can a truck or wheelbarrow reach the spot?",
      "When do you need it done?",
    ],
    quickTips: [],
  },
  fencing: {
    title: "Fence work needed",
    description: "Need [install / repair] of a [wood / chain-link / vinyl] fence at my [home] in [neighborhood/city].",
    checklist: [
      "New fence or repair? About how many feet?",
      "What kind — wood, chain-link, vinyl, metal?",
      "Any gates to add or fix?",
      "Does an old fence need to come down first?",
      "When do you need it done?",
    ],
    quickTips: [],
  },
  pressure_washing: {
    title: "Pressure washing needed",
    description: "Need pressure washing of my [driveway / house siding / deck / patio] in [neighborhood/city].",
    checklist: [
      "What needs washing — driveway, siding, deck, patio?",
      "About how big is the area?",
      "Is there an outdoor water spigot they can use?",
      "Any delicate surfaces, plants or cars nearby?",
      "When do you need it done?",
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
