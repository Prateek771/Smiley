import { randomUUID } from "node:crypto";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool, PoolClient } from "pg";
import { appPool, loadEnvironment } from "../db/client";
import { authUser, authSession, authAccount, authVerification } from "../db/auth-schema";

loadEnvironment();

export class AuthError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "AuthError";
  }
}
export type StaffSession = {
  authUserId: string;
  userId: string;
  hospitalId: string;
  email: string;
  name: string;
  roles: string[];
  branchIds: string[];
  branchRoles: { branchId: string; role: string }[];
};

export function createAuth(client: Pool | PoolClient = appPool, transaction = true) {
  if (!process.env.BETTER_AUTH_SECRET || process.env.BETTER_AUTH_SECRET.length < 32 || !process.env.BETTER_AUTH_URL) {
    throw new Error("Staff authentication requires a random BETTER_AUTH_SECRET and explicit BETTER_AUTH_URL.");
  }
  return betterAuth({
    appName: "Smiley Claims Desk",
    baseURL: process.env.BETTER_AUTH_URL,
    secret: process.env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(drizzle(client), {
      provider: "pg", transaction,
      schema: { user: authUser, session: authSession, account: authAccount, verification: authVerification },
    }),
    emailAndPassword: { enabled: true, autoSignIn: false, minPasswordLength: 12, maxPasswordLength: 128 },
    session: { expiresIn: 60 * 60 * 8, updateAge: 60 * 30, cookieCache: { enabled: false } },
    advanced: { database: { generateId: () => randomUUID() } },
    trustedOrigins: process.env.BETTER_AUTH_URL ? [process.env.BETTER_AUTH_URL] : [],
    logger: { level: "error" },
  });
}
type AuthInstance = ReturnType<typeof createAuth>;
let authInstance: AuthInstance | undefined;
// Keep public routes and production builds independent of private runtime configuration.
export const auth = new Proxy({} as AuthInstance, {
  get(_target, property) {
    authInstance ??= createAuth();
    return Reflect.get(authInstance, property);
  },
});

export async function lookupStaff(client: PoolClient, authUserId: string): Promise<StaffSession | null> {
  const result = await client.query(
    `SELECT u.user_id,u.hospital_id,u.email,a.name
     FROM users u JOIN auth_user a ON a.id=u.auth_user_id
     JOIN staff s ON s.staff_id=u.staff_id AND s.hospital_id=u.hospital_id
     JOIN hospitals h ON h.hospital_id=u.hospital_id
     WHERE u.auth_user_id=$1 AND u.status='ACTIVE' AND s.status='ACTIVE' AND h.status='ACTIVE'`,
    [authUserId],
  );
  if (result.rowCount !== 1) return null;
  const user = result.rows[0];
  const roles = await client.query(
    `SELECT r.role_code FROM user_roles ur JOIN roles r ON r.role_id=ur.role_id
     WHERE ur.user_id=$1 AND ur.hospital_id=$2 AND r.status='ACTIVE' ORDER BY r.role_code`,
    [user.user_id, user.hospital_id],
  );
  if (!roles.rowCount) return null;
  const branches = await client.query(
    `SELECT m.branch_id,r.role_code FROM user_branch_memberships m
     JOIN branches b ON b.branch_id=m.branch_id AND b.hospital_id=m.hospital_id
     JOIN roles r ON r.role_id=m.role_id
     WHERE m.user_id=$1 AND m.hospital_id=$2 AND m.status='ACTIVE' AND b.status='ACTIVE' AND r.status='ACTIVE'
     ORDER BY m.branch_id,r.role_code`,
    [user.user_id, user.hospital_id],
  );
  const roleCodes = roles.rows.map((row) => String(row.role_code));
  let branchRoles = branches.rows.map((row) => ({ branchId: String(row.branch_id), role: String(row.role_code) }));
  if (roleCodes.includes("SUPER_ADMIN")) {
    branchRoles = [];
  } else if (roleCodes.includes("HOSPITAL_ADMIN")) {
    const hospitalBranches = await client.query("SELECT branch_id FROM branches WHERE hospital_id=$1 AND status='ACTIVE' ORDER BY branch_id", [user.hospital_id]);
    branchRoles.push(...hospitalBranches.rows.map((row) => ({ branchId: String(row.branch_id), role: "HOSPITAL_ADMIN" })));
    branchRoles = [...new Map(branchRoles.map((grant) => [`${grant.branchId}:${grant.role}`, grant])).values()];
    branchRoles.sort((a, b) => a.branchId.length - b.branchId.length || a.branchId.localeCompare(b.branchId) || a.role.localeCompare(b.role));
  }
  return {
    authUserId, userId: String(user.user_id), hospitalId: String(user.hospital_id),
    email: user.email, name: user.name,
    roles: roleCodes,
    branchRoles, branchIds: [...new Set(branchRoles.map((grant) => grant.branchId))],
  };
}
export async function setIdentityContext(client: PoolClient, authUserId: string) {
  await client.query("SELECT set_config('app.auth_user_id',$1,true)", [authUserId]);
}
export async function getStaffSession(headers: Headers): Promise<StaffSession | null> {
  if (!headers.get("cookie")) return null;
  const session = await auth.api.getSession({ headers, query: { disableCookieCache: true } });
  if (!session || session.session.expiresAt.getTime() <= Date.now()) return null;
  const client = await appPool.connect();
  try {
    await client.query("BEGIN");
    await setIdentityContext(client, session.user.id);
    const actor = await lookupStaff(client, session.user.id);
    await client.query("COMMIT");
    return actor;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
export async function requireStaffSession(headers: Headers): Promise<StaffSession> {
  const actor = await getStaffSession(headers);
  if (!actor) throw new AuthError(401, "Sign in with an active staff account.");
  return actor;
}

export async function handleAuthRequest(request: Request): Promise<Response> {
  const path = new URL(request.url).pathname.replace(/^\/api\/auth/u, "");
  const allowed = (request.method === "POST" && ["/sign-in/email", "/sign-out"].includes(path))
    || (request.method === "GET" && path === "/get-session");
  if (!allowed) return Response.json({ error: "Authentication endpoint not available." }, { status: 404 });
  if (request.method === "GET" && !(await getStaffSession(request.headers))) {
    return Response.json(null, { headers: { "cache-control": "no-store" } });
  }
  const response = await auth.handler(request);
  if (path === "/sign-in/email" && response.ok) {
    const cookies = response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
    const sessionHeaders = new Headers({ cookie: cookies });
    if (!(await getStaffSession(sessionHeaders))) {
      await auth.api.signOut({ headers: sessionHeaders }).catch(() => undefined);
      return Response.json({ error: "Sign in with an active staff account." }, { status: 401 });
    }
  }
  response.headers.set("cache-control", "no-store");
  return response;
}
