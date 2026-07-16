import { describe, it, expect } from "vitest";
import { buildSummaryPrompt } from "../src/ai/summarize.js";

describe("summary prompt", () => {
  const msgs = Array.from({ length: 40 }, (_, i) => ({
    senderType: i % 2 ? "agent" : "contact",
    body: `m${i}`,
    createdAt: new Date(),
  }));

  it("caps included messages at 30", () => {
    const { user } = buildSummaryPrompt({
      previousSummary: null,
      newMessages: msgs as any,
    });
    const count = (user.match(/m\d+/g) ?? []).length;
    expect(count).toBeLessThanOrEqual(30);
  });

  it("includes previous summary for rolling updates", () => {
    const { user } = buildSummaryPrompt({
      previousSummary: "OLD SUMMARY",
      newMessages: msgs.slice(0, 3) as any,
    });
    expect(user).toContain("OLD SUMMARY");
  });

  it("system prompt demands the three sections", () => {
    const { system } = buildSummaryPrompt({
      previousSummary: null,
      newMessages: msgs.slice(0, 3) as any,
    });
    for (const s of [
      "What the customer wants",
      "What's been tried",
      "Current status",
    ])
      expect(system).toContain(s);
  });
});
