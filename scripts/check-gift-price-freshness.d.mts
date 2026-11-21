export const WARN_AGE_DAYS: number;
export function louisianaToday(): string;
export function priceFreshness(
  priceAts: readonly unknown[],
  today: string,
): { ok: boolean; newest: string | null; age: number | null; shown: number; message: string };
export function committedPriceAts(root: string): string[];
