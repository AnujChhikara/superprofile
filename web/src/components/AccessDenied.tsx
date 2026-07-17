import { ShieldAlert } from "lucide-react";

// Shown when the API rejects a request because the section is admin-only.
// Rendered in place of the page/section content so agents get a clear message
// instead of a broken or empty view.
export function AccessDenied({
  title = "Admins only",
  message = "This section is restricted to workspace admins. Please ask a workspace admin for access.",
}: {
  title?: string;
  message?: string;
}) {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="max-w-sm rounded-lg border bg-background p-8 text-center">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-muted">
          <ShieldAlert className="size-6 text-muted-foreground" />
        </div>
        <h2 className="mb-1 text-lg font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}
