import { useAuth } from "../auth.js";

const API_ORIGIN = import.meta.env.VITE_API_ORIGIN ?? "http://localhost:3000";

// A dummy storefront-style page that embeds the live chat widget for the active
// workspace, so the team can test it end-to-end without leaving the dashboard.
// Messages sent here land in the Inbox in real time; agent replies show up here.
export default function Playground() {
  const { activeWorkspace } = useAuth();

  if (!activeWorkspace)
    return <p className="p-8 text-muted-foreground">No workspace selected.</p>;

  const src = `${API_ORIGIN}/widget/frame?ws=${encodeURIComponent(
    activeWorkspace.publicKey
  )}`;

  return (
    <div className="h-full overflow-y-auto p-8">
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Test widget</h1>
          <p className="text-muted-foreground">
            This is the live chat widget for{" "}
            <strong>{activeWorkspace.name}</strong>. Send a message below — it
            appears in your <strong>Inbox</strong> in real time, and agent
            replies show up right here.
          </p>
        </div>

        <div className="flex justify-center">
          <div
            className="overflow-hidden rounded-2xl border bg-card shadow-lg"
            style={{ width: 375, height: 600 }}
          >
            <iframe
              title="Support widget preview"
              src={src}
              className="size-full border-0"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
