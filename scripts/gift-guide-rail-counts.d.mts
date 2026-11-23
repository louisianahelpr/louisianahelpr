export const HUB_FROM: string;
export const HUB_DAYS: number;
export interface HubSchedule { from: string; days: number; stay: number; gone: number[] }
export function buildHub(lights?: readonly object[], events?: readonly object[]): HubSchedule;
export function buildRailCounts(): { hub: HubSchedule; smallBiz: number };
export function railCountsText(c: { hub: HubSchedule; smallBiz: number }): string;
