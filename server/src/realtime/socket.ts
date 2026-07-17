import { Server, type Socket } from "socket.io";
import type http from "http";
import { z } from "zod";
import { env } from "../env.js";
import { getSessionUser } from "../auth/session.js";
import { db } from "../db/client.js";
import { memberships, workspaces, contacts } from "../db/schema.js";
import { and, eq } from "drizzle-orm";
import {
  createMessage,
  getConversation,
  markContactMessagesRead,
} from "../repos/conversations.js";
import {
  emitMessageCreated,
  emitConversationUpdated,
} from "../events.js";
import {
  wsRoom,
  wsVisitorsRoom,
  convRoom,
  type ServerEvents,
} from "./protocol.js";

// Discriminated identity attached to each authenticated socket.
type SocketData =
  | { kind: "agent"; userId: string; workspaceId: string }
  | {
      kind: "visitor";
      contactId: string;
      workspaceId: string;
      joinedConvs: Set<string>;
    };

let io: Server | null = null;

// Track live agent sockets per workspace so we can broadcast presence.
const agentSocketsByWs = new Map<string, Set<string>>();

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

function emitAgentPresence(workspaceId: string) {
  if (!io) return;
  const online = (agentSocketsByWs.get(workspaceId)?.size ?? 0) > 0;
  io.to(wsVisitorsRoom(workspaceId)).emit("presence", {
    agentOnline: online,
  } satisfies ServerEvents["presence"]);
}

