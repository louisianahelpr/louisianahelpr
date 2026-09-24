/**
 * NB-019: unmounting the chat composer mid-recording must stop every mic
 * track, including a stream that arrives after the composer is gone.
 *
 * @mutate src/hooks/useVoiceRecorder.ts |       mediaRecorderRef.current = null;\n      cleanupStream();\n      clearTimer();\n    };\n  }, [cleanupStream, clearTimer]); |       mediaRecorderRef.current = null;\n      clearTimer();\n    };\n  }, [cleanupStream, clearTimer]);
 * @mutate src/hooks/useVoiceRecorder.ts |       stream.getTracks().forEach((t) => t.stop());\n      return; |       return;
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useVoiceRecorder } from "./useVoiceRecorder";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

class FakeRecorder {
  state = "inactive";
  onstop: (() => void) | null = null;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  static isTypeSupported = () => true;
  constructor(public stream: unknown) {}
  start() { this.state = "recording"; }
  stop() { this.state = "inactive"; this.onstop?.(); }
}

let track: { stop: ReturnType<typeof vi.fn> };
let resolveMedia: (s: unknown) => void;

beforeEach(() => {
  track = { stop: vi.fn() };
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: () => new Promise((r) => { resolveMedia = r; }),
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

const stream = () => ({ getTracks: () => [track] });

describe("useVoiceRecorder releases the mic on unmount (NB-019)", () => {
  it("stops the track when unmounted mid-recording", async () => {
    const { result, unmount } = renderHook(() => useVoiceRecorder());
    let p!: Promise<void>;
    act(() => { p = result.current.start(); });
    await act(async () => { resolveMedia(stream()); await p; });
    expect(result.current.state).toBe("recording");
    expect(track.stop).not.toHaveBeenCalled();
    unmount();
    expect(track.stop).toHaveBeenCalled();
  });

  it("stops a stream that arrives after unmount", async () => {
    const { result, unmount } = renderHook(() => useVoiceRecorder());
    let p!: Promise<void>;
    act(() => { p = result.current.start(); });
    unmount();
    resolveMedia(stream());
    await p;
    expect(track.stop).toHaveBeenCalled();
  });
});
