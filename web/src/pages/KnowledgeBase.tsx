import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api.js";
import { useAuth } from "../auth.js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ExternalLink, Trash2, Plus } from "lucide-react";

interface Category {
  id: string;
  name: string;
  slug: string;
  position: number;
}

interface Article {
  id: string;
  title: string;
  slug: string;
  bodyHtml: string;
  categoryId: string | null;
  status: "draft" | "published";
  updatedAt: string;
}

const API_ORIGIN = import.meta.env.VITE_API_ORIGIN ?? "http://localhost:3000";

export default function KnowledgeBase() {
  const { activeWorkspace } = useAuth();
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCategories, setShowCategories] = useState(false);

  const { data: articles = [] } = useQuery<Article[]>({
    queryKey: ["kb-articles"],
    queryFn: () => api<Article[]>("/api/kb/articles"),
  });

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ["kb-categories"],
    queryFn: () => api<Category[]>("/api/kb/categories"),
  });

  const createArticle = useMutation({
    mutationFn: () =>
      api<Article>("/api/kb/articles", {
        method: "POST",
        body: JSON.stringify({ title: "Untitled article", bodyHtml: "" }),
      }),
    onSuccess: (a) => {
      qc.invalidateQueries({ queryKey: ["kb-articles"] });
      setSelectedId(a.id);
      setShowCategories(false);
    },
  });

  const selected = articles.find((a) => a.id === selectedId) ?? null;

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left sidebar */}
      <div className="flex w-72 flex-shrink-0 flex-col border-r bg-background">
        <div className="flex items-center justify-between border-b px-4 py-4">
          <strong className="text-sm">Articles</strong>
          <Button
            size="sm"
            variant="default"
            onClick={() => createArticle.mutate()}
            className="h-6"
          >
            <Plus className="size-3" />
          </Button>
        </div>
        <Button
          variant="ghost"
          className="justify-start rounded-none border-b text-sm"
          onClick={() => setShowCategories((v) => !v)}
        >
          Manage categories
        </Button>
        <div className="flex-1 overflow-y-auto">
          {articles.length === 0 && (
            <div className="p-4 text-sm text-muted-foreground">
              No articles yet.
            </div>
          )}
          {articles.map((a) => (
            <button
              key={a.id}
              onClick={() => {
                setSelectedId(a.id);
                setShowCategories(false);
              }}
              className={`w-full border-b px-4 py-3 text-left transition-colors ${
                selectedId === a.id && !showCategories
                  ? "bg-primary/10"
                  : "hover:bg-muted"
              }`}
            >
              <div className="mb-1 text-sm font-semibold">{a.title}</div>
              <Badge
                variant={a.status === "published" ? "default" : "secondary"}
                className="text-xs"
              >
                {a.status}
              </Badge>
            </button>
          ))}
        </div>
        {activeWorkspace && (
          <a
            className="border-t px-4 py-3 text-sm text-primary hover:underline"
            href={`${API_ORIGIN}/${activeWorkspace.slug}`}
            target="_blank"
            rel="noreferrer"
          >
            View public site
            <ExternalLink className="ml-1 inline size-3" />
          </a>
        )}
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto bg-muted/30">
        {showCategories ? (
          <CategoriesPanel categories={categories} />
        ) : selected ? (
          <Editor
            key={selected.id}
            article={selected}
            categories={categories}
            onDeleted={() => setSelectedId(null)}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            Select an article or create a new one.
          </div>
        )}
      </div>
    </div>
  );
}

