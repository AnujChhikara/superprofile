import { Router } from "express";
import crypto from "crypto";
import { z } from "zod";
import { db, newId } from "../db/client.js";
import { memberships, invites, users, workspaces } from "../db/schema.js";
import { requireAuth, requireWorkspace } from "../auth/middleware.js";
import { and, eq, isNull, gt } from "drizzle-orm";
import { sendEmail } from "../lib/sendEmail.js";
import { env } from "../env.js";

export const teamRouter = Router();
export const invitesRouter = Router();

// Escape HTML special characters for safe interpolation into email HTML bodies
const escapeHtml = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

// GET /api/team — list members (any member of workspace)
teamRouter.get(
  "/",
  requireAuth,
  requireWorkspace(),
  async (req, res) => {
    const wsId = req.workspaceId!;

    const rows = await db
      .select({
        userId: memberships.userId,
        role: memberships.role,
        name: users.name,
        email: users.email,
        avatarUrl: users.avatarUrl,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.workspaceId, wsId));

    return void res.json(rows);
  }
);

const inviteBody = z.object({
  email: z.string().email(),
  role: z.enum(["admin", "agent"]),
});

// GET /api/team/invites — list pending invites (admin only)
teamRouter.get(
  "/invites",
  requireAuth,
  requireWorkspace("admin"),
  async (req, res) => {
    const wsId = req.workspaceId!;
    const now = new Date();

    const rows = await db
      .select({
        id: invites.id,
        email: invites.email,
        role: invites.role,
        expiresAt: invites.expiresAt,
      })
      .from(invites)
      .where(
        and(
          eq(invites.workspaceId, wsId),
          isNull(invites.acceptedAt),
          gt(invites.expiresAt, now)
        )
      );

    return void res.json(rows);
  }
);

// DELETE /api/team/invites/:id — revoke a pending invite (admin only)
teamRouter.delete(
  "/invites/:id",
  requireAuth,
  requireWorkspace("admin"),
  async (req, res) => {
    const wsId = req.workspaceId!;
    const inviteId = String(req.params.id);

    await db
      .delete(invites)
      .where(and(eq(invites.id, inviteId), eq(invites.workspaceId, wsId)));

    return void res.json({ ok: true });
  }
);

// POST /api/team/invites — create invite (admin only)
teamRouter.post(
  "/invites",
  requireAuth,
  requireWorkspace("admin"),
  async (req, res) => {
    const parsed = inviteBody.safeParse(req.body);
    if (!parsed.success) {
      return void res
        .status(400)
        .json({ error: "invalid body", details: parsed.error.flatten() });
    }

    const { email, role } = parsed.data;
    const wsId = req.workspaceId!;

    // Look up workspace name for email
    const wsRows = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, wsId));
    const ws = wsRows[0];

    const token = crypto.randomBytes(24).toString("hex");
    const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000);

    await db.insert(invites).values({
      id: newId(),
      workspaceId: wsId,
      email,
      role,
      token,
      expiresAt,
    });

    const inviteUrl = `${env.APP_ORIGIN}/invite/${token}`;
    const wsName = ws?.name ?? "a workspace";

    // Send invite email (logs in dev when SENDGRID_API_KEY is unset).
    // The invite row is already committed — a SendGrid failure must not block
    // the response; the admin can still share the returned inviteUrl.
    try {
      await sendEmail({
        to: email,
        from: "support@anujchhikara.com",
        fromName: "SuperProfile",
        subject: `You've been invited to ${wsName} on SuperProfile`,
        text:
          `You've been invited to join ${wsName} as ${role}.\n\n` +
          `Accept your invite here:\n${inviteUrl}\n\n` +
          `This invite expires in 7 days.`,
        html:
          `<p>You've been invited to join <strong>${escapeHtml(wsName)}</strong> as <em>${role}</em>.</p>` +
          `<p><a href="${inviteUrl}">Accept your invite</a></p>` +
          `<p>This invite expires in 7 days.</p>`,
      });
    } catch (err) {
      console.error("[team] invite email send failed:", err);
    }

    return void res.status(201).json({ inviteUrl });
  }
);

