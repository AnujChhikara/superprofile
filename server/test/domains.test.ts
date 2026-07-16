import { describe, it, expect } from "vitest";
import { validateHostname, advanceDomain } from "../src/domains/service.js";

describe("custom domain state machine", () => {
  it("pending + bad DNS stays pending with a helpful error", async () => {
    let provisioned = false;
    const res = await advanceDomain(
      { hostname: "help.acme.com", status: "pending_dns" },
      {
        checkDns: async () => ({ cnameOk: false, txtOk: false }),
        provisionDomain: async () => {
          provisioned = true;
        },
      }
    );
    expect(res.status).toBe("pending_dns");
    expect(res.error).toBeTruthy();
    expect(provisioned).toBe(false);
  });

  it("pending + good DNS → verifying and provision called once", async () => {
    let calls = 0;
    const res = await advanceDomain(
      { hostname: "help.acme.com", status: "pending_dns" },
      {
        checkDns: async () => ({ cnameOk: true, txtOk: true }),
        provisionDomain: async () => {
          calls += 1;
        },
      }
    );
    expect(res.status).toBe("verifying");
    expect(calls).toBe(1);
  });

  it("validateHostname rejects our own hosts, lowercases, rejects non-domains", () => {
    const api = "api.anujchhikara.com";
    const kb = "kb.anujchhikara.com";
    expect(validateHostname("API.ANUJCHHIKARA.COM", api, kb).ok).toBe(false);
    expect(validateHostname("kb.anujchhikara.com", api, kb).ok).toBe(false);
    expect(validateHostname("Help.Acme.COM", api, kb)).toMatchObject({
      ok: true,
      hostname: "help.acme.com",
    });
    expect(validateHostname("not a domain", api, kb).ok).toBe(false);
    expect(validateHostname("localhost", api, kb).ok).toBe(false);
  });
});
