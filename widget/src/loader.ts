// Embeddable loader — injects a launcher button + hidden iframe. No deps.
// Usage: <script src="https://api.host/widget.js" data-workspace="pk_xxx" async></script>
(function () {
  const script =
    (document.currentScript as HTMLScriptElement | null) ??
    (Array.from(document.getElementsByTagName("script")).find((s) =>
      /widget\.js(\?|$)/.test(s.src)
    ) as HTMLScriptElement | undefined);
  if (!script) return;

  const workspaceKey = script.dataset.workspace ?? "";
  if (!workspaceKey) {
    console.warn("[support-widget] missing data-workspace");
    return;
  }
  // API origin = where this script was served from.
  const apiOrigin = new URL(script.src).origin;
  const BRAND = "#4f46e5";
  const Z = 2147483000;

  let open = false;

  // ---- launcher button ----
  const btn = document.createElement("button");
  btn.setAttribute("aria-label", "Open support chat");
  Object.assign(btn.style, {
    position: "fixed",
    bottom: "20px",
    right: "20px",
    width: "56px",
    height: "56px",
    borderRadius: "50%",
    background: BRAND,
    border: "none",
    cursor: "pointer",
    boxShadow: "0 4px 16px rgba(0,0,0,0.2)",
    zIndex: String(Z + 1),
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  } as CSSStyleDeclaration);
  btn.innerHTML =
    '<svg width="26" height="26" viewBox="0 0 24 24" fill="none"><path d="M4 5h16v10H8l-4 4V5z" fill="#fff"/></svg>';

  // ---- unread badge ----
  const badge = document.createElement("span");
  Object.assign(badge.style, {
    position: "absolute",
    top: "-2px",
    right: "-2px",
    minWidth: "18px",
    height: "18px",
    borderRadius: "9px",
    background: "#ef4444",
    color: "#fff",
    fontSize: "11px",
    fontWeight: "700",
    display: "none",
    alignItems: "center",
    justifyContent: "center",
    padding: "0 5px",
    fontFamily: "system-ui, sans-serif",
  } as CSSStyleDeclaration);
  btn.appendChild(badge);

  // ---- iframe panel ----
  const iframe = document.createElement("iframe");
  iframe.src = `${apiOrigin}/widget/frame?ws=${encodeURIComponent(workspaceKey)}`;
  iframe.title = "Support chat";
  Object.assign(iframe.style, {
    position: "fixed",
    bottom: "88px",
    right: "20px",
    width: "375px",
    height: "600px",
    maxHeight: "calc(100vh - 108px)",
    border: "none",
    borderRadius: "16px",
    boxShadow: "0 12px 48px rgba(0,0,0,0.24)",
    zIndex: String(Z),
    display: "none",
    background: "#fff",
  } as CSSStyleDeclaration);

  function applyMobile() {
    if (window.innerWidth <= 480) {
      Object.assign(iframe.style, {
        width: "100vw",
        height: "100vh",
        maxHeight: "100vh",
        bottom: "0",
        right: "0",
        borderRadius: "0",
      });
    }
  }
  window.addEventListener("resize", applyMobile);
  applyMobile();

  function setOpen(next: boolean) {
    open = next;
    iframe.style.display = open ? "block" : "none";
    if (open) {
      badge.style.display = "none";
      iframe.contentWindow?.postMessage({ type: "widget:opened" }, "*");
    }
  }

  btn.addEventListener("click", () => setOpen(!open));

  // ---- messages from the frame ----
  window.addEventListener("message", (e) => {
    if (e.source !== iframe.contentWindow) return;
    const data = e.data as { type?: string; count?: number };
    if (data?.type === "widget:unread" && !open) {
      const c = data.count ?? 0;
      badge.textContent = String(c);
      badge.style.display = c > 0 ? "flex" : "none";
    } else if (data?.type === "widget:close") {
      setOpen(false);
    }
  });

  document.body.appendChild(iframe);
  document.body.appendChild(btn);
})();