export function initSocket(httpServer: http.Server): Server {
  io = new Server(httpServer, {
    cors: {
      // The widget iframe is served from the API origin; the dashboard from
      // APP_ORIGIN. Allow both plus local dev.
      origin: [env.APP_ORIGIN, env.API_ORIGIN, "http://localhost:5173"],
      credentials: true,
    },
  });

  // ---- Auth handshake ----
  io.use(async (socket, next) => {
    try {
      const auth = (socket.handshake.auth ?? {}) as {
        workspaceId?: string;
        workspaceKey?: string;
        visitorToken?: string;
      };

      // Visitor: identified by workspaceKey + visitorToken (widget, Task 7).
      if (auth.workspaceKey && auth.visitorToken) {
        const ws = (
          await db
            .select()
            .from(workspaces)
            .where(eq(workspaces.publicKey, auth.workspaceKey))
        )[0];
        if (!ws) return next(new Error("unknown workspace"));
        const contact = (
          await db
            .select()
            .from(contacts)
            .where(
              and(
                eq(contacts.workspaceId, ws.id),
                eq(contacts.visitorToken, auth.visitorToken)
              )
            )
        )[0];
        if (!contact) return next(new Error("unknown visitor"));
        (socket.data as SocketData) = {
          kind: "visitor",
          contactId: contact.id,
          workspaceId: ws.id,
          joinedConvs: new Set(),
        };
        return next();
      }

      // Agent: session cookie + workspace membership.
      const cookies = parseCookies(socket.handshake.headers.cookie);
      const user = cookies.sid ? await getSessionUser(cookies.sid) : null;
      if (!user) return next(new Error("unauthenticated"));
      const workspaceId = auth.workspaceId;
      if (!workspaceId) return next(new Error("workspace required"));
      const member = (
        await db
          .select()
          .from(memberships)
          .where(
            and(
              eq(memberships.userId, user.id),
              eq(memberships.workspaceId, workspaceId)
            )
          )
      )[0];
      if (!member) return next(new Error("not a member"));
      (socket.data as SocketData) = {
        kind: "agent",
        userId: user.id,
        workspaceId,
      };
      return next();
    } catch (err) {
      return next(err instanceof Error ? err : new Error("auth failed"));
    }
  });

  io.on("connection", (socket) => {
    const data = socket.data as SocketData;

    if (data.kind === "agent") {
      socket.join(wsRoom(data.workspaceId));
      const set = agentSocketsByWs.get(data.workspaceId) ?? new Set();
      set.add(socket.id);
      agentSocketsByWs.set(data.workspaceId, set);
      emitAgentPresence(data.workspaceId);
    } else {
      socket.join(wsVisitorsRoom(data.workspaceId));
      // Tell the visitor whether an agent is currently online.
      socket.emit("presence", {
        agentOnline: (agentSocketsByWs.get(data.workspaceId)?.size ?? 0) > 0,
      } satisfies ServerEvents["presence"]);
      // Refresh lastSeen.
      void db
        .update(contacts)
        .set({ lastSeenAt: new Date() })
        .where(eq(contacts.id, data.contactId))
        .catch(() => {});
    }

    // ---- join a conversation room ----
    socket.on("join", async (payload: unknown) => {
      const parsed = z
        .object({ conversationId: z.string() })
        .safeParse(payload);
      if (!parsed.success) return;
      const convId = parsed.data.conversationId;
      try {
        const conv = await getConversation(data.workspaceId, convId);
        if (data.kind === "visitor") {
          if (conv.contactId !== data.contactId) return; // isolation
          socket.join(convRoom(convId));
          data.joinedConvs.add(convId);
          // Notify agents this visitor is viewing the conversation.
          io?.to(wsRoom(data.workspaceId)).emit("visitor:presence", {
            conversationId: convId,
            online: true,
          } satisfies ServerEvents["visitor:presence"]);
        } else {
          socket.join(convRoom(convId));
        }
      } catch {
        // conversation not in workspace → ignore
      }
    });

    // Visitors may only act on their own conversations. Agents share the team
    // inbox, so any workspace member may act on any conversation there.
    async function visitorOwnsConversation(conversationId: string): Promise<boolean> {
      if (data.kind !== "visitor") return true;
      try {
        const conv = await getConversation(data.workspaceId, conversationId);
        return conv.contactId === data.contactId;
      } catch {
        return false;
      }
    }

    // ---- send a message (shared write path with REST) ----
    socket.on("message:send", async (payload: unknown, ack?: (r: unknown) => void) => {
      const parsed = z
        .object({
          conversationId: z.string(),
          body: z.string().min(1),
          clientRef: z.string().optional(),
        })
        .safeParse(payload);
      if (!parsed.success) return ack?.({ error: "invalid payload" });
      const { conversationId, body } = parsed.data;
      try {
        // Tenant isolation for visitors — can't post into another contact's convo.
        if (!(await visitorOwnsConversation(conversationId))) {
          return ack?.({ error: "conversation not found" });
        }
        const message = await createMessage(data.workspaceId, {
          conversationId,
          senderType: data.kind === "agent" ? "agent" : "contact",
          senderId: data.kind === "agent" ? data.userId : data.contactId,
          body,
        });
        const conv = await getConversation(data.workspaceId, conversationId);
        emitMessageCreated({
          workspaceId: data.workspaceId,
          conversation: conv,
          message,
        });
        emitConversationUpdated({
          workspaceId: data.workspaceId,
          conversation: conv,
        });
        ack?.({ ok: true, message });
      } catch (err) {
        ack?.({
          error:
            (err as { status?: number }).status === 404
              ? "conversation not found"
              : "send failed",
        });
      }
    });

    // ---- typing indicator ----
    socket.on("typing", (payload: unknown) => {
      const parsed = z
        .object({ conversationId: z.string(), isTyping: z.boolean() })
        .safeParse(payload);
      if (!parsed.success) return;
      // Visitors may only signal typing in conversations they've joined (join
      // already enforced ownership); avoids a DB hit on this hot path.
      if (
        data.kind === "visitor" &&
        !data.joinedConvs.has(parsed.data.conversationId)
      )
        return;
      const senderType = data.kind === "agent" ? "agent" : "contact";
      const evt: ServerEvents["typing"] = {
        conversationId: parsed.data.conversationId,
        senderType,
        isTyping: parsed.data.isTyping,
      };
      // Broadcast to the conversation room (other party) and, for visitors,
      // to the whole workspace so an agent who hasn't opened the thread still
      // sees activity. socket.to(...) excludes the sender.
      socket.to(convRoom(parsed.data.conversationId)).emit("typing", evt);
      if (data.kind === "visitor") {
        socket.to(wsRoom(data.workspaceId)).emit("typing", evt);
      }
    });

    // ---- read receipts ----
    socket.on("read", async (payload: unknown) => {
      const parsed = z
        .object({ conversationId: z.string(), upToSeq: z.number() })
        .safeParse(payload);
      if (!parsed.success) return;
      const { conversationId, upToSeq } = parsed.data;
      try {
        // Tenant isolation for visitors before mutating/broadcasting.
        if (!(await visitorOwnsConversation(conversationId))) return;
        // Agents read contact messages; visitors read agent messages.
        await markContactMessagesRead(
          data.workspaceId,
          conversationId,
          data.kind === "agent" ? "contact" : "agent"
        );
      } catch {
        return;
      }
      const evt: ServerEvents["read"] = {
        conversationId,
        senderType: data.kind === "agent" ? "agent" : "contact",
        upToSeq,
      };
      socket.to(convRoom(conversationId)).emit("read", evt);
      if (data.kind === "visitor") {
        socket.to(wsRoom(data.workspaceId)).emit("read", evt);
      }
    });

    socket.on("disconnect", () => {
      if (data.kind === "agent") {
        const set = agentSocketsByWs.get(data.workspaceId);
        set?.delete(socket.id);
        if (set && set.size === 0) agentSocketsByWs.delete(data.workspaceId);
        emitAgentPresence(data.workspaceId);
      } else {
        for (const convId of data.joinedConvs) {
          io?.to(wsRoom(data.workspaceId)).emit("visitor:presence", {
            conversationId: convId,
            online: false,
          } satisfies ServerEvents["visitor:presence"]);
        }
        void db
          .update(contacts)
          .set({ lastSeenAt: new Date() })
          .where(eq(contacts.id, data.contactId))
          .catch(() => {});
      }
    });
  });

  return io;
}

// Whether at least one agent socket is currently connected for a workspace.
export function isAgentOnline(workspaceId: string): boolean {
  return (agentSocketsByWs.get(workspaceId)?.size ?? 0) > 0;
}

// ---- emit helpers used by events.ts subscribers ----
export function emitToWorkspace<E extends keyof ServerEvents>(
  workspaceId: string,
  event: E,
  payload: ServerEvents[E]
): void {
  io?.to(wsRoom(workspaceId)).emit(event, payload as never);
}

export function emitToConversation<E extends keyof ServerEvents>(
  conversationId: string,
  event: E,
  payload: ServerEvents[E]
): void {
  io?.to(convRoom(conversationId)).emit(event, payload as never);
}
