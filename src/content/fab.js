(() => {
  if (window.__tabflowFab) return;
  window.__tabflowFab = true;

  const HOST_ID = "tabflow-fab-host";

  async function init() {
    let res;
    try {
      res = await chrome.runtime.sendMessage({ type: "GET_FAB_CONFIG" });
    } catch {
      return;
    }
    if (!res?.ok || !res.show) {
      removeHost();
      return;
    }
    mount(res.recent || []);
  }

  function removeHost() {
    document.getElementById(HOST_ID)?.remove();
  }

  function mount(recent) {
    removeHost();
    const host = document.createElement("div");
    host.id = HOST_ID;
    host.style.all = "initial";
    host.style.position = "fixed";
    host.style.right = "16px";
    host.style.bottom = "16px";
    host.style.zIndex = "2147483646";
    host.style.fontFamily =
      'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';

    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        :host { all: initial; }
        .wrap { position: relative; display: flex; flex-direction: column; align-items: flex-end; gap: 8px; }
        .panel {
          display: none;
          width: 280px;
          max-height: 320px;
          overflow: auto;
          background: #1c1c1c;
          color: #f5f5f5;
          border: 1px solid #3a3a3a;
          border-radius: 10px;
          box-shadow: 0 12px 40px rgba(0,0,0,.45);
          padding: 10px;
        }
        .panel.open { display: block; }
        .title { font-size: 12px; letter-spacing: .04em; color: #a3a3a3; margin: 0 0 8px; }
        .item {
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 6px;
          padding: 8px;
          border-radius: 8px;
          cursor: pointer;
          border: 0;
          background: transparent;
          color: inherit;
          width: 100%;
          text-align: left;
          font: inherit;
        }
        .item:hover { background: #2a2a2a; }
        .name { font-size: 13px; line-height: 1.3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .url { font-size: 11px; color: #8a8a8a; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .empty { font-size: 12px; color: #8a8a8a; padding: 8px; }
        .btn {
          width: 44px; height: 44px;
          border-radius: 999px;
          border: 1px solid #4a3b1a;
          background: #d97706;
          color: #1a1206;
          font-weight: 700;
          font-size: 14px;
          cursor: pointer;
          box-shadow: 0 8px 24px rgba(0,0,0,.35);
        }
        .btn:hover { filter: brightness(1.05); }
        .btn:active { transform: scale(.98); }
      </style>
      <div class="wrap">
        <div class="panel" id="panel" role="dialog" aria-label="TabFlow archive">
          <p class="title">Recent archive</p>
          <div id="list"></div>
        </div>
        <button class="btn" id="toggle" type="button" title="TabFlow archive" aria-expanded="false">TF</button>
      </div>
    `;

    const panel = root.getElementById("panel");
    const list = root.getElementById("list");
    const toggle = root.getElementById("toggle");

    function render(items) {
      if (!items.length) {
        list.innerHTML = `<div class="empty">Archive empty</div>`;
        return;
      }
      list.innerHTML = items
        .map(
          (e) => `
        <button type="button" class="item" data-id="${escapeAttr(e.id)}">
          <span>
            <div class="name">${escapeHtml(e.title || e.url)}</div>
            <div class="url">${escapeHtml(e.url || "")}</div>
          </span>
        </button>`
        )
        .join("");
      list.querySelectorAll(".item").forEach((el) => {
        el.addEventListener("click", async () => {
          const id = el.getAttribute("data-id");
          await chrome.runtime.sendMessage({ type: "RESTORE_ARCHIVE", id, remove: false });
        });
      });
    }

    render(recent);

    toggle.addEventListener("click", async () => {
      const open = panel.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      if (open) {
        const cfg = await chrome.runtime.sendMessage({ type: "GET_FAB_CONFIG" });
        if (cfg?.ok) render(cfg.recent || []);
      }
    });

    document.documentElement.appendChild(host);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/'/g, "&#39;");
  }

  init();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && (changes.settings || changes.archive)) init();
  });
})();
