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
  /**
   * The member whose action caused this job notice (20261104060659, stamped by trg_notifications_stamp_actor),
   * or null: no actor, an admin's or the system's notice, or a departed member. The bell shows their face in
   * place of the type icon (useNotificationFaces).
   */
  actor_id?: string | null;
  created_at: string;
};

export type Filter = "all" | "unread";
