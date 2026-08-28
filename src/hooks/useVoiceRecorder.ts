/**
 * useVoiceRecorder — MediaRecorder-based voice note recorder.
 *
 * Uses the web MediaRecorder API (works in iOS 14.3+ WKWebView and
 * Android WebView). No native plugin required.
 *
 * Usage:
 *   const rec = useVoiceRecorder({ maxSeconds: 60 });
 *   rec.start()  → requests mic, starts recording
 *   rec.stop()   → stops and resolves `rec.blob` / `rec.duration`
 *   rec.discard() → cancels in-flight recording, resets state
 */

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

const MAX_SECONDS_DEFAULT = 60;

/** Pick the best-supported audio MIME for the current browser/WKWebView. */
function preferredAudioMime(): string {
  // mp4 is what iOS WKWebView supports; webm for Chrome/Android.
  const candidates = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg"];
  for (const mime of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(mime)) {
      return mime;
    }
  }
  return ""; // browser default
}

type VoiceRecorderState =
  | "idle"
  | "requesting"   // mic permission in-flight
  | "recording"
  | "stopped"      // recording done, blob ready
  | "error";

export interface VoiceRecorderHook {
  state: VoiceRecorderState;
  /** Elapsed seconds while recording. Resets to 0 on discard/after stop. */
  elapsed: number;
  /** The recorded audio blob. Set once state === 'stopped'. */
  blob: Blob | null;
  /** Duration in seconds of the completed recording. */
  duration: number;
  /** MIME type of the recorded blob. */
  mime: string;
  start: () => Promise<void>;
  stop: () => void;
  discard: () => void;
}

export function useVoiceRecorder(
  opts: { maxSeconds?: number } = {},
): VoiceRecorderHook {
  const maxSeconds = opts.maxSeconds ?? MAX_SECONDS_DEFAULT;

  const [state, setState] = useState<VoiceRecorderState>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [duration, setDuration] = useState(0);
  const [mime, setMime] = useState("");

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const resolveStopRef = useRef<((blob: Blob) => void) | null>(null);

  const cleanupStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const discard = useCallback(() => {
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
    cleanupStream();
    clearTimer();
    chunksRef.current = [];
    resolveStopRef.current = null;
    setBlob(null);
    setDuration(0);
    setElapsed(0);
    setMime("");
    setState("idle");
  }, [cleanupStream, clearTimer]);

  const stop = useCallback(() => {
    if (!mediaRecorderRef.current) return;
    if (mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    clearTimer();
  }, [clearTimer]);

  const start = useCallback(async () => {
    if (state === "recording" || state === "requesting") return;

    // Reset any previous recording
    setBlob(null);
    setDuration(0);
    setElapsed(0);
    chunksRef.current = [];

    setState("requesting");

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setState("error");
      toast.error(
        "Microphone access denied. Allow microphone access in Settings to record voice notes.",
        { duration: 5000 },
      );
      setState("idle");
      return;
    }

    streamRef.current = stream;

    const selectedMime = preferredAudioMime();
    const recorderOptions: MediaRecorderOptions = {};
    if (selectedMime) recorderOptions.mimeType = selectedMime;
    setMime(selectedMime || "audio/mp4");

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, recorderOptions);
    } catch {
      cleanupStream();
      setState("idle");
      toast.error("Voice recording is not supported on this device.");
      return;
    }

    mediaRecorderRef.current = recorder;
    chunksRef.current = [];

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = () => {
      cleanupStream();
      const finalMime = selectedMime || "audio/mp4";
      const recorded = new Blob(chunksRef.current, { type: finalMime });
      const secs = Math.round((Date.now() - startTimeRef.current) / 1000);
      setBlob(recorded);
      setDuration(secs);
      setElapsed(secs);
      setMime(finalMime);
      setState("stopped");
      resolveStopRef.current?.(recorded);
      resolveStopRef.current = null;
    };

    startTimeRef.current = Date.now();
    recorder.start(250); // collect in 250ms chunks
    setState("recording");

    // Tick the elapsed counter each second
    timerRef.current = setInterval(() => {
      const secs = Math.round((Date.now() - startTimeRef.current) / 1000);
      setElapsed(secs);
      // Auto-stop at cap
      if (secs >= maxSeconds) {
        clearTimer();
        if (mediaRecorderRef.current?.state !== "inactive") {
          mediaRecorderRef.current?.stop();
        }
      }
    }, 1000);
  }, [state, cleanupStream, clearTimer, maxSeconds]);

  return { state, elapsed, blob, duration, mime, start, stop, discard };
}
