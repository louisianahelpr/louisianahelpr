export type Notification = {
  id: string;
  user_id: string;
  title: string;
  message: string;
  type: string;
  read: boolean;
  link: string | null;
  /**
   * The job this notification is about (20260901035600), or null when it is
   * not about one — or when that job has since been deleted, since the FK is
   * ON DELETE SET NULL. Prefer it over parsing `link`: resolve a destination
   * with `notificationDestination()`, never by reading `link` directly.
   */
  job_id: string | null;
  created_at: string;
};

export type Filter = "all" | "unread";
