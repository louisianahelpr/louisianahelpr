/** Types for src/content/giftGuidePeople.mjs (For Her + For Him, sorted by interest; owner 2026-11-20). */
export interface PeopleRel { slug: string; label: string; from: readonly string[]; partner?: true; mature?: true }
export interface PeopleGuide { slug: string; title: string; sources: readonly string[]; sections: readonly { id: string; title: string }[]; rels: readonly PeopleRel[] }
export const PEOPLE_GUIDES: readonly PeopleGuide[];
export const PEOPLE_SECTION_CAP: number;
export const PEOPLE_TYPE_MAX: number;
export const PEOPLE_UNDER_25_MIN: number;
export const RELATION_PAGES: Readonly<Record<string, { guide: string; label: string }>>;
export const OLD_PEOPLE_SLUGS: Readonly<Record<string, string>>;
export const OLD_PEOPLE_ANCHORS: Readonly<Record<string, Readonly<Record<string, string>>>>;
export function peopleGuideOf(slug: string): string | null;
export const OWNER_LIST_GUIDES: readonly string[];
export function isOwnerList(slug: string): boolean;
