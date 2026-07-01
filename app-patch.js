(() => {
  const TOKEN_KEY = "work_session_token";
  let cfgPromise = null;
  let settingsRendered = false;

  function escapeHtml(value = "") {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  async function loadConfig() {
    if (cfgPromise) return cfgPromise;
    cfgPromise = fetch("app.js", { cache: "no-store" })
      .then(r => r.text())
      .then(text => {
        const url = text.match(/SUPABASE_URL:\s*"([^"]+)"/)?.[1];
        const key = text.match(/SUPABASE_KEY:\s*"([^"]+)"/)?.[1];
        if (!url || !key) throw new Error("Nepodařilo se načíst konfiguraci Supabase.");
        return { url, key };
      });
    return cfgPromise;
  }

  async function rpc(name, params = {}) {
    const cfg = await loadConfig();
    const response = await fetch(`${cfg.url}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: {
        "apikey": cfg.key,
        "Authorization": `Bearer ${cfg.key}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(params)
    });
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch (_) { payload = text; }
    if (!response.ok) {
      throw new Error(payload?.message || payload?.hint || "Nastala chyba v databázi.");
    }
    return payload;
  }

  function toast(message) {
    document.querySelector(".toast")?.remove();
    const box = document.createElement("div");
    box.className = "toast";
    box.textContent = message;
    document.body.appendChild(box);
    setTimeout(() => box.remove(), 2800);
  }

  function showError(message) {
    const target = document.querySelector("[data-patch-error]");
    if (target) target.innerHTML = `<div class="error-box">${escapeHtml(message)}</div>`;
  }

  function cleanLoginScreen() {
    document.querySelectorAll(".auth-preview,.auth-visual").forEach(el => el.remove());
    document.querySelectorAll(".auth-card p").forEach(el => el.remove());
    document.querySelectorAll(".auth-card .success-box").forEach(el => {
      if (el.textContent.includes("Testovací účty")) el.remove();
    });
    document.querySelectorAll(".preview-card").forEach(el => el.remove());
  }

  function removeRefreshButtons() {
    document.querySelectorAll("button").forEach(button => {
      if (button.textContent.trim() === "Obnovit") button.remove();
    });
  }

  function hideManagerSettings() {
    const role = document.querySelector(".role-pill")?.textContent || "";
    const isManager = /Manažer|divák/i.test(role);
    if (!isManager) return;
    document.querySelectorAll(".nav button").forEach(button => {
      if (button.textContent.trim() === "Nastavení") button.remove();
    });
    const title = document.querySelector("#page .page-title")?.textContent || "";
    if (/Nastavení|Informace o aplikaci|Správa účtů/i.test(title)) {
      const calendar = [...document.querySelectorAll(".nav button")].find(b => b.textContent.trim() === "Kalendář");
      calendar?.click();
    }
  }

  async function renderFirstAdmin() {
    const app = document.getElementById("app");
    if (!app) return;
    app.innerHTML = `
      <section class="auth-shell auth-centered">
        <div class="auth-panel">
          <div class="logo-lockup">
            <img src="assets/logo.svg" alt="Logo">
            <div>
              <div class="logo-title">Přehled práce<br>od Daniela Třetiny</div>
              <div class="logo-subtitle">Kalendář, poznámky, projekty a zpětná vazba</div>
            </div>
          </div>
          <form class="auth-card" id="firstAdminForm">
            <h1>Vytvořit admin účet</h1>
            <div data-patch-error></div>
            <div class="form-row">
              <label>Jméno</label>
              <input name="name" autocomplete="name" required>
            </div>
            <div class="form-row">
              <label>Uživatelské jméno</label>
              <input name="username" autocomplete="username" required>
            </div>
            <div class="form-row">
              <label>Heslo</label>
              <input name="password" type="password" autocomplete="new-password" minlength="6" required>
            </div>
            <button class="btn primary" type="submit" style="width:100%">Vytvořit admina</button>
          </form>
        </div>
      </section>
    `;
    document.getElementById("firstAdminForm").addEventListener("submit", async event => {
      event.preventDefault();
      const button = event.submitter;
      button.disabled = true;
      const original = button.textContent;
      button.textContent = "Pracuji...";
      const form = new FormData(event.target);
      try {
        const result = await rpc("register_first_admin", {
          p_name: form.get("name"),
          p_username: form.get("username"),
          p_password: form.get("password")
        });
        localStorage.setItem(TOKEN_KEY, result.token);
        location.reload();
      } catch (error) {
        showError(error.message);
      } finally {
        button.disabled = false;
        button.textContent = original;
      }
    });
  }

  async function renderAccountSettings() {
    const page = document.getElementById("page");
    const role = document.querySelector(".role-pill")?.textContent || "";
    const title = page?.querySelector(".page-title")?.textContent || "";
    if (!page || !/Hlavní účet/i.test(role) || !/Informace o aplikaci|Nastavení|Správa účtů/i.test(title)) return;
    if (page.dataset.accountsPatch === "1") return;

    page.dataset.accountsPatch = "1";
    page.innerHTML = `
      <div class="topbar">
        <div>
          <div class="eyebrow">Nastavení</div>
          <h1 class="page-title">Správa účtů</h1>
          <div class="page-subtitle">Admin zde vytvoří účty pro manažerku. Každý vytvořený účet uvidí pouze data tohoto admin účtu.</div>
        </div>
      </div>
      <section class="settings-grid">
        <div class="card card-pad">
          <h2>Vytvořit účet manažerky</h2>
          <div data-patch-error></div>
          <form id="managerAccountForm" style="margin-top:16px">
            <div class="form-row">
              <label>Jméno</label>
              <input name="name" required>
            </div>
            <div class="form-row">
              <label>Uživatelské jméno</label>
              <input name="username" required>
            </div>
            <div class="form-row">
              <label>Heslo</label>
              <input name="password" type="password" minlength="6" required>
            </div>
            <button class="btn primary" type="submit">Vytvořit účet</button>
          </form>
        </div>
        <div class="card card-pad" id="managerAccountsList">
          <h2>Vytvořené účty</h2>
          <div class="empty">Načítám účty...</div>
        </div>
      </section>
    `;

    async function loadAccounts() {
      const token = localStorage.getItem(TOKEN_KEY) || "";
      const data = await rpc("get_app_data", { p_token: token });
      const list = document.getElementById("managerAccountsList");
      const accounts = data.managerAccounts || [];
      list.innerHTML = `
        <h2>Vytvořené účty</h2>
        ${accounts.length ? accounts.map(account => `
          <div class="note-item">
            <h3>${escapeHtml(account.name)}</h3>
            <div class="page-subtitle">Uživatelské jméno: <strong>${escapeHtml(account.username)}</strong></div>
            <span class="badge">Přístup jen k tomuto admin účtu</span>
          </div>
        `).join("") : `<div class="empty">Zatím není vytvořený žádný manažerský účet.</div>`}
      `;
    }

    await loadAccounts();

    document.getElementById("managerAccountForm").addEventListener("submit", async event => {
      event.preventDefault();
      const button = event.submitter;
      const original = button.textContent;
      button.disabled = true;
      button.textContent = "Pracuji...";
      const form = new FormData(event.target);
      try {
        await rpc("create_manager_account", {
          p_token: localStorage.getItem(TOKEN_KEY) || "",
          p_name: form.get("name"),
          p_username: form.get("username"),
          p_password: form.get("password")
        });
        event.target.reset();
        await loadAccounts();
        toast("Účet byl vytvořen.");
      } catch (error) {
        showError(error.message);
      } finally {
        button.disabled = false;
        button.textContent = original;
      }
    });
  }

  async function checkFirstAdminMode() {
    if (localStorage.getItem(TOKEN_KEY)) return;
    try {
      const hasAdmin = await rpc("app_has_admin");
      if (hasAdmin === false) await renderFirstAdmin();
    } catch (_) {}
  }

  function patchScreen() {
    cleanLoginScreen();
    removeRefreshButtons();
    hideManagerSettings();
    renderAccountSettings().catch(console.warn);
  }

  document.addEventListener("DOMContentLoaded", () => {
    checkFirstAdminMode();
    patchScreen();
    const observer = new MutationObserver(() => patchScreen());
    observer.observe(document.body, { childList: true, subtree: true });
  });
})();
