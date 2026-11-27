export declare const OFFER_REWRITES: Record<string, string>;
export declare const CODE_OFFERS: Record<string, string>;
export declare const CODE_LINKS: Record<string, string>;
export declare const STORE_SPELLING: Record<string, string>;
export declare function cleanOffer(raw: string | null | undefined): string | null;
export declare function cleanStore(store: string): string;
export declare function cleanSales<T extends { store: string; offer: string }>(sales: readonly T[]): T[];
export declare function cleanCodes<T extends { store: string; code: string; offer: string; href?: string }>(codes: readonly T[]): (T & { href?: string })[];
export declare function offerOnly(offer: string | null | undefined): string;
