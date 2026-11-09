/**
 * F046 (owner UI audit 11-09; owner decision 11-09: "guests see 2-3 suggested Help articles on /support too"): a
 * signed-out visitor on /support got no help before writing in (the AI answer is for members). As they type a subject,
 * up to three Help center questions that share its words show above the message box, each linking to its topic.
 * Static FAQ data, no network. Guard: src/test/supportGuestSuggestions.test.tsx.
 */

type FaqSection = { topic: string; items: ReadonlyArray<{ q: string; a: string }> };

export interface HelpSuggestion {
  q: string;
  topic: string;
  /** /help#faq-<topic>, the Help center's own topic anchor (it opens that topic). */
  href: string;
}

/** The Help center's anchor slug for a topic (HelpCenter's topicSlug; the guard checks they agree). */
export function helpTopicSlug(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

const STOP = new Set(["what", "when", "where", "which", "with", "your", "have", "this", "that", "from", "they", "them",
  "there", "their", "about", "help", "need", "does", "doesn", "will", "would", "could", "should", "just", "into", "been",
  "were", "here", "some", "like", "want", "please", "thanks", "hello"]);

function words(text: string): string[] {
  return [...new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !STOP.has(w)))];
}

/** Up to `max` questions sharing the most words with `text` (question words count double); none for no shared word. */
export function suggestHelp(text: string, sections: readonly FaqSection[], max = 3): HelpSuggestion[] {
  const ws = words(text);
  if (ws.length === 0) return [];
  const scored: { s: HelpSuggestion; score: number; order: number }[] = [];
  let order = 0;
  for (const sec of sections) {
    for (const item of sec.items) {
      const q = item.q.toLowerCase();
      const a = item.a.toLowerCase();
      let score = 0;
      for (const w of ws) score += (q.includes(w) ? 2 : 0) + (a.includes(w) ? 1 : 0);
      if (score > 0) scored.push({ s: { q: item.q, topic: sec.topic, href: `/help#faq-${helpTopicSlug(sec.topic)}` }, score, order: order++ });
    }
  }
  return scored.sort((x, y) => y.score - x.score || x.order - y.order).slice(0, max).map((x) => x.s);
}
