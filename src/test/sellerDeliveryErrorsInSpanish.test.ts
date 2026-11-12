/**
 * F260q: seller delivery's refusals (sellerDeliveryErrors.ts rpcErrorMessage / sellerDeliveryErrorMessage) follow the
 * member's language, by CODE: sd.<code>, sd.d.<name> (delivery wording), else de.<code> (shared Declutter table).
 * Inventory: every RPC's every code reads in Spanish once es.ts has loaded (never English, never a raw key), and every
 * sd.* key's English is the table's word for word.
 *
 * @mutate src/lib/declutter/sellerDeliveryErrors.ts |   return w === key ? english : w; |   return english;
 * @mutate src/lib/declutter/sellerDeliveryErrors.ts |   return w === key ? english : w; |   return w;
 * @mutate src/lib/declutter/sellerDeliveryErrors.ts | test(raw)) return deliveryInLang(code, table[code]); | test(raw)) return table[code];
 * @mutate src/lib/declutter/sellerDeliveryErrors.ts | message)) return deliveryInLang(message, SELLER_DELIVERY_ERROR_COPY[message]); | message)) return SELLER_DELIVERY_ERROR_COPY[message];
 * @mutate src/lib/declutter/sellerDeliveryErrors.ts |   const key = dName ? `sd.d.${dName}` : | const key = dName ? `sd.${dName}` :
 * @mutate src/lib/i18n/es.ts |   ...esSellerDeliveryErrors, |
 */
import { afterEach, describe, expect, it } from "vitest";
import { setLang, ensureLangLoaded, __resetLangForTests } from "@/lib/i18n/language";
import { enSellerDeliveryErrors } from "@/lib/i18n/enSellerDeliveryErrors";
import { esSellerDeliveryErrors } from "@/lib/i18n/esSellerDeliveryErrors";
import { englishWords } from "@/lib/i18n/enRegistry";
import {
  SELLER_DELIVERY_ERROR_COPY, SELLER_DELIVERY_RPC_ERROR_COPY, rpcErrorMessage, sellerDeliveryErrorMessage, type SellerDeliveryRpc,
} from "@/lib/declutter/sellerDeliveryErrors";

const rpcs = Object.keys(SELLER_DELIVERY_RPC_ERROR_COPY) as SellerDeliveryRpc[];

describe("F260q: seller delivery's refusals follow the member's language", () => {
  afterEach(() => __resetLangForTests());

  it("every sd.<code> key is the table's English, and every key has its Spanish", () => {
    for (const [code, english] of Object.entries(SELLER_DELIVERY_ERROR_COPY)) {
      expect(enSellerDeliveryErrors[`sd.${code}` as keyof typeof enSellerDeliveryErrors], code).toBe(english);
    }
    for (const k of Object.keys(enSellerDeliveryErrors) as (keyof typeof enSellerDeliveryErrors)[]) {
      expect(esSellerDeliveryErrors[k], k).toBeTruthy();
      expect(esSellerDeliveryErrors[k], k).not.toBe(enSellerDeliveryErrors[k]);
    }
    // Every sd.d.* English is a line some RPC really says.
    const said = new Set(rpcs.flatMap((r) => Object.values(SELLER_DELIVERY_RPC_ERROR_COPY[r] as Record<string, string>)));
    for (const [k, v] of Object.entries(enSellerDeliveryErrors)) if (k.startsWith("sd.d.")) expect(said.has(v), k).toBe(true);
  });

  it("English reader: the table's own words", () => {
    expect(rpcErrorMessage("declutter_seller_delivered", { message: "location_required" })).toBe("Turn on location so we can confirm you're at the buyer's address.");
    expect(sellerDeliveryErrorMessage({ message: "slot_unavailable" })).toBe(SELLER_DELIVERY_ERROR_COPY.slot_unavailable);
  });

  it("Spanish chosen but not loaded yet: the English, never a raw key", () => {
    const saved = englishWords["sd.slot_unavailable"];
    delete englishWords["sd.slot_unavailable"];
    setLang("es");
    try {
      expect(sellerDeliveryErrorMessage({ message: "slot_unavailable" })).toBe(SELLER_DELIVERY_ERROR_COPY.slot_unavailable);
    } finally { englishWords["sd.slot_unavailable"] = saved; }
  });

  it("Spanish reader: every RPC's every code reads in Spanish", async () => {
    setLang("es");
    await ensureLangLoaded();
    let n = 0;
    for (const rpc of rpcs) {
      for (const [code, english] of Object.entries(SELLER_DELIVERY_RPC_ERROR_COPY[rpc] as Record<string, string>)) {
        const w = rpcErrorMessage(rpc, { message: code });
        expect(w, `${rpc} ${code}`).not.toBe(english);
        expect(w, `${rpc} ${code}`).not.toMatch(/^(sd|de)\./);
        n++;
      }
    }
    expect(n).toBeGreaterThan(70);
    expect(rpcErrorMessage("declutter_seller_delivered", { message: "location_required" })).toBe(esSellerDeliveryErrors["sd.d.location_required_buyer"]);
    expect(rpcErrorMessage("declutter_set_delivery_handoff", { message: "not_reschedulable" })).toBe(esSellerDeliveryErrors["sd.d.handoff_delivered"]);
    expect(rpcErrorMessage("declutter_propose_delivery_time", { message: "not_reschedulable" })).toBe(esSellerDeliveryErrors["sd.not_reschedulable"]);
    expect(sellerDeliveryErrorMessage({ message: "slot_unavailable" })).toBe(esSellerDeliveryErrors["sd.slot_unavailable"]);
  });
});
