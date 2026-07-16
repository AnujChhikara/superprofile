import { io, type Socket } from "socket.io-client";

const API_ORIGIN = import.meta.env.VITE_API_ORIGIN ?? "http://localhost:3000";

let socket: Socket | null = null;
let currentWorkspaceId: string | null = null;

// Returns a singleton socket authenticated for the given workspace. If the
// active workspace changes, the old socket is torn down and a new one created.
export function getSocket(workspaceId: string): Socket {
  if (socket && currentWorkspaceId === workspaceId) return socket;
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  currentWorkspaceId = workspaceId;
  socket = io(API_ORIGIN, {
    withCredentials: true,
    auth: { workspaceId },
    transports: ["websocket", "polling"],
  });
  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
  currentWorkspaceId = null;
}
