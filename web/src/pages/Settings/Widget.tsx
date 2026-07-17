import { useState } from "react";
import { useAuth } from "../../auth.js";
import { api, kbOrigin } from "../../api.js";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check, Copy, ExternalLink, Code2, BookOpen } from "lucide-react";

const API_ORIGIN = import.meta.env.VITE_API_ORIGIN ?? "http://localhost:3000";
const KB_ORIGIN = kbOrigin();

export default function WidgetSettings() {
  const { user, activeWorkspace } = useAuth();
  const qc = useQueryClient();
  const [copied, setCopied] = useState(false);
  const [name, setName] = useState(user?.name ?? "");
  const [nameSaved, setNameSaved] = useState(false);

  const snippet = activeWorkspace
    ? `<script src="${API_ORIGIN}/widget.js" data-workspace="${activeWorkspace.publicKey}" async></script>`
    : "";

  function copySnippet() {
    navigator.clipboard.writeText(snippet).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const saveName = useMutation({
    mutationFn: () =>
      api("/api/me/name", { method: "PATCH", body: JSON.stringify({ name }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["me"] });
      setNameSaved(true);
      setTimeout(() => setNameSaved(false), 2000);
    },
  });

  if (!activeWorkspace) return <p className="p-8 text-muted-foreground">No workspace selected.</p>;

  return (
    <div className="max-w-2xl space-y-8 p-8">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-muted-foreground">
          Manage <strong>{activeWorkspace.name}</strong>'s workspace settings.
        </p>
      </div>

      {/* Profile */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your profile</CardTitle>
          <CardDescription>
            Signed in as <span className="font-medium">{user?.email}</span>. Your name is shown to
            teammates on the conversations you handle.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your display name"
              className="max-w-xs"
            />
            <Button
              onClick={() => saveName.mutate()}
              disabled={saveName.isPending || !name.trim()}
              variant={nameSaved ? "outline" : "default"}
            >
              {nameSaved ? (
                <><Check className="size-3.5" /> Saved</>
              ) : saveName.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Widget install */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Code2 className="size-4" />
            Install the widget
          </CardTitle>
          <CardDescription>
            Paste this snippet before <code className="rounded bg-muted px-1 py-0.5 text-xs">&lt;/body&gt;</code> on
            any website or storefront to embed the live chat widget.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Step-by-step */}
          <ol className="space-y-2 text-sm text-muted-foreground list-none">
            <li className="flex gap-3">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">1</span>
              Open the HTML file (or theme template) of the site you want to add the widget to.
            </li>
            <li className="flex gap-3">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">2</span>
              Copy the snippet below and paste it just before the closing <code className="rounded bg-muted px-1 py-0.5 text-xs">&lt;/body&gt;</code> tag.
            </li>
            <li className="flex gap-3">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">3</span>
              Save and deploy. A chat bubble will appear in the bottom-right corner of your site.
            </li>
          </ol>

          {/* Code snippet */}
          <div className="relative rounded-lg border bg-muted/50 font-mono text-xs">
            <div className="flex items-center justify-between border-b px-3 py-2">
              <span className="text-muted-foreground">HTML</span>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 gap-1.5 px-2 text-xs"
                onClick={copySnippet}
              >
                {copied ? <Check className="size-3 text-green-500" /> : <Copy className="size-3" />}
                {copied ? "Copied!" : "Copy"}
              </Button>
            </div>
            <pre className="overflow-x-auto p-3 text-foreground leading-relaxed whitespace-pre-wrap break-all">
{`<script
  src="${API_ORIGIN}/widget.js"
  data-workspace="${activeWorkspace.publicKey}"
  async
></script>`}
            </pre>
          </div>

          {/* Key info */}
          <div className="rounded-lg border bg-background p-3 space-y-1.5">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Workspace key</span>
              <Badge variant="secondary" className="font-mono text-xs">
                {activeWorkspace.publicKey}
              </Badge>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Workspace</span>
              <span className="text-sm font-medium">{activeWorkspace.name}</span>
            </div>
          </div>

          {/* Quick links */}
          <div className="flex flex-wrap gap-2 pt-1">
            <a
              href={`${API_ORIGIN}/demo?ws=${activeWorkspace.publicKey}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
            >
              <ExternalLink className="size-3.5" />
              Try it on demo storefront
            </a>
            <span className="text-muted-foreground">·</span>
            <a
              href={`${KB_ORIGIN}/${activeWorkspace.slug}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
            >
              <BookOpen className="size-3.5" />
              Public knowledge base
            </a>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
