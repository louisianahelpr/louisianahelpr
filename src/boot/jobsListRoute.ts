/**
 * Starts the Posted / Working lists' chunk on a cold link that opens on one, for routePreload.ts (B52, 11-03).
 *
 * JobsSection loads JobListPage lazily (Q1158/Q654): the section opens on Browse, and static, the lists put JobListPage
 * and the offer, activity and payment handlers only they run on Browse's boot download. A cold link that opens on a
 * list (a ?tab=posted|working link or an old My Jobs link) must not wait for JobsSection to run before its code
 * starts, so the entry starts this tiny chunk beside the section's, and it starts the lists' chunk.
 *
 * Its own chunk because a dynamic import's preload list lives in the file that holds the import: in the entry,
 * JobListPage's list and this URL test cost every visitor entry bytes on every page (B46 measured the entry over its
 * band that way). Here they cost a signed-in /jobs load one small chunk, and a list link one round.
 *
 * Same rules as routePreload.ts: no static imports. The links it adds are this page's own, so they carry the mark
 * index.html's boot watchdog skips (PAGE_PRELOAD_ATTR there; copied, as an import would be a cycle with the entry).
 * JobsSection's lazy import of the same module owns any failure.
 */
const before = new Set(document.querySelectorAll('link[rel="modulepreload"]'));
if (jobListsOpenFirst(location.pathname, location.search)) {
  import("@/components/job-card/JobListPage").catch(() => {
    /* JobsSection's lazy import of the same module owns the failure */
  });
}
for (const link of document.querySelectorAll('link[rel="modulepreload"]')) {
  if (!before.has(link)) link.setAttribute("data-lh-page-preload", "");
}

/**
 * True when a cold /jobs load draws the Posted or Working list first (exported for its test): JobsSection.resolveJobsTab's
 * rule (a list ?tab=, or no ?tab= and one of the old My Jobs link params, MY_JOBS_LINK_PARAMS). Copied, as nothing here
 * may import the page; src/boot/jobListsLoadAlone.test.ts holds it equal to resolveJobsTab and to jobsPrefetch's
 * jobsOpensOnList for every link shape.
 *
 * Not on /posts (App.tsx sends it to /jobs?tab=posted): measured, starting the lists there beside /posts' small boot
 * download held the app's first frame back 3111 -> 4490 ms (lab, 375). PostsPage's own chunk starts the lists instead.
 */
export function jobListsOpenFirst(pathname: string, search: string): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (path !== "/jobs") return false;
  const p = new URLSearchParams(search);
  const tab = p.get("tab");
  return tab ? tab === "posted" || tab === "working" : ["job", "filter", "highlight", "q", "quotes"].some((k) => p.has(k));
}
