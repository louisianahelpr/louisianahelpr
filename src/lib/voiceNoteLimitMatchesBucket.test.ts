import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// The client cap on voice notes must not exceed the storage bucket's
// file_size_limit, or oversize notes fail with a raw storage error instead
// of the app's own message.
describe("voice note size cap matches the message-attachments bucket", () => {
  it("client max <= latest bucket file_size_limit", () => {
    const src = readFileSync(join(__dirname, "messageAttachments.ts"), "utf8");
    const m = src.match(/VOICE_NOTE_MAX_BYTES\s*=\s*(\d+)\s*\*\s*1024\s*\*\s*1024/);
    expect(m).toBeTruthy();
    const clientMb = Number(m![1]);
    const dir = join(__dirname, "../../supabase/migrations");
    let bucketBytes: number | null = null;
    // Latest migration that sets the bucket's size: either an INSERT whose
    // VALUES name 'message-attachments' then a byte count, or an UPDATE of it.
    for (const f of readdirSync(dir).sort()) {
      const sql = readFileSync(join(dir, f), "utf8");
      for (const hit of sql.matchAll(/'message-attachments'\s*,\s*'message-attachments'\s*,\s*(?:true|false)\s*,\s*(\d+)/g)) bucketBytes = Number(hit[1]);
      for (const hit of sql.matchAll(/file_size_limit\s*=\s*(\d+)[^;]*id\s*=\s*'message-attachments'/g)) bucketBytes = Number(hit[1]);
    }
    expect(bucketBytes, "bucket file_size_limit not found in migrations").not.toBeNull();
    expect(clientMb * 1024 * 1024).toBeLessThanOrEqual(bucketBytes!);
  });
});
