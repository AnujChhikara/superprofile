import { env } from "../env.js";

// Azure App Service custom-domain provisioning via ARM, authenticated with the
// App Service managed identity (MSI). Only runs in production on Azure; locally
// / in demo mode the simulate endpoint is used instead.

const ARM = "https://management.azure.com";

async function msiToken(): Promise<string> {
  const endpoint = process.env.IDENTITY_ENDPOINT;
  const header = process.env.IDENTITY_HEADER;
  if (!endpoint || !header) throw new Error("managed identity not available");
  const url = `${endpoint}?resource=${encodeURIComponent(
    ARM + "/"
  )}&api-version=2019-08-01`;
  const res = await fetch(url, { headers: { "X-IDENTITY-HEADER": header } });
  if (!res.ok) throw new Error(`MSI token failed: ${res.status}`);
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

function siteBase(): string {
  return `${ARM}/subscriptions/${env.AZURE_SUBSCRIPTION_ID}/resourceGroups/${env.AZURE_RESOURCE_GROUP}/providers/Microsoft.Web/sites/${env.AZURE_APP_NAME}`;
}

async function armFetch(
  token: string,
  path: string,
  method: string,
  body?: unknown
): Promise<Response> {
  return fetch(`${path}?api-version=2022-03-01`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

// Site metadata we need for domain provisioning (cached). `location` and
// `serverFarmId` come straight off the site resource — a managed certificate
// PUT requires both, so we read them here rather than duplicating config.
interface SiteInfo {
  verificationId: string;
  location: string;
  serverFarmId: string;
}
let cachedSite: SiteInfo | null = null;
export async function getSiteInfo(): Promise<SiteInfo> {
  if (cachedSite) return cachedSite;
  const token = await msiToken();
  const res = await armFetch(token, siteBase(), "GET");
  if (!res.ok) throw new Error(`get site failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as {
    location?: string;
    properties?: { customDomainVerificationId?: string; serverFarmId?: string };
  };
  const verificationId = data.properties?.customDomainVerificationId;
  const location = data.location;
  const serverFarmId = data.properties?.serverFarmId;
  if (!verificationId) throw new Error("no customDomainVerificationId");
  if (!location) throw new Error("no site location");
  if (!serverFarmId) throw new Error("no serverFarmId");
  cachedSite = { verificationId, location, serverFarmId };
  return cachedSite;
}

// The asuid TXT verification id for this App Service.
export async function getVerificationId(): Promise<string> {
  return (await getSiteInfo()).verificationId;
}

// Bind the hostname, issue a free managed cert, then SNI-bind it. Long-running
// (cert issuance polls up to ~5 min).
export async function provisionHostname(hostname: string): Promise<void> {
  const token = await msiToken();
  const base = siteBase();
  // Managed certs require the site's region + its App Service Plan resource id.
  const { location, serverFarmId } = await getSiteInfo();

  // 1) hostname binding (no SSL yet)
  let r = await armFetch(token, `${base}/hostNameBindings/${hostname}`, "PUT", {
    properties: { siteName: env.AZURE_APP_NAME, hostNameType: "Verified" },
  });
  if (!r.ok) throw new Error(`bind hostname failed: ${r.status} ${await r.text()}`);

  // 2) managed certificate — Microsoft.Web/certificates is a *tracked* ARM
  // resource: it requires a top-level `location` and a `serverFarmId` that
  // points at the specific App Service Plan (not the serverfarms collection).
  const certPath = `${ARM}/subscriptions/${env.AZURE_SUBSCRIPTION_ID}/resourceGroups/${env.AZURE_RESOURCE_GROUP}/providers/Microsoft.Web/certificates/cert-${hostname}`;
  r = await armFetch(token, certPath, "PUT", {
    location,
    properties: { canonicalName: hostname, serverFarmId },
  });
  if (!r.ok) throw new Error(`create cert failed: ${r.status} ${await r.text()}`);

  // Poll for the thumbprint.
  let thumbprint: string | undefined;
  for (let i = 0; i < 20; i++) {
    const g = await armFetch(token, certPath, "GET");
    if (g.ok) {
      const d = (await g.json()) as { properties?: { thumbprint?: string } };
      thumbprint = d.properties?.thumbprint;
      if (thumbprint) break;
    }
    await new Promise((res) => setTimeout(res, 15000));
  }
  if (!thumbprint) throw new Error("cert issuance timed out");

  // 3) SNI-bind the cert to the hostname
  r = await armFetch(token, `${base}/hostNameBindings/${hostname}`, "PUT", {
    properties: { sslState: "SniEnabled", thumbprint },
  });
  if (!r.ok) throw new Error(`ssl bind failed: ${r.status} ${await r.text()}`);
}
