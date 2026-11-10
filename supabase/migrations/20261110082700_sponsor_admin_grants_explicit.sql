-- 25 Days sponsor admin RPCs: restate their EXECUTE grants as plain statements (no change on prod; 20261109162829
-- granted them inside a DO-loop, which the ban-gate guard's migration scan cannot read, so the guard
-- called their ban-gate exemptions stale). Admin-only bodies; exemptions in scripts/ci/ban-gate-coverage.sql.
REVOKE ALL ON FUNCTION public.sponsor_admin_add_invite(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sponsor_admin_add_invite(text, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.sponsor_admin_add_signup(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sponsor_admin_add_signup(jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.sponsor_admin_delete_invite(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sponsor_admin_delete_invite(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.sponsor_admin_delete_testimonial(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sponsor_admin_delete_testimonial(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.sponsor_admin_move_day(uuid, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sponsor_admin_move_day(uuid, integer, integer) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.sponsor_admin_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sponsor_admin_overview() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.sponsor_admin_save_settings(integer, integer, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sponsor_admin_save_settings(integer, integer, integer, integer) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.sponsor_admin_save_testimonial(uuid, text, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sponsor_admin_save_testimonial(uuid, text, text, text, boolean) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.sponsor_admin_set_status(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sponsor_admin_set_status(uuid, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.sponsor_admin_set_wall(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sponsor_admin_set_wall(uuid, boolean) TO authenticated, service_role;
