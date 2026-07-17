import { describe, it, expect } from "vitest";
import { buildDraftPrompt } from "../src/ai/draft.js";

describe("draft prompt", () => {
  it("forbids sign-offs / agent names and includes KB + transcript", () => {
    const { system, user } = buildDraftPrompt({
      summary: "Customer can't deploy.",
      lastMessages: [
        { senderType: "contact", body: "my deploy fails" },
        { senderType: "agent", body: "what error?" },
      ],
      kbArticles: [{ title: "Deploy guide", body: "run acme deploy" }],
    });
    expect(system).toContain("Do NOT add a sign-off");
    expect(user).toContain("Customer can't deploy.");
    expect(user).toContain("Deploy guide");
    expect(user).toContain("CUSTOMER: my deploy fails");
  });

  it("caps KB article bodies at 800 chars", () => {
    const long = "x".repeat(2000);
    const { user } = buildDraftPrompt({
      summary: null,
      lastMessages: [{ senderType: "contact", body: "hi" }],
      kbArticles: [{ title: "Big", body: long }],
    });
    const longestRun = Math.max(
      0,
      ...(user.match(/x+/g) ?? []).map((s) => s.length)
    );
    expect(longestRun).toBeLessThanOrEqual(800);
  });

  it("handles no KB matches gracefully", () => {
    const { user } = buildDraftPrompt({
      summary: null,
      lastMessages: [{ senderType: "contact", body: "hello" }],
      kbArticles: [],
    });
    expect(user).toContain("No relevant articles");
  });
});
