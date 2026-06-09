import { useEffect, useRef, useState } from "react";

/**
 * Web Speech API thin wrapper for one-shot dictation into a text field.
 *
 * - Returns `supported = false` when the browser/webview doesn't expose
 *   `SpeechRecognition` (most desktop Safari, older iOS WKWebView, etc.).
 *   Callers should hide the mic button in that case so the affordance
 *   never appears broken.
 * - Single-utterance mode (continuous = false, interimResults = true):
 *   the user taps the mic, speaks once, the result is appended to the
 *   target field, and recognition stops automatically.
 * - On iOS the host page must respond to user gesture before mic access
 *   — the `start()` call MUST happen inside a click/touch handler. We
 *   surface a callable `start(onText)` instead of an effect so callers
 *   keep the right call site.
 *
 * No analytics or persistence — this is a UI input helper.
 */

// The Web Speech API types vary across browsers; we read what we need
// defensively and type the global as `any` to avoid pulling in
// browser-flavor-specific d.ts files.
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

declare global {
  interface Window {
    SpeechRecognition?: { new (): SpeechRecognitionLike };
    webkitSpeechRecognition?: { new (): SpeechRecognitionLike };
  }
}

export interface UseVoiceDictation {
  /** True when the underlying API exists. */
  supported: boolean;
  /** True while recognition is active. */
  listening: boolean;
  /** Begin a single-utterance dictation. Calls `onText` with the final transcript. */
  start: (onText: (text: string) => void) => void;
  /** Stop the current session (idempotent). */
  stop: () => void;
}

function getConstructor() {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

export function useVoiceDictation(): UseVoiceDictation {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    setSupported(getConstructor() !== null);
    return () => {
      // Best-effort tear-down so an unmount mid-utterance doesn't hold
      // the mic open.
      try { recognitionRef.current?.abort(); } catch { /* ignore */ }
      recognitionRef.current = null;
    };
  }, []);

  const start = (onText: (text: string) => void) => {
    const Ctor = getConstructor();
    if (!Ctor) return;
    // Abort any previous session — calling start() on an active
    // instance throws InvalidStateError in some browsers.
    try { recognitionRef.current?.abort(); } catch { /* ignore */ }

    const rec = new Ctor();
    rec.lang = "en-US";
    rec.continuous = false;
    rec.interimResults = false;

    rec.onresult = (event: any) => {
      const transcript = Array.from(event.results as ArrayLike<any>)
        .map((r) => r[0]?.transcript ?? "")
        .join(" ")
        .trim();
      if (transcript) onText(transcript);
    };
    rec.onerror = () => {
      setListening(false);
    };
    rec.onend = () => {
      setListening(false);
    };

    recognitionRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  };

  const stop = () => {
    try { recognitionRef.current?.stop(); } catch { /* ignore */ }
    setListening(false);
  };

  return { supported, listening, start, stop };
}
