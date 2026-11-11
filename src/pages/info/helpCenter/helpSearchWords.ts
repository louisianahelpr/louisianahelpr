/**
 * F412 (audit 11-10): Help search needed every typed word in one answer, so a sentence like "how much does it cost"
 * or "my job went wrong" found nothing ("how", "does", "went" are in no answer together). The words a neighbor types
 * around the point are dropped, and the point words match their plain synonyms: "cost" finds the fee answers,
 * "wrong" the problem / dispute ones.
 */
const FILLER = new Set([
  "a", "an", "the", "i", "im", "i'm", "me", "my", "mine", "we", "our", "you", "your", "it", "its", "it's", "is", "are",
  "was", "were", "be", "been", "do", "does", "did", "doing", "can", "could", "should", "would", "will", "to", "of",
  "in", "on", "for", "at", "by", "with", "and", "or", "but", "so", "if", "what", "whats", "what's", "how", "why",
  "when", "where", "who", "which", "much", "many", "get", "got", "went", "go", "goes", "this", "that", "there",
  "have", "has", "had", "need", "want", "please", "help",
]);

const SYNONYMS: Record<string, readonly string[]> = {
  cost: ["cost", "fee", "price", "charge"],
  costs: ["cost", "fee", "price", "charge"],
  price: ["price", "fee", "cost", "charge"],
  pay: ["pay", "fee", "charge", "price"],
  charge: ["charge", "fee", "price", "cost"],
  charged: ["charge", "fee", "price", "cost"],
  money: ["money", "pay", "fee", "refund"],
  wrong: ["wrong", "problem", "dispute", "issue"],
  bad: ["bad", "problem", "dispute", "wrong"],
  broken: ["broken", "damage", "problem", "dispute"],
  problem: ["problem", "dispute", "wrong", "issue"],
  issue: ["issue", "problem", "dispute", "wrong"],
  late: ["late", "no-show", "no show", "cancel"],
  "no-show": ["no-show", "no show", "late"],
};

/** The words that carry the question, each with the forms that count as a match. Empty when only filler was typed. */
export function helpSearchTerms(query: string): string[][] {
  const words = query.toLowerCase().replace(/[?!.,]/g, " ").split(/\s+/).filter(Boolean);
  const point = words.filter((w) => !FILLER.has(w));
  // Only filler ("how do i"): fall back to the words as typed, as before.
  return (point.length > 0 ? point : words).map((w) => [...(SYNONYMS[w] ?? [w])]);
}
