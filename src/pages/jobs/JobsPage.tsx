// My Jobs (/my-jobs): the jobs you applied to or are doing. The list itself is
// drawn by the job-card list page, which My Posts uses too.
import JobListPage from "@/components/job-card/JobListPage";

const JobsPage = () => <JobListPage defaultTab="applied" />;

export default JobsPage;
