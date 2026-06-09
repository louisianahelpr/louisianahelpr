import { useCallback, useEffect, useRef, useState } from "react";

/**
 * useVoiceDictation — thin React wrapper over the browser SpeechRecognition
 * API for the chat composer's mic button.
 *
 * Degrades gracefully: `supported` is false on platforms without the API
 * (older Android Chromiums, Firefox, some Capacitor WebViews), so the
 * caller can hide the mic button entirely rather than rendering a
 * disabled stub. On iOS Safari + Capacitor the prefixed
 * `webkitSpeechRecognition` is used; both are typed as `any` below
 * because TypeScript's lib.dom doesn't ship a stable shape for them yet.
 *
 * Result handling:
 *  - `interimText` updates live while the user speaks (rendered as a
 *    grayed-out preview in the input so they see what's being heard).
 *  - On a `result.isFinal` event the hook calls `onFinal(transcript)`
 *    with the recognized text — the composer appends that to the draft
 *    rather than overwriting, so a user can dictate, type, dictate.
 *  - On error or end, `isListening` flips back to false; callers don't
 *    need to manually toggle.
 */
export interface UseVoiceDictationOptions {
  /** Called when the recognizer emits a final transcript chunk. */
  onFinal: (text: string) => void;
  /** Locale for the recognition session. Defaults to en-US. */
  lang?: string;
}

interface UseVoiceDictationResult {
  /** True when the underlying API is available on this platform. */
  supported: boolean;
  /** True while a recognition session is actively listening. */
  isListening: boolean;
  /** Live partial transcript — surface in the composer placeholder. */
  interimText: string;
  /** Start a recognition session. No-op when unsupported / already listening. */
  start: () => void;
  /** Stop the active session — drops any in-flight interim transcript. */
  stop: () => void;
}

// Narrow shape for the recognition instance — the DOM types ship as `any`
// for these symbols, so we describe just the surface this hook uses.
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((ev: any) => void) | null;
  onerror: ((ev: any) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

function resolveRecognitionCtor():
  | (new () => SpeechRecognitionLike)
  | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function useVoiceDictation({
  onFinal,
  lang = "en-US",
}: UseVoiceDictationOptions): UseVoiceDictationResult {
  const [supported, setSupported] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [interimText, setInterimText] = useState("");
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  // Keep the latest callback in a ref so the recognizer's onresult
  // handler (closed over once at session start) always sees the freshest
  // `onFinal`, even if the parent rerendered with a new closure.
  const onFinalRef = useRef(onFinal);
  useEffect(() => {
    onFinalRef.current = onFinal;
  }, [onFinal]);

  useEffect(() => {
    setSupported(!!resolveRecognitionCtor());
  }, []);

  const stop = useCallback(() => {
    const rec = recognitionRef.current;
    if (rec) {
      try {
        rec.stop();
      } catch {
        /* Some engines throw if stop is called pre-start; safe to ignore. */
      }
    }
    setInterimText("");
    setIsListening(false);
  }, []);

  const start = useCallback(() => {
    if (isListening) return;
    const Ctor = resolveRecognitionCtor();
    if (!Ctor) return;
    let rec: SpeechRecognitionLike;
    try {
      rec = new Ctor();
    } catch {
      return;
    }
    rec.continuous = false;
    rec.interimResults = true;
    rec.lang = lang;
    rec.onresult = (ev: any) => {
      let interim = "";
      let finalChunk = "";
      const results = ev?.results ?? [];
      for (let i = ev?.resultIndex ?? 0; i < results.length; i++) {
        const r = results[i];
        if (!r) continue;
        const transcript = r[0]?.transcript ?? "";
        if (r.isFinal) finalChunk += transcript;
        else interim += transcript;
      }
      if (interim) setInterimText(interim.trim());
      if (finalChunk.trim()) {
        setInterimText("");
        onFinalRef.current(finalChunk.trim());
      }
    };
    rec.onerror = () => {
      setInterimText("");
      setIsListening(false);
    };
    rec.onend = () => {
      setInterimText("");
      setIsListening(false);
    };
    recognitionRef.current = rec;
    try {
      rec.start();
      setIsListening(true);
    } catch {
      // Some engines throw if start is called twice in quick succession.
      setIsListening(false);
    }
  }, [isListening, lang]);

  // Always stop on unmount so a dangling recognizer doesn't keep the
  // mic hot after the composer is gone.
  useEffect(() => {
    return () => {
      try {
        recognitionRef.current?.stop();
      } catch {
        /* ignore */
      }
    };
  }, []);

  return { supported, isListening, interimText, start, stop };
}
