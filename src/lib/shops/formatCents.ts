/** "$12.50" from 1250 cents. Its own module so Home's to-do list can format a shop order without loading the orders
 *  data code (src/lib/shops/orders.ts re-exports it). */
export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
