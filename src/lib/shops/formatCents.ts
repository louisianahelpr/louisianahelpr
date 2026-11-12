/** "$12.50" from 1250 cents, "$5,000.00" from 500000 (S027: en-US thousands separator, like the rest of the app). Its own module so Home's to-do list can format a shop order without loading the orders
 *  data code (src/lib/shops/orders.ts re-exports it). */
export function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
