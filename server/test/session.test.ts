import { describe, it, expect } from "vitest";
import { hashToken, sessionCookieOptions } from "../src/auth/session.js";

describe("sessions", () => {
  it("hashes tokens deterministically and never stores raw", () => {
    expect(hashToken("abc")).toBe(hashToken("abc"));
    expect(hashToken("abc")).not.toContain("abc");
    expect(hashToken("abc")).toHaveLength(64); // sha256 hex
  });
  it("cookie options are HttpOnly + SameSite=Lax", () => {
    const o = sessionCookieOptions();
    expect(o.httpOnly).toBe(true);
    expect(o.sameSite).toBe("lax");
    expect(o.maxAge).toBe(7 * 24 * 3600 * 1000);
  });
});
