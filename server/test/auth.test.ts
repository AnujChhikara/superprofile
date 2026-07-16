import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/index.js";
import { db, pool } from "../src/db/client.js";
import { users, sessions } from "../src/db/schema.js";
import { eq } from "drizzle-orm";
import { hashToken, createSession } from "../src/auth/session.js";
import { newId } from "../src/db/client.js";

// Test user for DB round-trip tests
const TEST_USER_ID = "test-auth-user-" + Date.now();
const TEST_EMAIL = `auth-test-${Date.now()}@example.com`;

describe("auth routes (integration)", () => {
  beforeAll(async () => {
    // Insert a test user for session round-trip tests
    await db.insert(users).values({
      id: TEST_USER_ID,
      email: TEST_EMAIL,
      googleId: `google-${TEST_USER_ID}`,
      name: "Auth Test User",
      avatarUrl: null,
    });
  });

  afterAll(async () => {
    // Clean up: delete sessions for test user, then the user
    await db.delete(sessions).where(eq(sessions.userId, TEST_USER_ID));
    await db.delete(users).where(eq(users.id, TEST_USER_ID));
    await pool.end();
  });

  it("GET /api/auth/google → 302 to Google with oauth_state cookie", async () => {
    const res = await request(app).get("/api/auth/google");
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(
      /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth/
    );
    const setCookie = res.headers["set-cookie"] as string | string[];
    const cookieStr = Array.isArray(setCookie) ? setCookie.join("; ") : setCookie;
    expect(cookieStr).toMatch(/oauth_state=/);
    expect(cookieStr).toMatch(/HttpOnly/i);
  });

  it("GET /api/me without cookie → 401", async () => {
    const res = await request(app).get("/api/me");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("unauthenticated");
  });

  it("GET /api/auth/google/callback with missing state → 400", async () => {
    const res = await request(app)
      .get("/api/auth/google/callback")
      .query({ code: "somecode" });
    expect(res.status).toBe(400);
  });

  it("GET /api/auth/google/callback with mismatched state → 400", async () => {
    const badState = Buffer.from(JSON.stringify({ s: "wrongstate" })).toString(
      "base64url"
    );
    const res = await request(app)
      .get("/api/auth/google/callback")
      .set("Cookie", "oauth_state=differentvalue")
      .query({ code: "somecode", state: badState });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("state mismatch");
  });

  it("POST /api/auth/logout clears sid cookie", async () => {
    const res = await request(app)
      .post("/api/auth/logout")
      .set("Origin", "http://localhost:5173");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    // Set-Cookie MUST be present and clear sid (empty value + Max-Age=0 / past Expires)
    const setCookie = res.headers["set-cookie"] as string | string[] | undefined;
    expect(setCookie).toBeDefined();
    const cookieStr = Array.isArray(setCookie!)
      ? setCookie!.join("; ")
      : setCookie!;
    expect(cookieStr).toMatch(/sid=;/);
    expect(cookieStr).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/i);
  });

  it("POST with no Origin and no Referer → 403 (CSRF guard)", async () => {
    const res = await request(app).post("/api/auth/logout");
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("bad origin");
  });

  it("POST with matching Referer but no Origin → allowed", async () => {
    const res = await request(app)
      .post("/api/auth/logout")
      .set("Referer", "http://localhost:5173/settings");
    expect(res.status).toBe(200);
  });

  it("POST with wrong Origin → 403", async () => {
    const res = await request(app)
      .post("/api/auth/logout")
      .set("Origin", "https://evil.example.com");
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("bad origin");
  });

  it("createSession + getSessionUser DB round-trip", async () => {
    const { getSessionUser } = await import("../src/auth/session.js");
    const raw = await createSession(TEST_USER_ID);

    // Should find the user by raw token
    const found = await getSessionUser(raw);
    expect(found).not.toBeNull();
    expect(found?.id).toBe(TEST_USER_ID);
    expect(found?.email).toBe(TEST_EMAIL);

    // Should not find with wrong token
    const notFound = await getSessionUser("notavalidtoken");
    expect(notFound).toBeNull();

    // Clean up this session
    const { destroySession } = await import("../src/auth/session.js");
    await destroySession(raw);

    // Should no longer find
    const afterDestroy = await getSessionUser(raw);
    expect(afterDestroy).toBeNull();
  });

  it("GET /api/me with valid session cookie → 200 with user", async () => {
    const raw = await createSession(TEST_USER_ID);

    const res = await request(app)
      .get("/api/me")
      .set("Cookie", `sid=${raw}`);
    expect(res.status).toBe(200);
    expect(res.body.user).toBeDefined();
    expect(res.body.user.id).toBe(TEST_USER_ID);
    expect(res.body.workspaces).toBeInstanceOf(Array);

    // Clean up
    const { destroySession } = await import("../src/auth/session.js");
    await destroySession(raw);
  });
});
