/**
 * Q2471 (1) voice (lead 11-04): the AI job builder gets the SAME in-app dictation the chat composer's mic uses
 * (useVoiceDictation over the Web Speech API). Each finished phrase is ADDED to what the poster already typed,
 * the button shows only where the API exists (elsewhere the phone keyboard's own mic dictates into the box),
 * and the Info.plist keeps the speech permission line iOS needs before it will even ask.
 *
 * @mutate src/components/postjob/AiJobBuilder.tsx |     setPrompt(before ? `${before} ${said}` : said); |     setPrompt(said);
 * @mutate src/components/postjob/AiJobBuilder.tsx |             {voice.supported && ( |             {false && (
 * @mutate src/components/postjob/AiJobBuilder.tsx |   const voice = useVoiceDictation({ onFinal: addDictated, onError: (message) => toast.error(message) }); |   const voice = useVoiceDictation({ onFinal: addDictated });
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { render, screen, fireEvent, act } from "@testing-library/react";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: vi.fn() } } }));
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: toastError, info: vi.fn() }) }));

import { AiJobBuilder } from "@/components/postjob/AiJobBuilder";

type Handler = ((ev: unknown) => void) | null;
let last: FakeRecognition | null = null;
class FakeRecognition {
  continuous = false;
  interimResults = false;
  lang = "";
  onresult: Handler = null;
  onerror: Handler = null;
  onend: (() => void) | null = null;
  started = 0;
  start() {
    this.started++;
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- the test drives the instance the hook built
    last = this;
  }
  stop() {}
}

const say = (text: string) =>
  act(() => {
    last!.onresult!({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: text } }] });
  });

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
  last = null;
  toastError.mockReset();
});

describe("Q2471 (1) say the job into the AI job builder", () => {
  it("with the speech API: a Say it button; each phrase is added to the typed words", async () => {
    (window as unknown as Record<string, unknown>).webkitSpeechRecognition = FakeRecognition;
    render(<AiJobBuilder headless onGenerated={() => {}} />);
    const box = screen.getByLabelText("Describe your job") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "Move a couch" } });
    const mic = await screen.findByRole("button", { name: "Say it" });
    fireEvent.click(mic);
    expect(last?.started).toBe(1);
    expect(screen.getByRole("button", { name: "Stop listening" })).toBeTruthy();
    say("up two flights on Saturday");
    expect(box.value).toBe("Move a couch up two flights on Saturday");
  });

  it("a failed session tells the poster why", async () => {
    (window as unknown as Record<string, unknown>).webkitSpeechRecognition = FakeRecognition;
    render(<AiJobBuilder headless onGenerated={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Say it" }));
    act(() => last!.onerror!({ error: "not-allowed" }));
    expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/Microphone access is off/));
  });

  it("without the speech API there is no dead button (the keyboard mic still types into the box)", () => {
    render(<AiJobBuilder headless onGenerated={() => {}} />);
    expect(screen.queryByRole("button", { name: "Say it" })).toBeNull();
    expect(screen.getByLabelText("Describe your job")).toBeTruthy();
  });

  it("the iOS app still carries the speech permission line (without it iOS refuses before asking)", () => {
    const plist = readFileSync("ios/App/App/Info.plist", "utf8");
    expect(plist).toMatch(/<key>NSSpeechRecognitionUsageDescription<\/key>\s*<string>[^<]{10,}<\/string>/);
    expect(plist).toMatch(/<key>NSMicrophoneUsageDescription<\/key>/);
  });
});