function Editor({
  article,
  categories,
  onDeleted,
}: {
  article: Article;
  categories: Category[];
  onDeleted: () => void;
}) {
  const qc = useQueryClient();
  const [title, setTitle] = useState(article.title);
  const [categoryId, setCategoryId] = useState<string | null>(
    article.categoryId
  );
  const bodyRef = useRef<HTMLDivElement>(null);
  const [saved, setSaved] = useState<string>("");

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.innerHTML = article.bodyHtml;
  }, [article.id, article.bodyHtml]);

  const save = useMutation({
    mutationFn: () =>
      api<Article>(`/api/kb/articles/${article.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          title,
          categoryId,
          bodyHtml: bodyRef.current?.innerHTML ?? "",
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kb-articles"] });
      setSaved("Saved");
      setTimeout(() => setSaved(""), 1500);
    },
  });

  const publish = useMutation({
    mutationFn: (next: "draft" | "published") =>
      next === "published"
        ? api(`/api/kb/articles/${article.id}/publish`, { method: "POST" })
        : api(`/api/kb/articles/${article.id}`, {
            method: "PATCH",
            body: JSON.stringify({ status: "draft" }),
          }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["kb-articles"] }),
  });

  const del = useMutation({
    mutationFn: () => api(`/api/kb/articles/${article.id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kb-articles"] });
      onDeleted();
    },
  });

  function cmd(command: string, value?: string) {
    document.execCommand(command, false, value);
    bodyRef.current?.focus();
  }

  return (
    <div className="max-w-2xl space-y-4 p-8">
      <Input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Article title"
        className="border-none bg-transparent text-2xl font-bold"
      />

      <div className="flex gap-3">
        <Select
          value={categoryId ?? ""}
          onValueChange={(v) => setCategoryId(v || null)}
        >
          <SelectTrigger className="w-40">
            <SelectValue placeholder="No category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">No category</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Badge variant={article.status === "published" ? "default" : "secondary"}>
          {article.status}
        </Badge>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap gap-1 border-b pb-2">
        {(
          [
            ["Bold", "bold", "B"],
            ["Italic", "italic", "i"],
            ["Bullet list", "insertUnorderedList", "• List"],
            ["Numbered list", "insertOrderedList", "1. List"],
          ] as const
        ).map(([label, command, text]) => (
          <Button
            key={command}
            size="sm"
            variant="outline"
            title={label}
            className="h-7"
            onMouseDown={(e) => {
              e.preventDefault();
              cmd(command);
            }}
          >
            {text}
          </Button>
        ))}
        <Button
          size="sm"
          variant="outline"
          title="Heading"
          className="h-7"
          onMouseDown={(e) => {
            e.preventDefault();
            cmd("formatBlock", "h2");
          }}
        >
          H2
        </Button>
        <Button
          size="sm"
          variant="outline"
          title="Link"
          className="h-7"
          onMouseDown={(e) => {
            e.preventDefault();
            const url = prompt("Link URL (https://…)");
            if (url) cmd("createLink", url);
          }}
        >
          Link
        </Button>
      </div>

      {/* Editor body */}
      <div
        ref={bodyRef}
        contentEditable
        suppressContentEditableWarning
        className="min-h-80 rounded-lg border border-input bg-background p-4 outline-none"
      />

      {/* Actions */}
      <div className="flex gap-2">
        <Button onClick={() => save.mutate()}>Save</Button>
        {article.status === "published" ? (
          <Button variant="outline" onClick={() => publish.mutate("draft")}>
            Unpublish
          </Button>
        ) : (
          <Button variant="outline" onClick={() => publish.mutate("published")}>
            Publish
          </Button>
        )}
        <Button
          variant="destructive"
          onClick={() =>
            confirm("Delete this article?") && del.mutate()
          }
        >
          <Trash2 className="size-3" />
          Delete
        </Button>
        {saved && <span className="ml-2 text-sm text-green-600">{saved}</span>}
      </div>
    </div>
  );
}

function CategoriesPanel({ categories }: { categories: Category[] }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");

  const create = useMutation({
    mutationFn: () =>
      api("/api/kb/categories", {
        method: "POST",
        body: JSON.stringify({ name, position: categories.length }),
      }),
    onSuccess: () => {
      setName("");
      qc.invalidateQueries({ queryKey: ["kb-categories"] });
    },
  });

  const del = useMutation({
    mutationFn: (id: string) =>
      api(`/api/kb/categories/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["kb-categories"] }),
  });

  return (
    <div className="max-w-2xl space-y-4 p-8">
      <h2 className="text-xl font-semibold">Categories</h2>

      <div className="flex gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New category name"
          className="flex-1"
        />
        <Button disabled={!name.trim()} onClick={() => create.mutate()}>
          Add
        </Button>
      </div>

      <div className="space-y-2">
        {categories.map((c) => (
          <div
            key={c.id}
            className="flex items-center justify-between rounded-lg border p-3"
          >
            <span className="text-sm">{c.name}</span>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => del.mutate(c.id)}
              disabled={del.isPending}
            >
              <Trash2 className="size-3" />
            </Button>
          </div>
        ))}
        {categories.length === 0 && (
          <p className="text-sm text-muted-foreground">No categories yet.</p>
        )}
      </div>
    </div>
  );
}
