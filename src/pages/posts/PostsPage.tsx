// /posts (owner final decisions, 2026-10-19): My Posts is the Posted tab of
// Jobs & Posts now. Every old /posts link lands there with its params kept
// (/posts?filter=x -> /jobs?tab=posted&filter=x). The list itself is still
// the job-card list page, drawn by JobsSection.
import { Navigate, useLocation } from "react-router-dom";

const PostsPage = () => {
  const { search, hash } = useLocation();
  const p = new URLSearchParams(search);
  p.set("tab", "posted");
  return <Navigate to={`/jobs?${p.toString()}${hash}`} replace />;
};

export default PostsPage;
