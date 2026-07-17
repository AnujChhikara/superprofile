import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { provisionHostname } from "../src/domains/azure.js";

// Regression test for "create cert failed: 400". The managed-certificate PUT
// (Microsoft.Web/certificates) is a *tracked* ARM resource: it requires a
// top-level `location` and a `serverFarmId` that points at the specific App
// Service Plan. Previously the code sent `location: undefined` and a
// serverfarms *collection* path with no plan name — both make ARM return 400.

interface Call {
  url: string;
  method: string;
  body: any;
}

function resp(ok: boolean, body: unknown) {
  return {
    ok,
    status: ok ? 200 : 400,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

// What a real site GET returns — the region + plan id live here.
const SITE = {
  location: "eastus",
  properties: {
    customDomainVerificationId: "VERIF123",
    serverFarmId:
      "/subscriptions/sub/resourceGroups/rg/providers/Microsoft.Web/serverfarms/my-plan",
  },
};

describe("provisionHostname (Azure managed cert)", () => {
  let calls: Call[];

  beforeEach(() => {
    calls = [];
    process.env.IDENTITY_ENDPOINT = "http://169.254.169.254/msi/token";
    process.env.IDENTITY_HEADER = "header-secret";

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, opts?: RequestInit) => {
        const u = String(url);
        const method = opts?.method ?? "GET";
        const body = opts?.body ? JSON.parse(String(opts.body)) : undefined;
        calls.push({ url: u, method, body });

        if (u.includes("/msi/")) return resp(true, { access_token: "tok" });
        if (u.includes("/certificates/"))
          return method === "GET"
            ? resp(true, { properties: { thumbprint: "THUMB" } })
            : resp(true, {}); // cert PUT succeeds
        if (u.includes("/hostNameBindings/")) return resp(true, {});
        if (u.includes("/sites/")) return resp(true, SITE); // site GET
        return resp(false, { error: `unexpected ${method} ${u}` });
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.IDENTITY_ENDPOINT;
    delete process.env.IDENTITY_HEADER;
  });

  it("sends location + plan-scoped serverFarmId on the certificate PUT", async () => {
    await provisionHostname("testing.example.com");

    const certPut = calls.find(
      (c) => c.url.includes("/certificates/") && c.method === "PUT"
    );
    expect(certPut, "certificate PUT was issued").toBeDefined();

    // The two fields that were causing the 400:
    expect(certPut!.body.location).toBe("eastus");
    expect(certPut!.body.properties.serverFarmId).toBe(SITE.properties.serverFarmId);
    // Must be the specific plan, not the serverfarms collection path.
    expect(certPut!.body.properties.serverFarmId).toMatch(/\/serverfarms\/[^/]+$/);
    expect(certPut!.body.properties.canonicalName).toBe("testing.example.com");
  });
});
