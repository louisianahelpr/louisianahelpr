/**
 * The sentence-case rule (HELPR-DESIGN-SPEC v2 §2, "Sentence case everywhere"):
 * the first word starts with a capital, and every later word is lower case
 * unless it is a proper noun or an acronym. A word after ". ? ! :" starts a new
 * sentence. "\u0001" marks a value (a `${…}` or `{expr}`) and is skipped.
 */

/** Proper nouns a control or heading may capitalise mid-sentence: brands, our section names, the document titles. */
const PROPER = new Set([
  "Helpr", "Helprs", "Louisiana", "Stripe", "Apple", "Google", "Pay", "ID", "iOS", "Android", "Face", "Touch",
  "Declutter", "Shops", "Homes", "Explore", "Messages", "Venmo", "PayPal", "Zelle", "Facebook", "Instagram",
  "I", "I'm", "I've", "I'll", "OK", "Terms", "Use", "Privacy", "Policy", "Community", "Rules", "Help", "Center",
  "App", "Store", "AI", "Jobs", "Home", "Wrapped",
  // Days and months are names.
  "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun",
  "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December",
]);
/** An acronym or code: two or more capitals/digits, hyphens allowed (W-9, 2FA, SMS). */
const ACRONYM = /^[A-Z0-9][A-Z0-9-]*[A-Z0-9]$/;

/** The words that break the rule; empty when the text is sentence case. */
export function sentenceCaseProblems(text: string): string[] {
  const bad: string[] = [];
  let start = true;
  let first = true;
  for (const token of text.split(/\s+/).filter(Boolean)) {
    const word = token.replace(/^["'“(]+/, "").replace(/["'”).,?!:;…]+$/, "");
    if (/^[·•—–|]$/.test(token)) {
      // A separator starts a new phrase: "Saved · Porch pickup".
      start = true;
      first = true;
      continue;
    }
    if (word.includes("\u0001") || !/^[A-Za-z]/.test(word)) {
      // A value LEADING the text (an icon, a count) does not start the sentence: "{icon} Download CSV".
      if (bad.length || word === "" || word.replaceAll("\u0001", "") !== "" || !first) start = false;
    } else if (start) {
      start = false;
    } else if (/^[A-Z]/.test(word) && !PROPER.has(word) && !ACRONYM.test(word)) {
      bad.push(word);
    }
    if (/[.?!:]["'”)]*$/.test(token)) start = true;
    first = false;
  }
  return bad;
}
