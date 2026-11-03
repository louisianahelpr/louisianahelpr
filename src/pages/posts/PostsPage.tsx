// /posts (owner final decisions, 2026-10-19): My Posts is the Posted tab of
// Jobs & Posts now. Every old /posts link lands there with its params kept
// (/posts?filter=x -> /jobs?tab=posted&filter=x). The list itself is still
// the job-card list page, drawn by JobsSection.
import { Navigate, useLocation } from "react-router-dom";

// B52 (11-03): the list is JobsSection's lazy chunk (JobListPage) now. Started here, as this chunk runs, it downloads
// beside JobsSection's after the redirect, as it did when it was part of that chunk; started only when the section ran,
// /posts' first card came ~0.58 s later (lab, 375). Not from the entry: beside /posts' small boot download it held the
// first frame back 3.1 -> 4.5 s. JobsSection's lazy import of the same module owns any failure.
import("@/components/job-card/JobListPage").catch(() => {
  /* JobsSection's lazy import of the same module owns the failure */
});

const PostsPage = () => {
  const { search, hash } = useLocation();
  const p = new URLSearchParams(search);
  p.set("tab", "posted");
  return <Navigate to={`/jobs?${p.toString()}${hash}`} replace />;
};

export default PostsPage;
