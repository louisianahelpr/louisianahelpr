/**
 * Permission table for the B2B workspace roles.
 *
 * Roles live on `business_members.extended_role` (migration
 * 20260609170000). The legacy `business_members.role` enum
 * (owner/member) is kept as a backward-compatibility shim — the new UI
 * always reads/writes `extended_role`.
 *
 * Keep this file SMALL and pure. Anything heavier (Supabase calls,
 * React state) belongs in a hook or component.
 */
import type { ExtendedRole } from "@/hooks/useMyBusiness";

export interface RoleSpec {
  id: Exclude<ExtendedRole, "owner">;
  label: string;
  blurb: string;
  /** Can this role post jobs under the business? */
  canPost: boolean;
  /** Can this role approve pending posts? */
  canApprove: boolean;
  /** Can this role manage team members and billing? */
  canManage: boolean;
}

/** Owner has every capability and can never be downgraded via UI. */
export const ROLE_SPECS: RoleSpec[] = [
  {
    id: "viewer",
    label: "Viewer",
    blurb: "Read-only access. Can browse posted jobs and the spend dashboard.",
    canPost: false,
    canApprove: false,
    canManage: false,
  },
  {
    id: "poster",
    label: "Poster",
    blurb: "Can post jobs on behalf of the business.",
    canPost: true,
    canApprove: false,
    canManage: false,
  },
  {
    id: "approver",
    label: "Approver",
    blurb: "Reviews and approves pending posts above the team threshold.",
    canPost: true,
    canApprove: true,
    canManage: false,
  },
  {
    id: "admin",
    label: "Admin",
    blurb: "Manages team members, billing, and approval threshold.",
    canPost: true,
    canApprove: true,
    canManage: true,
  },
];

export const ROLE_LABEL: Record<ExtendedRole, string> = {
  viewer: "Viewer",
  poster: "Poster",
  approver: "Approver",
  admin: "Admin",
  owner: "Owner",
};

function canPost(role: ExtendedRole): boolean {
  return role !== "viewer";
}

export function canApprove(role: ExtendedRole): boolean {
  return role === "owner" || role === "approver" || role === "admin";
}

export function canManageTeam(role: ExtendedRole): boolean {
  return role === "owner" || role === "admin";
}
