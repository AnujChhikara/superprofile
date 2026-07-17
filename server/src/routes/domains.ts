import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { db, newId } from "../db/client.js";
import { env } from "../env.js";
import { customDomains, workspaces } from "../db/schema.js";
import { and, eq } from "drizzle-orm";
import { requireAuth, requireWorkspace } from "../auth/middleware.js";
import { validateHostname, advanceDomain } from "../domains/service.js";
import { checkDns } from "../domains/dnsCheck.js";
import { getVerificationId, provisionHostname } from "../domains/azure.js";
import {
  renderCustomDomainKb,
  findPublishedArticleBySlug,
  categorySlugForArticle,
} from "./kbPublic.js";

const apiHost = new URL(env.API_ORIGIN).hostname;
const kbHost = env.KB_HOST.split(":")[0];
const expectedCname = `${env.AZURE_APP_NAME || "superprofile-api"}.azurewebsites.net`;

// Verification id for the asuid TXT record — from Azure on the platform, else a
// placeholder so the UI can still show the record shape in dev/demo.
async function verificationId(): Promise<string> {
  try {
    return await getVerificationId();
  } catch {
    // Not running on Azure (dev/demo) — show a placeholder in the record shape.
    return "see-azure-portal";
  }
}

function dnsRecords(hostname: string, vid: string) {
  const sub = hostname.split(".")[0];
  return [
    { type: "CNAME", name: sub, value: expectedCname },
    { type: "TXT", name: `asuid.${sub}`, value: vid },
  ];
}

export const domainsRouter = Router();
domainsRouter.use(requireAuth, requireWorkspace("admin"));

domainsRouter.get("/", async (req, res) => {
  const wsId = req.workspaceId!;
  const rows = await db
    .select()
    .from(customDomains)
    .where(eq(customDomains.workspaceId, wsId));
  const vid = await verificationId();
  return void res.json(
    rows.map((r) => ({ ...r, records: dnsRecords(r.hostname, vid) }))
  );
});

domainsRouter.post("/", async (req, res) => {
  const wsId = req.workspaceId!;
  const parsed = z.object({ hostname: z.string() }).safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: "invalid body" });
  const v = validateHostname(parsed.data.hostname, apiHost, kbHost);
  if (!v.ok || !v.hostname)
    return void res.status(400).json({ error: v.error ?? "invalid hostname" });

  const existing = (
    await db
      .select()
      .from(customDomains)
      .where(eq(customDomains.hostname, v.hostname))
  )[0];
  if (existing)
    return void res.status(409).json({ error: "hostname already registered" });

  const id = newId();
  await db.insert(customDomains).values({
    id,
    workspaceId: wsId,
    hostname: v.hostname,
    status: "pending_dns",
  });
  const row = (
    await db.select().from(customDomains).where(eq(customDomains.id, id))
  )[0];
  const vid = await verificationId();
  return void res.status(201).json({ ...row, records: dnsRecords(row.hostname, vid) });
});

// Deps that actually touch DNS + Azure, updating the row when provisioning ends.
function realDeps(wsId: string) {
  return {
    checkDns: async (hostname: string) =>
      checkDns(hostname, expectedCname, await verificationId()),
    provisionDomain: async (hostname: string) => {
      try {
        await provisionHostname(hostname);
        await db
          .update(customDomains)
          .set({ status: "active", error: null, verifiedAt: new Date() })
          .where(
            and(
              eq(customDomains.workspaceId, wsId),
              eq(customDomains.hostname, hostname)
            )
          );
      } catch (err) {
        await db
          .update(customDomains)
          .set({ status: "failed", error: String((err as Error).message) })
          .where(
            and(
              eq(customDomains.workspaceId, wsId),
              eq(customDomains.hostname, hostname)
            )
          );
      }
    },
  };
}

domainsRouter.post("/:id/verify", async (req, res) => {
  const wsId = req.workspaceId!;
  const row = (
    await db
      .select()
      .from(customDomains)
      .where(
        and(
          eq(customDomains.id, String(req.params.id)),
          eq(customDomains.workspaceId, wsId)
        )
      )
  )[0];
  if (!row) return void res.status(404).json({ error: "not found" });
  const result = await advanceDomain(row, realDeps(wsId));
  await db
    .update(customDomains)
    .set({ status: result.status, error: result.error })
    .where(eq(customDomains.id, row.id));
  const updated = (
    await db.select().from(customDomains).where(eq(customDomains.id, row.id))
  )[0];
  return void res.json(updated);
});

// DEMO_MODE: jump straight to active (skips real DNS/Azure).
if (env.DEMO_MODE) {
  domainsRouter.post("/:id/simulate", async (req, res) => {
    const wsId = req.workspaceId!;
    const row = (
      await db
        .select()
        .from(customDomains)
        .where(
          and(
            eq(customDomains.id, String(req.params.id)),
            eq(customDomains.workspaceId, wsId)
          )
        )
    )[0];
    if (!row) return void res.status(404).json({ error: "not found" });
    await db
      .update(customDomains)
      .set({ status: "active", error: null, verifiedAt: new Date() })
      .where(eq(customDomains.id, row.id));
    const updated = (
      await db.select().from(customDomains).where(eq(customDomains.id, row.id))
    )[0];
    return void res.json(updated);
  });
}

domainsRouter.delete("/:id", async (req, res) => {
  const wsId = req.workspaceId!;
  await db
    .delete(customDomains)
    .where(
      and(
        eq(customDomains.id, String(req.params.id)),
        eq(customDomains.workspaceId, wsId)
      )
    );
  return void res.json({ ok: true });
});

// ---- Serve active custom domains at root paths (KB) ----
// 60s hostname → workspace cache.
const hostCache = new Map<string, { wsId: string | null; at: number }>();

async function workspaceForHost(host: string): Promise<any | null> {
  const cached = hostCache.get(host);
  const now = Date.now();
  if (cached && now - cached.at < 60_000) {
    if (!cached.wsId) return null;
    return (
      await db.select().from(workspaces).where(eq(workspaces.id, cached.wsId))
    )[0];
  }
  const domain = (
    await db
      .select()
      .from(customDomains)
      .where(
        and(eq(customDomains.hostname, host), eq(customDomains.status, "active"))
      )
  )[0];
  hostCache.set(host, { wsId: domain?.workspaceId ?? null, at: now });
  if (!domain) return null;
  return (
    await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, domain.workspaceId))
  )[0];
}

// Express middleware: if the request host is an active custom domain, serve the
// workspace's KB at "/" (home) and "/:categorySlug/:articleSlug" (article).
// A legacy single-segment "/:articleSlug" is 301-redirected to its canonical
// category path. Otherwise fall through.
export const customDomainMiddleware: RequestHandler = async (req, res, next) => {
  const ws = await workspaceForHost(req.hostname);
  if (!ws) return next();
  const segments = req.path.split("/").filter(Boolean);

  if (segments.length > 2) return next();

  if (segments.length === 1) {
    // Legacy single-article path → redirect to canonical /{category}/{article}.
    const article = await findPublishedArticleBySlug(ws.id, segments[0]);
    if (!article) return next();
    const catSlug = await categorySlugForArticle(ws.id, article.categoryId);
    return void res.redirect(301, `/${catSlug}/${article.slug}`);
  }

  const { status, html } = await renderCustomDomainKb(
    ws,
    segments[0],
    segments[1]
  );
  res.status(status).type("html").send(html);
};
