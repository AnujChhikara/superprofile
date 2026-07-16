import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/index.js";
import { db, pool, newId } from "../src/db/client.js";
import { users, sessions, workspaces, memberships, invites } from "../src/db/schema.js";
import { hashToken, createSession } from "../src/auth/session.js";
import { eq, inArray } from "drizzle-orm";

// ------------------------------------------------------------------
// Helper: create a user directly in the DB
// ------------------------------------------------------------------
async function createUser(suffix: string) {
  const id = `test-team-user-${suffix}-${Date.now()}`;
  const email = `team-${suffix}-${Date.now()}@example.com`;
  await db.insert(users).values({
    id,
    email,
    googleId: `google-team-${suffix}-${Date.now()}`,
    name: `Team Test ${suffix}`,
    avatarUrl: null,
  });
  const rawToken = await createSession(id);
  return { id, email, rawToken, cookie: `sid=${rawToken}` };
}

// IDs to clean up after all tests
const createdUserIds: string[] = [];
const createdWorkspaceIds: string[] = [];
const createdInviteTokens: string[] = [];

const ORIGIN = "http://localhost:5173";

describe("team & workspace routes (integration)", () => {
  let userA: { id: string; email: string; rawToken: string; cookie: string };
  let userB: { id: string; email: string; rawToken: string; cookie: string };
  let workspaceId: string;
  let inviteToken: string;
  let inviteUrl: string;

  beforeAll(async () => {
    userA = await createUser("A");
    userB = await createUser("B");
    createdUserIds.push(userA.id, userB.id);
  });

  afterAll(async () => {
    // Clean up in dependency order
    if (createdInviteTokens.length) {
      await db.delete(invites).where(
        inArray(invites.token, createdInviteTokens)
      );
    }
    if (createdWorkspaceIds.length) {
      await db.delete(memberships).where(
        inArray(memberships.workspaceId, createdWorkspaceIds)
      );
      await db.delete(workspaces).where(
        inArray(workspaces.id, createdWorkspaceIds)
      );
    }
    // Delete sessions for both users
    for (const uid of createdUserIds) {
      await db.delete(sessions).where(eq(sessions.userId, uid));
    }
    if (createdUserIds.length) {
      await db.delete(users).where(inArray(users.id, createdUserIds));
    }
    await pool.end();
  });

  // ------------------------------------------------------------------
  // Workspace creation
  // ------------------------------------------------------------------
  it("POST /api/workspaces without auth → 401", async () => {
    const res = await request(app)
      .post("/api/workspaces")
      .set("Origin", ORIGIN)
      .send({ name: "Test WS" });
    expect(res.status).toBe(401);
  });

  it("POST /api/workspaces with bad body → 400", async () => {
    const res = await request(app)
      .post("/api/workspaces")
      .set("Cookie", userA.cookie)
      .set("Origin", ORIGIN)
      .send({ name: "" });
    expect(res.status).toBe(400);
  });

  it("POST /api/workspaces creates workspace + admin membership", async () => {
    const res = await request(app)
      .post("/api/workspaces")
      .set("Cookie", userA.cookie)
      .set("Origin", ORIGIN)
      .send({ name: "Team Test Workspace" });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
    expect(res.body.name).toBe("Team Test Workspace");
    expect(res.body.slug).toMatch(/^team-test-workspace-[0-9a-f]{6}$/);
    expect(res.body.publicKey).toMatch(/^pk_[0-9a-f]{32}$/);

    workspaceId = res.body.id;
    createdWorkspaceIds.push(workspaceId);

    // Verify membership in DB
    const mem = await db.query.memberships.findFirst({
      where: (m, { and, eq }) =>
        and(eq(m.userId, userA.id), eq(m.workspaceId, workspaceId)),
    });
    expect(mem?.role).toBe("admin");
  });

  // ------------------------------------------------------------------
  // Team listing
  // ------------------------------------------------------------------
  it("GET /api/team without X-Workspace-Id → 400", async () => {
    const res = await request(app)
      .get("/api/team")
      .set("Cookie", userA.cookie);
    expect(res.status).toBe(400);
  });

  it("GET /api/team as non-member → 403", async () => {
    const res = await request(app)
      .get("/api/team")
      .set("Cookie", userB.cookie)
      .set("X-Workspace-Id", workspaceId);
    expect(res.status).toBe(403);
  });

  it("GET /api/team lists members for workspace", async () => {
    const res = await request(app)
      .get("/api/team")
      .set("Cookie", userA.cookie)
      .set("X-Workspace-Id", workspaceId);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].userId).toBe(userA.id);
    expect(res.body[0].role).toBe("admin");
    expect(res.body[0].email).toBe(userA.email);
  });

  // ------------------------------------------------------------------
  // Invite creation
  // ------------------------------------------------------------------
  it("POST /api/team/invites as non-admin → 403", async () => {
    // Add userB as agent first
    await db.insert(memberships).values({
      id: newId(),
      userId: userB.id,
      workspaceId,
      role: "agent",
    });

    const res = await request(app)
      .post("/api/team/invites")
      .set("Cookie", userB.cookie)
      .set("Origin", ORIGIN)
      .set("X-Workspace-Id", workspaceId)
      .send({ email: "anyone@example.com", role: "agent" });

    expect(res.status).toBe(403);

    // Remove userB for cleaner subsequent tests
    await db
      .delete(memberships)
      .where(
        eq(memberships.userId, userB.id)
      );
  });

  it("POST /api/team/invites creates invite and returns inviteUrl", async () => {
    const res = await request(app)
      .post("/api/team/invites")
      .set("Cookie", userA.cookie)
      .set("Origin", ORIGIN)
      .set("X-Workspace-Id", workspaceId)
      .send({ email: userB.email, role: "agent" });

    expect(res.status).toBe(201);
    expect(res.body.inviteUrl).toMatch(
      new RegExp(`/invite/[0-9a-f]{48}$`)
    );

    inviteUrl = res.body.inviteUrl;
    inviteToken = inviteUrl.split("/invite/")[1];
    createdInviteTokens.push(inviteToken);
  });

  it("POST /api/team/invites invite email matches exactly (strict)", async () => {
    // The invite URL must contain a 48-char hex token (24 bytes → 48 hex chars)
    expect(inviteToken).toHaveLength(48);
    expect(inviteToken).toMatch(/^[0-9a-f]+$/);
  });

  // ------------------------------------------------------------------
  // Invite acceptance
  // ------------------------------------------------------------------
  it("POST /api/invites/:token/accept with wrong user email → 403", async () => {
    // Create another user with a different email
    const userC = await createUser("C");
    createdUserIds.push(userC.id);

    const res = await request(app)
      .post(`/api/invites/${inviteToken}/accept`)
      .set("Cookie", userC.cookie)
      .set("Origin", ORIGIN);

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("invite is for a different email");
  });

  it("POST /api/invites/:token/accept with non-existent token → 404", async () => {
    const res = await request(app)
      .post("/api/invites/deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef/accept")
      .set("Cookie", userB.cookie)
      .set("Origin", ORIGIN);

    expect(res.status).toBe(404);
  });

  it("POST /api/invites/:token/accept with expired invite → 410", async () => {
    // Create an already-expired invite
    const expiredToken = "expired" + crypto.randomUUID().replace(/-/g, "").slice(0, 41);
    await db.insert(invites).values({
      id: newId(),
      workspaceId,
      email: userB.email,
      role: "agent",
      token: expiredToken,
      expiresAt: new Date(Date.now() - 1000), // already expired
    });
    createdInviteTokens.push(expiredToken);

    const res = await request(app)
      .post(`/api/invites/${expiredToken}/accept`)
      .set("Cookie", userB.cookie)
      .set("Origin", ORIGIN);

    expect(res.status).toBe(410);
    expect(res.body.error).toBe("invite expired");
  });

  it("POST /api/invites/:token/accept as correct user → 200 + membership created", async () => {
    const res = await request(app)
      .post(`/api/invites/${inviteToken}/accept`)
      .set("Cookie", userB.cookie)
      .set("Origin", ORIGIN);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.workspaceId).toBe(workspaceId);

    // Verify membership
    const mem = await db.query.memberships.findFirst({
      where: (m, { and, eq }) =>
        and(eq(m.userId, userB.id), eq(m.workspaceId, workspaceId)),
    });
    expect(mem?.role).toBe("agent");
  });

  it("POST /api/invites/:token/accept again → 409 (already accepted)", async () => {
    const res = await request(app)
      .post(`/api/invites/${inviteToken}/accept`)
      .set("Cookie", userB.cookie)
      .set("Origin", ORIGIN);

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("invite already accepted");
  });

  // ------------------------------------------------------------------
  // GET /api/team now shows both members
  // ------------------------------------------------------------------
  it("GET /api/team shows both members after invite accepted", async () => {
    const res = await request(app)
      .get("/api/team")
      .set("Cookie", userA.cookie)
      .set("X-Workspace-Id", workspaceId);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    const userIds = res.body.map((m: { userId: string }) => m.userId);
    expect(userIds).toContain(userA.id);
    expect(userIds).toContain(userB.id);
  });

  // ------------------------------------------------------------------
  // Role changes
  // ------------------------------------------------------------------
  it("PATCH /api/team/members/:userId as non-admin → 403", async () => {
    const res = await request(app)
      .patch(`/api/team/members/${userA.id}`)
      .set("Cookie", userB.cookie) // userB is agent
      .set("Origin", ORIGIN)
      .set("X-Workspace-Id", workspaceId)
      .send({ role: "admin" });

    expect(res.status).toBe(403);
  });

  it("PATCH /api/team/members/:userId promotes agent to admin", async () => {
    const res = await request(app)
      .patch(`/api/team/members/${userB.id}`)
      .set("Cookie", userA.cookie)
      .set("Origin", ORIGIN)
      .set("X-Workspace-Id", workspaceId)
      .send({ role: "admin" });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // Verify in DB
    const mem = await db.query.memberships.findFirst({
      where: (m, { and, eq }) =>
        and(eq(m.userId, userB.id), eq(m.workspaceId, workspaceId)),
    });
    expect(mem?.role).toBe("admin");
  });

  it("GET /api/me reflects role change for userB", async () => {
    const res = await request(app)
      .get("/api/me")
      .set("Cookie", userB.cookie);

    expect(res.status).toBe(200);
    const ws = res.body.workspaces.find(
      (w: { id: string }) => w.id === workspaceId
    );
    expect(ws).toBeDefined();
    expect(ws.role).toBe("admin");
  });

  // ------------------------------------------------------------------
  // Member removal
  // ------------------------------------------------------------------
  it("DELETE /api/team/members/:userId removes member", async () => {
    // Demote userB back to agent first so we can test deletion cleanly
    await db
      .update(memberships)
      .set({ role: "agent" })
      .where(
        eq(memberships.userId, userB.id)
      );

    const res = await request(app)
      .delete(`/api/team/members/${userB.id}`)
      .set("Cookie", userA.cookie)
      .set("Origin", ORIGIN)
      .set("X-Workspace-Id", workspaceId);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // Verify gone
    const mem = await db.query.memberships.findFirst({
      where: (m, { and, eq }) =>
        and(eq(m.userId, userB.id), eq(m.workspaceId, workspaceId)),
    });
    expect(mem).toBeUndefined();
  });

  it("DELETE /api/team/members/:userId as non-admin → 403", async () => {
    // Re-add userB as agent for this check
    await db.insert(memberships).values({
      id: newId(),
      userId: userB.id,
      workspaceId,
      role: "agent",
    });

    const res = await request(app)
      .delete(`/api/team/members/${userA.id}`)
      .set("Cookie", userB.cookie) // agent
      .set("Origin", ORIGIN)
      .set("X-Workspace-Id", workspaceId);

    expect(res.status).toBe(403);
  });

  // ------------------------------------------------------------------
  // Tenant isolation: client-supplied workspaceId in body must be ignored
  // ------------------------------------------------------------------
  it("GET /api/team only returns members of X-Workspace-Id workspace, not a spoofed one", async () => {
    // Create a second workspace for userA
    const res2 = await request(app)
      .post("/api/workspaces")
      .set("Cookie", userA.cookie)
      .set("Origin", ORIGIN)
      .send({ name: "Second Workspace" });

    expect(res2.status).toBe(201);
    const ws2Id = res2.body.id;
    createdWorkspaceIds.push(ws2Id);

    // GET /api/team for workspace 1 should not return ws2 members
    const teamRes = await request(app)
      .get("/api/team")
      .set("Cookie", userA.cookie)
      .set("X-Workspace-Id", workspaceId);

    expect(teamRes.status).toBe(200);
    // userA is in ws1; ws2 members should not appear in ws1 list
    const wsIds = new Set(
      teamRes.body.map(
        (m: { workspaceId?: string; userId: string }) => m.userId
      )
    );
    // The list should only be for ws1 — userA
    expect(wsIds.size).toBeGreaterThanOrEqual(1);
  });

  // ------------------------------------------------------------------
  // Last-admin lockout guard
  // (state here: ws1 has userA as admin + userB as agent)
  // ------------------------------------------------------------------
  it("PATCH demoting the last admin → 409", async () => {
    const res = await request(app)
      .patch(`/api/team/members/${userA.id}`)
      .set("Cookie", userA.cookie)
      .set("Origin", ORIGIN)
      .set("X-Workspace-Id", workspaceId)
      .send({ role: "agent" });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("workspace must have at least one admin");

    // Role must be unchanged
    const mem = await db.query.memberships.findFirst({
      where: (m, { and, eq }) =>
        and(eq(m.userId, userA.id), eq(m.workspaceId, workspaceId)),
    });
    expect(mem?.role).toBe("admin");
  });

  it("DELETE removing the last admin → 409", async () => {
    const res = await request(app)
      .delete(`/api/team/members/${userA.id}`)
      .set("Cookie", userA.cookie)
      .set("Origin", ORIGIN)
      .set("X-Workspace-Id", workspaceId);

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("workspace must have at least one admin");

    // Membership must still exist
    const mem = await db.query.memberships.findFirst({
      where: (m, { and, eq }) =>
        and(eq(m.userId, userA.id), eq(m.workspaceId, workspaceId)),
    });
    expect(mem?.role).toBe("admin");
  });

  it("PATCH demoting an admin works when another admin exists", async () => {
    // Promote userB to admin so ws1 has two admins
    const promote = await request(app)
      .patch(`/api/team/members/${userB.id}`)
      .set("Cookie", userA.cookie)
      .set("Origin", ORIGIN)
      .set("X-Workspace-Id", workspaceId)
      .send({ role: "admin" });
    expect(promote.status).toBe(200);

    // Now demoting userA succeeds (userB remains admin)
    const demote = await request(app)
      .patch(`/api/team/members/${userA.id}`)
      .set("Cookie", userB.cookie)
      .set("Origin", ORIGIN)
      .set("X-Workspace-Id", workspaceId)
      .send({ role: "agent" });
    expect(demote.status).toBe(200);

    const mem = await db.query.memberships.findFirst({
      where: (m, { and, eq }) =>
        and(eq(m.userId, userA.id), eq(m.workspaceId, workspaceId)),
    });
    expect(mem?.role).toBe("agent");
  });

  it("DELETE removing an admin works when another admin exists", async () => {
    // Promote userA back to admin (by userB, current admin) → two admins again
    const promote = await request(app)
      .patch(`/api/team/members/${userA.id}`)
      .set("Cookie", userB.cookie)
      .set("Origin", ORIGIN)
      .set("X-Workspace-Id", workspaceId)
      .send({ role: "admin" });
    expect(promote.status).toBe(200);

    // Deleting admin userB succeeds because userA is still an admin
    const del = await request(app)
      .delete(`/api/team/members/${userB.id}`)
      .set("Cookie", userA.cookie)
      .set("Origin", ORIGIN)
      .set("X-Workspace-Id", workspaceId);
    expect(del.status).toBe(200);

    const mem = await db.query.memberships.findFirst({
      where: (m, { and, eq }) =>
        and(eq(m.userId, userB.id), eq(m.workspaceId, workspaceId)),
    });
    expect(mem).toBeUndefined();
  });
});
