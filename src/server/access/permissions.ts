import type { StaffSession } from "../auth";

export const permissions = ["case:read", "patient:write", "case:write", "case:act", "document:read", "document:write", "billing:write", "finance:write", "staff:manage"] as const;
export type Permission = (typeof permissions)[number];
const deskRoles = ["INSURANCE_EXECUTIVE", "TPA_EXECUTIVE", "CLAIM_VERIFIER"];
const readRoles = [...deskRoles, "BILLING_OFFICER", "FINANCE_OFFICER", "REPORT_USER", "DOCTOR", "RECEPTIONIST"];

export function branchScope(actor: StaffSession, permission: Permission): string[] {
  if (actor.roles.includes("SUPER_ADMIN")) return [];
  const allowed = permission === "staff:manage" ? []
    : permission === "case:read" || permission === "document:read" ? readRoles
    : permission === "billing:write" ? ["BILLING_OFFICER"]
    : permission === "finance:write" ? ["FINANCE_OFFICER"]
    : permission === "patient:write" ? [...deskRoles, "RECEPTIONIST"] : deskRoles;
  return [...new Set(actor.branchRoles.filter((grant) =>
    grant.role === "HOSPITAL_ADMIN" || allowed.includes(grant.role),
  ).map((grant) => grant.branchId))];
}
