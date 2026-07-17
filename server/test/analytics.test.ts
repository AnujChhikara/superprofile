import { describe, it, expect } from "vitest";
import { rangeToSince } from "../src/routes/analytics.js";

describe("rangeToSince", () => {
  const now = new Date("2026-07-17T12:00:00.000Z");
  const DAY = 24 * 60 * 60 * 1000;

  it("returns null for 'all' (no lower bound)", () => {
    expect(rangeToSince("all", now)).toBeNull();
  });

  it("returns now - 7 days for '7d'", () => {
    const since = rangeToSince("7d", now)!;
    expect(since.getTime()).toBe(now.getTime() - 7 * DAY);
  });

  it("returns now - 30 days for '30d'", () => {
    const since = rangeToSince("30d", now)!;
    expect(since.getTime()).toBe(now.getTime() - 30 * DAY);
  });

  it("returns now - 90 days for '90d'", () => {
    const since = rangeToSince("90d", now)!;
    expect(since.getTime()).toBe(now.getTime() - 90 * DAY);
  });

  it("does not mutate the provided now", () => {
    const t = now.getTime();
    rangeToSince("30d", now);
    expect(now.getTime()).toBe(t);
  });
});
