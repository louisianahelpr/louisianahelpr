/**
 * Q1283 — on a poster's own INSERT, the direct-offer markers follow the offer.
 *
 * enforce_jobs_insert_column_lock used to leave direct_offer_status and
 * direct_offer_expires_at as the client sent them: a post could carry
 * 'pending' with a NULL or far-future expiry (the expiry sweep never clears
 * it) or 'accepted'/'declined' with no offer. 20261005060416 makes them
 * server-owned on the client-INSERT branch: no offer -> both NULL; an offer ->
 * 'pending' with the expiry held to the app's own windows.
 *
 * This pins the NEWEST definition (effectiveDefs replays every migration) and
 * derives the server's bounds from the app's inventory of windows
 * (src/lib/offerResponseWindow.ts), so adding a 72h choice in the app without
 * widening the server fails here instead of silently shortening real offers.
 * Behaviour: src/test/pglite/directOfferMarkersOnInsert.pglite.mjs (6 FAILED on
 * the live body, ALL PASS applied 3x).
 */
// Registered mutations - each turns this guard RED on its own:
// @mutate supabase/migrations/20261005060416_direct_offer_markers_server_owned_on_insert.sql |     NEW.direct_offer_status     := 'pending'; |     NULL;
// @mutate supabase/migrations/20261005060416_direct_offer_markers_server_owned_on_insert.sql |       now() + interval '48 hours'); |       now() + interval '400 days');
// @mutate src/lib/offerResponseWindow.ts |   { value: "48", label: "48 hours" }, |   { value: "48", label: "48 hours" },\n  { value: "72", label: "72 hours" },
// @mutate supabase/migrations/20261005060416_direct_offer_markers_server_owned_on_insert.sql |     NEW.direct_offer_expires_at := NULL;\n  ELSE |     NULL;\n  ELSE
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";
import { DEFAULT_OFFER_RESPONSE_HOURS, OFFER_RESPONSE_WINDOWS } from "@/lib/offerResponseWindow";

const defs = effectiveDefs(join(process.cwd(), "supabase/migrations"));
const def = defs.get("enforce_jobs_insert_column_lock");
const body = def ? blankSqlComments(def.stmt) : "";
const hours = OFFER_RESPONSE_WINDOWS.map((w) => Number(w.value));

describe("Q1283: a poster's INSERT cannot set the direct-offer markers", () => {
  it("the newest definition is found and the app offers windows", () => {
    expect(def, "no CREATE FUNCTION enforce_jobs_insert_column_lock in the migrations").toBeDefined();
    expect(hours.length).toBeGreaterThan(3);
  });

  it("no offer: both markers are cleared", () => {
    expect(body).toMatch(
      /IF\s+NEW\.offered_to_helper_id\s+IS\s+NULL\s+THEN\s+NEW\.direct_offer_status\s*:=\s*NULL;\s+NEW\.direct_offer_expires_at\s*:=\s*NULL;/i,
    );
  });

  it("an offer: status is forced to 'pending'", () => {
    expect(body).toMatch(/ELSE\s+NEW\.direct_offer_status\s*:=\s*'pending';/i);
  });

  it("the expiry is held to the app's shortest and longest window, defaulting to the app's default", () => {
    const min = Math.min(...hours);
    const max = Math.max(...hours);
    const clamp = new RegExp(
      `NEW\\.direct_offer_expires_at\\s*:=\\s*LEAST\\(\\s*GREATEST\\(\\s*COALESCE\\(\\s*NEW\\.direct_offer_expires_at\\s*,\\s*now\\(\\)\\s*\\+\\s*interval\\s*'${DEFAULT_OFFER_RESPONSE_HOURS} hours?'\\s*\\)\\s*,\\s*now\\(\\)\\s*\\+\\s*interval\\s*'${min} hours?'\\s*\\)\\s*,\\s*now\\(\\)\\s*\\+\\s*interval\\s*'${max} hours?'\\s*\\)`,
      "i",
    );
    expect(body).toMatch(clamp);
  });

  it("the markers are set on the client-INSERT branch, after the server-context early return", () => {
    const early = body.search(/IF\s+public\.is_server_context\(\)/i);
    const markers = body.search(/NEW\.direct_offer_status\s*:=/i);
    expect(early).toBeGreaterThan(-1);
    expect(markers).toBeGreaterThan(early);
  });
});
