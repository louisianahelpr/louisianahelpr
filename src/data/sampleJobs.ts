/**
 * Sample-job templates — pre-filled example jobs shown at the top of the
 * Post-a-Task form so first-time customers know what details to include
 * and what budget is reasonable.
 *
 * Categories map 1:1 to the `job_category` enum in
 * `src/integrations/supabase/types.ts` — keep them in sync.
 *
 * Tone: practical, Louisiana-warm where natural. Not marketing-y. Each
 * description should read like a real customer wrote it.
 */

export interface SampleJob {
  /** Stable slug — used for analytics keying. Never reused. */
  id: string;
  /** Must match a `job_category` enum value. */
  category:
    | "cleaning"
    | "yard_work"
    | "moving"
    | "errands"
    | "handyman"
    | "painting"
    | "delivery"
    | "pet_care"
    | "assembly"
    | "other";
  /** Short emoji label rendered on the chip. */
  icon: string;
  /** Short, scannable title (also pre-fills the form). */
  title: string;
  /** 1–2 sentence example body the customer can edit. */
  description: string;
  /** Reasonable USD price for the job. */
  typical_price: number;
  /** Typical duration in minutes. */
  typical_duration_minutes: number;
}

export const sampleJobs: SampleJob[] = [
  {
    id: "lawn-quarter-acre",
    category: "yard_work",
    icon: "🌿",
    title: "Mow a quarter-acre lawn",
    description:
      "Standard mow plus edge along the driveway and sidewalk. Bagged or mulched, helper's choice. Mower and gas are in the shed.",
    typical_price: 45,
    typical_duration_minutes: 60,
  },
  {
    id: "mount-tv-55",
    category: "handyman",
    icon: "📺",
    title: "Mount a 55-inch TV",
    description:
      "Wall is drywall over studs in the living room. Bracket and hardware are already here. Cable management would be nice but isn't required.",
    typical_price: 65,
    typical_duration_minutes: 75,
  },
  {
    id: "deep-clean-2br",
    category: "cleaning",
    icon: "🧽",
    title: "Deep clean a 2-bedroom apartment",
    description:
      "Roughly 900 sq ft, 1 bath, no pets. Kitchen and bathroom need extra attention. Supplies are under the sink — bring a vacuum if you can.",
    typical_price: 110,
    typical_duration_minutes: 180,
  },
  {
    id: "ikea-dresser-assembly",
    category: "assembly",
    icon: "🛠️",
    title: "Assemble an IKEA dresser",
    description:
      "Six-drawer Hemnes-style dresser, still in the box. Instructions are in the bag. I've got an electric screwdriver if it helps speed things up.",
    typical_price: 55,
    typical_duration_minutes: 90,
  },
  {
    id: "couch-move-stairs",
    category: "moving",
    icon: "📦",
    title: "Help move a couch up two flights",
    description:
      "Sectional couch, two cushions and a chaise. Moving from the truck out front up to a second-floor walk-up. Should be a two-person job.",
    typical_price: 80,
    typical_duration_minutes: 60,
  },
  {
    id: "dog-walk-week",
    category: "pet_care",
    icon: "🐕",
    title: "Walk my dog this week",
    description:
      "Friendly 40-lb mutt, good on leash. Two 30-minute walks a day, Monday through Friday. Treats and harness are by the door.",
    typical_price: 175,
    typical_duration_minutes: 300,
  },
  {
    id: "grocery-pharmacy-run",
    category: "errands",
    icon: "🛒",
    title: "Grocery run and pharmacy pickup",
    description:
      "Short list of about 15 items from Rouses and a prescription pickup at Walgreens on the way back. I'll Venmo for the groceries.",
    typical_price: 35,
    typical_duration_minutes: 75,
  },
  {
    id: "paint-bedroom-12x12",
    category: "painting",
    icon: "🎨",
    title: "Paint a 12×12 bedroom",
    description:
      "Walls only, one coat over a similar color. Paint and rollers are here, walls are clean. Trim and ceiling don't need to be touched.",
    typical_price: 140,
    typical_duration_minutes: 240,
  },
  {
    id: "furniture-delivery-local",
    category: "delivery",
    icon: "🚚",
    title: "Pick up and deliver a dresser",
    description:
      "Buying a dresser off Marketplace in Metairie, need it brought to my place in Mid-City. Should fit in a small truck or SUV with the seats down.",
    typical_price: 55,
    typical_duration_minutes: 90,
  },
  {
    id: "leaf-cleanup-yard",
    category: "yard_work",
    icon: "🍂",
    title: "Rake and bag fall leaves",
    description:
      "Front and back yard, lots of oak leaves. Rake and bags are in the garage. Bags can go curbside for pickup.",
    typical_price: 60,
    typical_duration_minutes: 120,
  },
];
