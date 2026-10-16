/**
 * declutter-ai-draft, target 'shop_item' (Shops slice 2, migration
 * 20261016212915_shops_items; docs/specs/local-shops-prep.md L5-L16, L51):
 * the model's answer for a shop item, whitelisted, typed and bounded before it
 * reaches the maker's form (model output is untrusted input, the A-002 rule).
 * Dependency-free so vitest imports it (src/test/shopsItems.test.ts holds
 * SHOP_ITEM_TYPES equal to the migration's shop_item_subtypes rows).
 */
export const SHOP_ITEM_TYPES = {
  made: ["candles", "crafts", "decor", "furniture", "adult_clothing", "art"],
  home_food: ["baked_goods", "candy", "cane_syrup", "dried_mixes", "honey", "jams_jellies", "pickles", "sauces_syrups", "spices"],
  farm: ["eggs", "produce"],
} as const;

export type ShopItemKind = keyof typeof SHOP_ITEM_TYPES;
export const SHOP_ITEM_KINDS = Object.keys(SHOP_ITEM_TYPES) as ShopItemKind[];
export const SHOP_ITEM_SUBTYPES: string[] = SHOP_ITEM_KINDS.flatMap((k) => [...SHOP_ITEM_TYPES[k]]);

/**
 * What the model is told may not be listed (L11-L16, the R.S. 40:4.9 low-risk
 * list): Declutter's banned list plus the shop extras. The server's word check
 * (shop_item_text_flag) catches the same things in the maker's own words.
 */
export const SHOP_ITEM_SYSTEM_PROMPT = `You help a maker in Louisiana list ONE NEW item they made or grew in their shop on Louisiana Helpr, from photos.
Write a short, honest title (80 characters or fewer, no prices, no contact details), a plain description of what is visible (2-4 sentences), the kind and the type.
Kinds and types: made (made by the seller, new): ${SHOP_ITEM_TYPES.made.join(", ")}. home_food (made in a home kitchen, ONLY Louisiana's low-risk list, with no meat or fish in it): ${SHOP_ITEM_TYPES.home_food.join(", ")}. farm: eggs (from the seller's own hens), produce (whole, uncut, home-grown fruit and vegetables).
Set possibly_banned to true, with a short reason, if the item may be any of these, which cannot be listed: weapons, ammunition or weapon knives; alcohol or food made with alcohol; anything with CBD, THC or hemp; vapes, e-cigarettes or tobacco; raw milk; home-canned vegetables or meat; any food with meat, poultry, fish or seafood in it; medicines, supplements or remedies; live animals; plants, seedlings or cut flowers; children's items (toys, baby clothes, blankets, cribs); soap, lotion, balms or other skin products; anything used or second-hand; recalled products; counterfeit goods; adult items; vehicles or boats. If you are not sure, set it to true.
Always answer with the draft_shop_item tool.`;

export const SHOP_ITEM_TOOL = {
  type: "function",
  function: {
    name: "draft_shop_item",
    description: "A draft listing for one new item a maker made or grew",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        kind: { type: "string", enum: SHOP_ITEM_KINDS },
        subtype: { type: "string", enum: SHOP_ITEM_SUBTYPES },
        possibly_banned: { type: "boolean" },
        banned_reason: { type: "string" },
      },
      required: ["title", "description", "kind", "subtype", "possibly_banned"],
      additionalProperties: false,
    },
  },
} as const;

export interface ShopItemDraft {
  title: string;
  description: string;
  kind: ShopItemKind;
  subtype: string;
  flagged: boolean;
  /** Why the AI thinks the item may not be allowed; for admins, never shown to buyers. */
  flagReason: string | null;
}

const oneLine = (s: string) => s.replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();

/** null when the answer is unusable (no title). A kind/type pair off the list falls back to made/crafts. */
export function sanitizeShopItemDraft(raw: unknown): ShopItemDraft | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const title = typeof r.title === "string" ? oneLine(r.title).slice(0, 80) : "";
  if (title.length < 3) return null;
  const description = typeof r.description === "string" ? r.description.trim().slice(0, 2000) : "";
  const kindOk = (SHOP_ITEM_KINDS as string[]).includes(r.kind as string);
  const kind = (kindOk ? r.kind : "made") as ShopItemKind;
  const types = SHOP_ITEM_TYPES[kind] as readonly string[];
  const subtype = kindOk && types.includes(r.subtype as string) ? (r.subtype as string) : kind === "made" ? "crafts" : types[0];
  // Fail closed: anything but an explicit `false` from the model is a flag,
  // so a malformed answer sends the item to an admin, never straight live.
  const flagged = r.possibly_banned !== false;
  const reasonRaw = typeof r.banned_reason === "string" ? oneLine(r.banned_reason).slice(0, 300) : "";
  const flagReason = flagged ? (reasonRaw || "The photo check could not confirm the item is allowed.") : null;
  return { title, description, kind, subtype, flagged, flagReason };
}
