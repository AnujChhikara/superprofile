import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import LinkExtension from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { api, kbOrigin } from "../api.js";
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
import {
  ExternalLink, Trash2, Plus,
  Bold, Italic, List, ListOrdered, Heading2, Heading3,
  Code, Quote, Link,
} from "lucide-react";

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

const KB_ORIGIN = kbOrigin();

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
        {/* Bottom actions */}
        <div className="mt-auto flex flex-col gap-2 border-t p-3">
          <Button
            variant={showCategories ? "secondary" : "outline"}
            className="w-full justify-start gap-2"
            onClick={() => setShowCategories((v) => !v)}
          >
            <Plus className="size-4" />
            Manage categories
          </Button>
          {activeWorkspace && (
            <a
              className="flex items-center gap-1 px-1 py-1 text-sm text-primary hover:underline"
              href={`${KB_ORIGIN}/${activeWorkspace.slug}`}
              target="_blank"
              rel="noreferrer"
            >
              View public site
              <ExternalLink className="inline size-3" />
            </a>
          )}
        </div>
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

function ToolbarBtn({
  onClick,
  active,
  title,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={active ? "default" : "outline"}
      title={title}
      className="size-7 p-0"
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}
    >
      {children}
    </Button>
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
  const [categoryId, setCategoryId] = useState<string | null>(article.categoryId);
  const [saved, setSaved] = useState("");

  const editor = useEditor({
    extensions: [
      StarterKit,
      LinkExtension.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder: "Write your article here…" }),
    ],
    content: article.bodyHtml,
  }, [article.id]);

  const save = useMutation({
    mutationFn: () =>
      api<Article>(`/api/kb/articles/${article.id}`, {
        method: "PATCH",
        body: JSON.stringify({ title, categoryId, bodyHtml: editor?.getHTML() ?? "" }),
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
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["kb-articles"] }); onDeleted(); },
  });

  const setLink = () => {
    const prev = editor?.getAttributes("link").href ?? "";
    const url = prompt("URL (https://…)", prev);
    if (url === null) return;
    if (url === "") { editor?.chain().focus().extendMarkRange("link").unsetLink().run(); return; }
    editor?.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  };

  if (!editor) return null;

  return (
    <div className="max-w-2xl space-y-4 p-8">
      <Input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Article title"
        className="border-none bg-transparent text-2xl font-bold shadow-none focus-visible:ring-0"
      />

      <div className="flex items-center gap-3">
        <Select value={categoryId ?? ""} onValueChange={(v) => setCategoryId(v || null)}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="No category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">No category</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Badge variant={article.status === "published" ? "default" : "secondary"}>
          {article.status}
        </Badge>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-1 rounded-t-lg border border-b-0 border-input bg-muted/50 px-2 py-1.5">
        <ToolbarBtn title="Bold" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
          <Bold className="size-3.5" />
        </ToolbarBtn>
        <ToolbarBtn title="Italic" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
          <Italic className="size-3.5" />
        </ToolbarBtn>
        <ToolbarBtn title="Code" active={editor.isActive("code")} onClick={() => editor.chain().focus().toggleCode().run()}>
          <Code className="size-3.5" />
        </ToolbarBtn>

        <div className="mx-1 h-4 w-px bg-border" />

        <ToolbarBtn title="Heading 2" active={editor.isActive("heading", { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
          <Heading2 className="size-3.5" />
        </ToolbarBtn>
        <ToolbarBtn title="Heading 3" active={editor.isActive("heading", { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>
          <Heading3 className="size-3.5" />
        </ToolbarBtn>

        <div className="mx-1 h-4 w-px bg-border" />

        <ToolbarBtn title="Bullet list" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}>
          <List className="size-3.5" />
        </ToolbarBtn>
        <ToolbarBtn title="Numbered list" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
          <ListOrdered className="size-3.5" />
        </ToolbarBtn>
        <ToolbarBtn title="Blockquote" active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
          <Quote className="size-3.5" />
        </ToolbarBtn>

        <div className="mx-1 h-4 w-px bg-border" />

        <ToolbarBtn title="Link" active={editor.isActive("link")} onClick={setLink}>
          <Link className="size-3.5" />
        </ToolbarBtn>
      </div>

      {/* Editor */}
      <div className="tiptap-editor rounded-b-lg border border-input bg-background">
        <EditorContent editor={editor} />
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save"}
        </Button>
        {article.status === "published" ? (
          <Button variant="outline" onClick={() => publish.mutate("draft")} disabled={publish.isPending}>
            Unpublish
          </Button>
        ) : (
          <Button variant="outline" onClick={() => publish.mutate("published")} disabled={publish.isPending}>
            Publish
          </Button>
        )}
        <Button variant="destructive" onClick={() => confirm("Delete this article?") && del.mutate()} disabled={del.isPending}>
          <Trash2 className="size-3" />
          Delete
        </Button>
        {saved && <span className="ml-2 self-center text-sm text-green-600">{saved}</span>}
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
