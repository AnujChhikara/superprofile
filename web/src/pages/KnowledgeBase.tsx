import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api.js";
import { useAuth } from "../auth.js";

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
    <div style={S.root}>
      <div style={S.left}>
        <div style={S.leftHeader}>
          <strong>Articles</strong>
          <button style={S.smallBtn} onClick={() => createArticle.mutate()}>
            + New
          </button>
        </div>
        <button
          style={{ ...S.catToggle, color: showCategories ? "#4f46e5" : "#6b7280" }}
          onClick={() => setShowCategories((v) => !v)}
        >
          Manage categories
        </button>
        <div style={S.list}>
          {articles.length === 0 && <div style={S.muted}>No articles yet.</div>}
          {articles.map((a) => (
            <button
              key={a.id}
              onClick={() => {
                setSelectedId(a.id);
                setShowCategories(false);
              }}
              style={{
                ...S.item,
                background: selectedId === a.id && !showCategories ? "#eef2ff" : "transparent",
              }}
            >
              <div style={S.itemTitle}>{a.title}</div>
              <span
                style={{
                  ...S.chip,
                  background: a.status === "published" ? "#dcfce7" : "#f3f4f6",
                  color: a.status === "published" ? "#166534" : "#6b7280",
                }}
              >
                {a.status}
              </span>
            </button>
          ))}
        </div>
        {activeWorkspace && (
          <a
            style={S.publicLink}
            href={`${API_ORIGIN}/${activeWorkspace.slug}`}
            target="_blank"
            rel="noreferrer"
          >
            View public site ↗
          </a>
        )}
      </div>

      <div style={S.main}>
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
          <div style={S.empty}>Select an article or create a new one.</div>
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
  const [categoryId, setCategoryId] = useState<string | null>(article.categoryId);
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
    <div style={S.editor}>
      <input
        style={S.titleInput}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Article title"
      />
      <div style={S.editorRow}>
        <select
          style={S.select}
          value={categoryId ?? ""}
          onChange={(e) => setCategoryId(e.target.value || null)}
        >
          <option value="">No category</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <span
          style={{
            ...S.chip,
            background: article.status === "published" ? "#dcfce7" : "#f3f4f6",
            color: article.status === "published" ? "#166534" : "#6b7280",
          }}
        >
          {article.status}
        </span>
      </div>

      <div style={S.toolbar}>
        {(
          [
            ["Bold", "bold", "B"],
            ["Italic", "italic", "i"],
            ["Bullet list", "insertUnorderedList", "• List"],
            ["Numbered list", "insertOrderedList", "1. List"],
          ] as const
        ).map(([label, command, text]) => (
          <button
            key={command}
            title={label}
            style={S.tbBtn}
            onMouseDown={(e) => {
              e.preventDefault();
              cmd(command);
            }}
          >
            {text}
          </button>
        ))}
        <button
          title="Heading"
          style={S.tbBtn}
          onMouseDown={(e) => {
            e.preventDefault();
            cmd("formatBlock", "h2");
          }}
        >
          H2
        </button>
        <button
          title="Link"
          style={S.tbBtn}
          onMouseDown={(e) => {
            e.preventDefault();
            const url = prompt("Link URL (https://…)");
            if (url) cmd("createLink", url);
          }}
        >
          Link
        </button>
      </div>

      <div ref={bodyRef} contentEditable style={S.body} suppressContentEditableWarning />

      <div style={S.actions}>
        <button style={S.primary} onClick={() => save.mutate()}>
          Save
        </button>
        {article.status === "published" ? (
          <button style={S.secondary} onClick={() => publish.mutate("draft")}>
            Unpublish
          </button>
        ) : (
          <button style={S.secondary} onClick={() => publish.mutate("published")}>
            Publish
          </button>
        )}
        <button
          style={S.danger}
          onClick={() => confirm("Delete this article?") && del.mutate()}
        >
          Delete
        </button>
        <span style={S.savedNote}>{saved}</span>
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
    mutationFn: (id: string) => api(`/api/kb/categories/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["kb-categories"] }),
  });
  return (
    <div style={S.editor}>
      <h3 style={{ marginTop: 0 }}>Categories</h3>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <input
          style={{ ...S.select, flex: 1 }}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New category name"
        />
        <button style={S.primary} disabled={!name.trim()} onClick={() => create.mutate()}>
          Add
        </button>
      </div>
      {categories.map((c) => (
        <div key={c.id} style={S.catRow}>
          <span>{c.name}</span>
          <button style={S.danger} onClick={() => del.mutate(c.id)}>
            Delete
          </button>
        </div>
      ))}
      {categories.length === 0 && <div style={S.muted}>No categories yet.</div>}
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  root: { display: "flex", height: "100%", fontFamily: "system-ui, sans-serif" },
  left: { width: 280, flexShrink: 0, borderRight: "1px solid #e5e7eb", display: "flex", flexDirection: "column", background: "#fff" },
  leftHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px", borderBottom: "1px solid #f3f4f6" },
  smallBtn: { background: "#4f46e5", color: "#fff", border: "none", borderRadius: 6, padding: "4px 10px", fontSize: 12, cursor: "pointer" },
  catToggle: { background: "none", border: "none", textAlign: "left", padding: "10px 16px", fontSize: 13, cursor: "pointer", borderBottom: "1px solid #f3f4f6" },
  list: { flex: 1, overflowY: "auto" },
  item: { display: "block", width: "100%", textAlign: "left", padding: "12px 16px", border: "none", borderBottom: "1px solid #f9fafb", cursor: "pointer" },
  itemTitle: { fontSize: 13, fontWeight: 600, color: "#111827", marginBottom: 4 },
  chip: { fontSize: 10, fontWeight: 600, padding: "1px 6px", borderRadius: 10, textTransform: "uppercase" },
  publicLink: { padding: "12px 16px", fontSize: 13, color: "#4f46e5", borderTop: "1px solid #f3f4f6" },
  main: { flex: 1, overflowY: "auto", background: "#fafafa" },
  empty: { padding: 40, color: "#9ca3af" },
  muted: { padding: 16, color: "#9ca3af", fontSize: 13 },
  editor: { padding: "28px 36px", maxWidth: 760 },
  titleInput: { width: "100%", fontSize: 22, fontWeight: 600, border: "none", outline: "none", background: "transparent", marginBottom: 12, color: "#111827" },
  editorRow: { display: "flex", gap: 10, alignItems: "center", marginBottom: 16 },
  select: { padding: "6px 10px", border: "1px solid #e5e7eb", borderRadius: 6, fontSize: 13 },
  toolbar: { display: "flex", gap: 4, marginBottom: 8, borderBottom: "1px solid #e5e7eb", paddingBottom: 8 },
  tbBtn: { border: "1px solid #e5e7eb", background: "#fff", borderRadius: 6, padding: "4px 8px", fontSize: 12, cursor: "pointer" },
  body: { minHeight: 300, border: "1px solid #e5e7eb", borderRadius: 8, padding: 16, background: "#fff", fontSize: 14, lineHeight: 1.7, outline: "none" },
  actions: { display: "flex", gap: 8, alignItems: "center", marginTop: 16 },
  primary: { background: "#4f46e5", color: "#fff", border: "none", borderRadius: 6, padding: "8px 16px", fontWeight: 600, fontSize: 13, cursor: "pointer" },
  secondary: { background: "#f3f4f6", color: "#374151", border: "1px solid #e5e7eb", borderRadius: 6, padding: "8px 16px", fontSize: 13, cursor: "pointer" },
  danger: { background: "#fef2f2", color: "#b91c1c", border: "1px solid #fecaca", borderRadius: 6, padding: "8px 16px", fontSize: 13, cursor: "pointer" },
  savedNote: { color: "#16a34a", fontSize: 13 },
  catRow: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid #eef2f7" },
};
