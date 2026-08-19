// Dictation failures must SAY something. The reported symptom was "microphone
// does not work": tapping the mic flickered the button off and nothing else
// happened, because `onerror` discarded the error and a session that ended
// having heard nothing was indistinguishable from a no-op tap.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useVoiceDictation } from "./useVoiceDictation";

interface FakeRec {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

let instance: FakeRec | null = null;

/**
 * A stand-in for `window.SpeechRecognition`. Built as a constructor that
 * RETURNS a plain object (legal, and `new` yields it), so the fixture never
 * touches `this` — the hook only ever calls the instance through the
 * `SpeechRecognitionLike` surface anyway.
 */
function makeRecognition(startImpl: () => void = () => {}): new () => FakeRec {
  return function FakeRecognition(): FakeRec {
    const rec: FakeRec = {
      continuous: false,
      interimResults: false,
      lang: "",
      onresult: null,
      onerror: null,
      onend: null,
      start: vi.fn(startImpl),
      stop: vi.fn(),
    };
    instance = rec;
    return rec;
  } as unknown as new () => FakeRec;
}

beforeEach(() => {
  instance = null;
  (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition = makeRecognition();
});

afterEach(() => {
  delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
});

function setup(onError = vi.fn()) {
  const onFinal = vi.fn();
  const hook = renderHook(() => useVoiceDictation({ onFinal, onError }));
  act(() => hook.result.current.start());
  return { hook, onFinal, onError };
}

describe("useVoiceDictation error reporting", () => {
  it("reports a denied microphone in words the user can act on", () => {
    const { onError } = setup();
    act(() => instance!.onerror!({ error: "not-allowed" }));
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("Microphone access is off"));
  });

  it("distinguishes denied SPEECH RECOGNITION from a denied microphone", () => {
    // iOS returns this when NSSpeechRecognitionUsageDescription is missing or
    // the user turned speech recognition off — a different setting, and a
    // different fix, from the microphone permission.
    const { onError } = setup();
    act(() => instance!.onerror!({ error: "service-not-allowed" }));
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("Speech recognition is off"));
  });

  it("stays silent when the user aborted the session themselves", () => {
    const { onError } = setup();
    act(() => instance!.onerror!({ error: "aborted" }));
    expect(onError).not.toHaveBeenCalled();
  });

  it("reports a session that ends having heard nothing and raised nothing", () => {
    // The silent-failure shape — most often an iOS WKWebView where the
    // constructor exists but the speech service never engages.
    const { onError } = setup();
    act(() => instance!.onend!());
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("didn't pick anything up"));
  });

  it("stays silent on a normal session that produced a transcript", () => {
    const { onError, onFinal } = setup();
    act(() =>
      instance!.onresult!({
        resultIndex: 0,
        results: [Object.assign([{ transcript: "on my way" }], { isFinal: true })],
      }),
    );
    act(() => instance!.onend!());
    expect(onFinal).toHaveBeenCalledWith("on my way");
    expect(onError).not.toHaveBeenCalled();
  });

  it("reports a constructor that exists but throws on start", () => {
    // The WKWebView shape: `webkitSpeechRecognition` is present, so `supported`
    // is true and the button renders, but starting a session throws.
    (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition = makeRecognition(() => {
      throw new Error("not implemented");
    });
    const onError = vi.fn();
    const onFinal = vi.fn();
    const hook = renderHook(() => useVoiceDictation({ onFinal, onError }));
    act(() => hook.result.current.start());
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("Couldn't start dictation"));
    expect(hook.result.current.isListening).toBe(false);
  });
});
