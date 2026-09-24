// My Posts (/posts): the jobs you posted. The list itself is drawn by the
// job-card list page, which My Jobs uses too.
import JobListPage from "@/components/job-card/JobListPage";

const PostsPage = () => <JobListPage defaultTab="posted" />;

export default PostsPage;
