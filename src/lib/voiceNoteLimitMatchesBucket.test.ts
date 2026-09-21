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

    // Not one constant compared to itself: `clientMb` is parsed out of
    // src/lib/messageAttachments.ts and `bucketBytes` out of the migration that
    // provisioned the bucket. Verified against PROD (fncmgoasalhdgfwzhsqa,
    // read-only, 2026-09-21): storage.buckets.message-attachments
    // file_size_limit = 5242880, which is exactly the client cap, so the two
    // sides are equal today and the inequality above has zero slack.
    expect(bucketBytes).toBe(5 * 1024 * 1024);
    expect(clientMb).toBeGreaterThan(0);
  });

  it("the user-facing copy states the SAME number the code enforces", () => {
    // The cap and the sentence that explains it are two literals ten lines
    // apart. "max 5 MB" beside a 2 MB check is the error message telling the
    // user to do something the code will refuse.
    const src = readFileSync(join(__dirname, "messageAttachments.ts"), "utf8");
    const limitMb = Number(src.match(/VOICE_NOTE_MAX_BYTES\s*=\s*(\d+)\s*\*\s*1024\s*\*\s*1024/)![1]);
    const copyMb = Number(src.match(/Voice note too large \(max (\d+) MB\)/)![1]);
    expect(copyMb).toBe(limitMb);
  });
});

// The parity that matters: a client cap ABOVE the bucket's file_size_limit
// means a 5-10 MB voice note is accepted by the app, rejected by storage, and
// surfaces as a raw StorageApiError instead of "Voice note too large".
// @mutate src/lib/messageAttachments.ts | const VOICE_NOTE_MAX_BYTES = 5 * 1024 * 1024; | const VOICE_NOTE_MAX_BYTES = 10 * 1024 * 1024;
// And the copy half of it.
// @mutate src/lib/messageAttachments.ts | return { error: "Voice note too large (max 5 MB)." }; | return { error: "Voice note too large (max 2 MB)." };
