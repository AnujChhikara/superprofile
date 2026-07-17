import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api.js";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

interface Canned {
  id: string;
  title: string;
  body: string;
}

export default function CannedResponses() {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  const { data: items = [] } = useQuery<Canned[]>({
    queryKey: ["canned"],
    queryFn: () => api<Canned[]>("/api/canned"),
  });

  const create = useMutation({
    mutationFn: () =>
      api("/api/canned", {
        method: "POST",
        body: JSON.stringify({ title, body }),
      }),
    onSuccess: () => {
      setTitle("");
      setBody("");
      qc.invalidateQueries({ queryKey: ["canned"] });
      toast.success("Canned response added");
    },
  });

  const del = useMutation({
    mutationFn: (id: string) => api(`/api/canned/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["canned"] });
      toast.success("Canned response deleted");
    },
  });

  return (
    <div className="max-w-2xl space-y-8 p-8">
      <div>
        <h1 className="text-2xl font-semibold">Canned Responses</h1>
        <p className="text-muted-foreground">
          Save reusable replies. In the inbox composer, type <code>/</code> to insert one.
        </p>
      </div>

      {/* Add form */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Add a canned response</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title (e.g. Refund policy)"
          />
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Response text…"
            className="min-h-24"
          />
          <Button
            disabled={!title.trim() || !body.trim() || create.isPending}
            onClick={() => create.mutate()}
          >
            Add response
          </Button>
        </CardContent>
      </Card>

      {/* List */}
      <div className="space-y-3">
        {items.length === 0 && (
          <p className="text-muted-foreground">No canned responses yet.</p>
        )}

        {items.map((c) => (
          <Card key={c.id}>
            <CardHeader>
              <div className="flex items-start justify-between">
                <CardTitle className="text-base">{c.title}</CardTitle>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => del.mutate(c.id)}
                  disabled={del.isPending}
                >
                  <Trash2 className="size-3" />
                  Delete
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">{c.body}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
