import { useState } from "react";
import { useAuth } from "../auth.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  MessagesSquare,
  Mail,
  Copy,
  Check,
  ExternalLink,
} from "lucide-react";

const API_ORIGIN = import.meta.env.VITE_API_ORIGIN ?? "http://localhost:3000";
const PARSE_DOMAIN =
  import.meta.env.VITE_PARSE_DOMAIN ?? "parse.anujchhikara.com";

// One place to test both channels for the active workspace: open the widget demo
// storefront (bound to this workspace) and see the workspace's inbound support
// email. Everything lands in the Inbox in real time.
export default function TryIt() {
  const { activeWorkspace } = useAuth();
  const [copied, setCopied] = useState(false);

  if (!activeWorkspace)
    return <p className="p-8 text-muted-foreground">No workspace selected.</p>;

  const supportEmail = `${activeWorkspace.slug}@${PARSE_DOMAIN}`;
  const demoUrl = `${API_ORIGIN}/demo?ws=${encodeURIComponent(
    activeWorkspace.publicKey
  )}`;

  const copyEmail = async () => {
    try {
      await navigator.clipboard.writeText(supportEmail);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — the address is still visible to copy manually */
    }
  };

  return (
    <div className="h-full overflow-y-auto p-8">
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Try it out</h1>
          <p className="text-muted-foreground">
            Test both channels for <strong>{activeWorkspace.name}</strong> —
            everything lands in your <strong>Inbox</strong> in real time.
          </p>
        </div>

        {/* Live chat widget */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessagesSquare className="size-5" /> Live chat widget
            </CardTitle>
            <CardDescription>
              Opens a demo storefront with your widget installed. Send a message
              there and watch it appear in your Inbox; reply from the dashboard
              and it shows up in the widget instantly.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <a href={demoUrl} target="_blank" rel="noopener noreferrer">
                Open widget demo
                <ExternalLink className="size-4" />
              </a>
            </Button>
          </CardContent>
        </Card>

        {/* Email channel */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="size-5" /> Email channel
            </CardTitle>
            <CardDescription>
              Send an email to your workspace address from any personal inbox —
              it appears as a conversation in your Inbox, and replies thread back
              into the same conversation.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 rounded-md border bg-muted px-3 py-2">
              <Mail className="size-4 shrink-0 text-muted-foreground" />
              <code className="flex-1 break-all text-sm font-medium">
                {supportEmail}
              </code>
              <Button
                variant="ghost"
                size="sm"
                onClick={copyEmail}
                aria-label="Copy support email"
              >
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
