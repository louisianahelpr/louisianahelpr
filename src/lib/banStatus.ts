// One definition of "is this account locked out right now", shared with the
// edge functions: see supabase/functions/_shared/banStatus.ts.
export { isLockedOut } from "../../supabase/functions/_shared/banStatus";