// POST /api/invites/:token/accept — accept invite (auth'd)
invitesRouter.post("/:token/accept", requireAuth, async (req, res) => {
  const token = String(req.params.token);
  const user = req.user!;

  const inviteRows = await db
    .select()
    .from(invites)
    .where(eq(invites.token, token));
  const invite = inviteRows[0];

  if (!invite) {
    return void res.status(404).json({ error: "invite not found" });
  }

  if (invite.acceptedAt) {
    return void res.status(409).json({ error: "invite already accepted" });
  }

  if (invite.expiresAt < new Date()) {
    return void res.status(410).json({ error: "invite expired" });
  }

  // Strict email match
  if (invite.email.toLowerCase() !== user.email.toLowerCase()) {
    return void res
      .status(403)
      .json({ error: "invite is for a different email" });
  }

  // Check if already a member
  const existingRows = await db
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.userId, user.id),
        eq(memberships.workspaceId, invite.workspaceId)
      )
    );
  const existing = existingRows[0];

  if (existing) {
    // Already a member: update role if the invite grants a different role
    if (existing.role !== invite.role) {
      await db
        .update(memberships)
        .set({ role: invite.role })
        .where(
          and(
            eq(memberships.userId, user.id),
            eq(memberships.workspaceId, invite.workspaceId)
          )
        );
    }
  } else {
    await db.insert(memberships).values({
      id: newId(),
      userId: user.id,
      workspaceId: invite.workspaceId,
      role: invite.role,
    });
  }

  // Mark invite as accepted
  await db
    .update(invites)
    .set({ acceptedAt: new Date() })
    .where(eq(invites.token, token));

  return void res.json({ ok: true, workspaceId: invite.workspaceId });
});

const patchMemberBody = z.object({
  role: z.enum(["admin", "agent"]),
});

// True when the given member is an admin and no OTHER admin exists in the
// workspace — demoting or removing them would leave the workspace admin-less.
async function isLastAdmin(wsId: string, userId: string): Promise<boolean> {
  const admins = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(
      and(eq(memberships.workspaceId, wsId), eq(memberships.role, "admin"))
    );
  return admins.length === 1 && admins[0].userId === userId;
}

// PATCH /api/team/members/:userId — change role (admin only)
teamRouter.patch(
  "/members/:userId",
  requireAuth,
  requireWorkspace("admin"),
  async (req, res) => {
    const wsId = req.workspaceId!;
    const targetUserId = String(req.params.userId);

    const parsed = patchMemberBody.safeParse(req.body);
    if (!parsed.success) {
      return void res
        .status(400)
        .json({ error: "invalid body", details: parsed.error.flatten() });
    }

    const { role } = parsed.data;

    const memberRows = await db
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.userId, targetUserId),
          eq(memberships.workspaceId, wsId)
        )
      );
    const membership = memberRows[0];

    if (!membership) {
      return void res.status(404).json({ error: "member not found" });
    }

    // Last-admin lockout guard: refuse to demote the only admin
    if (
      role === "agent" &&
      membership.role === "admin" &&
      (await isLastAdmin(wsId, targetUserId))
    ) {
      return void res
        .status(409)
        .json({ error: "workspace must have at least one admin" });
    }

    await db
      .update(memberships)
      .set({ role })
      .where(
        and(
          eq(memberships.userId, targetUserId),
          eq(memberships.workspaceId, wsId)
        )
      );

    return void res.json({ ok: true });
  }
);

// DELETE /api/team/members/:userId — remove member (admin only)
teamRouter.delete(
  "/members/:userId",
  requireAuth,
  requireWorkspace("admin"),
  async (req, res) => {
    const wsId = req.workspaceId!;
    const targetUserId = String(req.params.userId);

    const memberRows = await db
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.userId, targetUserId),
          eq(memberships.workspaceId, wsId)
        )
      );
    const membership = memberRows[0];

    if (!membership) {
      return void res.status(404).json({ error: "member not found" });
    }

    // Last-admin lockout guard: refuse to remove the only admin
    if (
      membership.role === "admin" &&
      (await isLastAdmin(wsId, targetUserId))
    ) {
      return void res
        .status(409)
        .json({ error: "workspace must have at least one admin" });
    }

    await db
      .delete(memberships)
      .where(
        and(
          eq(memberships.userId, targetUserId),
          eq(memberships.workspaceId, wsId)
        )
      );

    return void res.json({ ok: true });
  }
);
