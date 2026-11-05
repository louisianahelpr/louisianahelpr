/**
 * The Wanted quick-list link, with no Supabase import, so a light page (the public profile /u/<handle>) can link a
 * post without loading the Declutter data layer. src/lib/declutter/wanted.ts re-exports it; readWantedAnswer there
 * reads the same three params back.
 */
export function quickListHref(post: { id: string; max_price_cents: number; what: string }): string {
  const q = new URLSearchParams({ answer: post.id, max: String(post.max_price_cents), what: post.what });
  return `/declutter/sell?${q.toString()}`;
}
