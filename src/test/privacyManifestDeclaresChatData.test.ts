/**
 * The iOS privacy manifest declares the chat data the app collects (App Store
 * readiness sweep, B48 10-31). Chat voice notes are recorded and uploaded
 * (RichMessageInput -> useVoiceRecorder -> uploadVoiceNote), and chat messages
 * are stored for the other person: while either is true, AudioData and
 * EmailsOrTextMessages must be declared, linked to the user (messages carry
 * the sender id). The manifest listed neither before.
 *
 * @mutate ios/App/App/PrivacyInfo.xcprivacy | <string>NSPrivacyCollectedDataTypeAudioData</string> | <string>NSPrivacyCollectedDataTypeAudioDataX</string>
 * @mutate ios/App/App/PrivacyInfo.xcprivacy | <string>NSPrivacyCollectedDataTypeEmailsOrTextMessages</string> | <string>NSPrivacyCollectedDataTypeOtherDataTypes</string>
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";

const manifest = readFileSync("ios/App/App/PrivacyInfo.xcprivacy", "utf8");
const code = (f: string) => blankComments(readFileSync(f, "utf8"));

/** The <dict> that declares `type`, or null. */
function declared(type: string): string | null {
  const at = manifest.indexOf(`<string>NSPrivacyCollectedDataType${type}</string>`);
  return at < 0 ? null : manifest.slice(at, manifest.indexOf("</dict>", at));
}

describe("privacy manifest declares chat data", () => {
  it("reads a real manifest", () => {
    expect((manifest.match(/<key>NSPrivacyCollectedDataType<\/key>/g) ?? []).length).toBeGreaterThan(5);
  });

  it("voice notes are recorded and uploaded -> AudioData, linked", () => {
    const input = code("src/components/RichMessageInput.tsx");
    expect(input).toMatch(/useVoiceRecorder\(/);
    expect(input).toMatch(/uploadVoiceNote\(/);
    const d = declared("AudioData");
    expect(d, "AudioData must be declared").not.toBeNull();
    expect(d).toMatch(/<key>NSPrivacyCollectedDataTypeLinked<\/key>\s*<true\/>/);
  });

  it("chat messages are stored -> EmailsOrTextMessages, linked", () => {
    expect(code("src/lib/messageAttachments.ts").length).toBeGreaterThan(100);
    const d = declared("EmailsOrTextMessages");
    expect(d, "EmailsOrTextMessages must be declared").not.toBeNull();
    expect(d).toMatch(/<key>NSPrivacyCollectedDataTypeLinked<\/key>\s*<true\/>/);
  });
});
