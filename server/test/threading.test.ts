import { describe, it, expect } from "vitest";
import {
  pickThreadCandidates,
  parseAddress,
  workspaceSlugFromRecipient,
  newMessageId,
  htmlToText,
} from "../src/email/threading.js";

describe("email threading", () => {
  it("orders candidates: In-Reply-To first, then References newest-first", () => {
    expect(
      pickThreadCandidates({
        inReplyTo: "<c@x>",
        references: "<a@x> <b@x> <c@x>",
      })
    ).toEqual(["<c@x>", "<b@x>", "<a@x>"]);
  });

  it("handles missing headers", () => {
    expect(
      pickThreadCandidates({ inReplyTo: undefined, references: undefined })
    ).toEqual([]);
  });

  it("dedupes when In-Reply-To also appears in References", () => {
    expect(
      pickThreadCandidates({ inReplyTo: "<b@x>", references: "<a@x> <b@x>" })
    ).toEqual(["<b@x>", "<a@x>"]);
  });

  it("parses display-name addresses", () => {
    expect(parseAddress("Jane Doe <jane@ex.com>")).toEqual({
      name: "Jane Doe",
      email: "jane@ex.com",
    });
    expect(parseAddress("jane@ex.com")).toEqual({
      name: null,
      email: "jane@ex.com",
    });
  });

  it("extracts workspace slug from recipient", () => {
    expect(
      workspaceSlugFromRecipient(
        "acme@parse.anujchhikara.com",
        "parse.anujchhikara.com"
      )
    ).toBe("acme");
    expect(
      workspaceSlugFromRecipient("bob@gmail.com", "parse.anujchhikara.com")
    ).toBeNull();
  });

  it("builds a message id from a row id", () => {
    expect(newMessageId("abc", "parse.anujchhikara.com")).toBe(
      "<msg-abc@parse.anujchhikara.com>"
    );
  });

  it("strips html to text", () => {
    expect(htmlToText("<p>Hello <b>there</b></p>")).toContain("Hello");
    expect(htmlToText("<p>Hello <b>there</b></p>")).not.toContain("<b>");
  });
});
