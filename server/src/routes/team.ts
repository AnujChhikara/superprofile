import { Router } from "express";
import crypto from "crypto";
import { z } from "zod";
import { db, newId } from "../db/client.js";
import { memberships, invites, users, workspaces } from "../db/schema.js";
import { requireAuth, requireWorkspace } from "../auth/middleware.js";
import { and, eq } from "drizzle-orm";
import { sendEmail } from "../lib/sendEmail.js";
import { env } from "../env.js";

export const teamRouter = Router();
export const invitesRouter = Router();

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

    // Send invite email (logs in dev when SENDGRID_API_KEY is unset)
    await sendEmail({
      to: email,
      subject: `You've been invited to ${ws?.name ?? "a workspace"} on SuperProfile`,
      text:
        `You've been invited to join ${ws?.name ?? "a workspace"} as ${role}.\n\n` +
        `Accept your invite here:\n${inviteUrl}\n\n` +
        `This invite expires in 7 days.`,
      html:
        `<p>You've been invited to join <strong>${ws?.name ?? "a workspace"}</strong> as <em>${role}</em>.</p>` +
        `<p><a href="${inviteUrl}">Accept your invite</a></p>` +
        `<p>This invite expires in 7 days.</p>`,
    });

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
