import { useFeature } from "@/hooks/useFeature";

/**
 * "Add a bank once. Every payout from ... goes there." names only the sections
 * that pay THIS viewer (audit 2026-10-28 P4-1): the line used to name Jobs,
 * Declutter and your shop for everyone, while Declutter and Shops were still
 * behind their hidden switches. Jobs always pays out; Declutter and the shop
 * join the list only while their switch is on for the viewer.
 */
function payoutSourcesLine({ declutter, shops }: { declutter: boolean; shops: boolean }): string {
  const names = ["Jobs"];
  if (declutter) names.push("Declutter");
  if (shops) names.push("your shop");
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `Add a bank once. Every payout from ${list} goes there.`;
}

/**
 * The Jobs-only line, as a constant. The loading skeleton draws this: a skeleton
 * fetches nothing and reads no switch (skeletonsReadAsLoading renders it with no
 * QueryClient), and Jobs is the one section that pays every member.
 */
export const JOBS_ONLY_PAYOUT_LINE = payoutSourcesLine({ declutter: false, shops: false });

/** The line for the signed-in viewer. Both switches read false while loading, so it never names a hidden section. */
export function usePayoutSourcesLine(): string {
  const declutter = useFeature("declutter");
  const shops = useFeature("shops");
  return payoutSourcesLine({ declutter, shops });
}
