/**
 * Q1505: the text a journey appends to a shared seed field, and the way back.
 *
 * 03-account appends ` Journey <run>.` to the seed Helpr's bio and its cleanup
 * used to restore the bio as it was when THAT run started. One run whose
 * cleanup never finished left "Journey eq8jng." behind (2026-10-07), so every
 * later run restored the polluted text, and a run in flight stacked a second
 * marker. Restoring the before-image with every marker stripped heals a
 * leftover on the next run instead of preserving it.
 * Guard: src/test/journeyCleanupStripsMarkers.test.ts.
 */
export function journeyMarker(run: string): string {
  return `Journey ${run}.`;
}

/** `text` without any trailing `Journey <run>.` markers (null stays null). */
export function withoutJourneyMarkers(text: string | null): string | null {
  if (text === null) return null;
  return text.replace(/(?:\s*Journey [a-z0-9]+\.)+\s*$/, "");
}
