import { useRef } from "react";
import { useVoiceDictation } from "@/hooks/useVoiceDictation";

export type Dictation = ReturnType<typeof useVoiceDictation>;

interface UseTitleDictationArgs {
  title: string;
  setTitle: (v: string) => void;
}

interface UseTitleDictationResult {
  dictation: Dictation;
  startTitleDictation: Dictation["start"];
}

/**
 * Voice dictation for the title field — taps the mic, speaks once,
 * we append the transcript to whatever was already typed. Hides when
 * the browser doesn't support the Speech API.
 */
export function useTitleDictation({
  title,
  setTitle,
}: UseTitleDictationArgs): UseTitleDictationResult {
  const titleRef = useRef(title);
  titleRef.current = title;
  const dictation = useVoiceDictation({
    onFinal: (text) => {
      const current = titleRef.current;
      setTitle(current ? `${current.trim()} ${text}`.trim() : text);
    },
  });
  const startTitleDictation = dictation.start;

  return { dictation, startTitleDictation };
}
