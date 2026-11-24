export declare const GUIDE_SEARCH: Record<"her" | "him" | "kids", { title: string; who: string; intro: string }>;
export declare const DEAL_DAY_SEARCH_TITLES: Record<string, string>;
export declare const GUIDE_CROSS_LINKS: readonly (readonly [string, string])[];
export declare const MAX_DESCRIPTION: number;
export declare function guideSearchDescription(slug: string, count: number, leadName?: string | null): string | null;
