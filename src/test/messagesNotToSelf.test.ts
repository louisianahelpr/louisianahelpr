/**
 * DH-002 (DB layer): a message whose sender is its receiver must be refused by
 * the database, not only hidden by the UI. The client side is covered by
 * JobDetailFooter.test.tsx; this pins the constraint in the migration corpus.
 *
 * @mutate supabase/migrations/20260924050401_messages_no_self_thread.sql | CHECK (sender_id <> receiver_id) | CHECK (true)
 */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dir = "supabase/migrations";
const corpus = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort().map((f) => readFileSync(`${dir}/${f}`, "utf8")).join("\n");

describe("messages can't be addressed to the sender (DH-002)", () => {
  it("a CHECK constraint forbids sender_id = receiver_id", () => {
    expect(corpus).toMatch(/ADD CONSTRAINT messages_not_to_self CHECK \(sender_id <> receiver_id\)/);
  });
  it("it is never dropped later", () => {
    expect(corpus).not.toMatch(/DROP CONSTRAINT (IF EXISTS )?messages_not_to_self/);
  });
});
