const CONFIG = {
  SUPABASE_URL: "https://ecyxrmpyfmckzfkqzzqu.supabase.co",
  SUPABASE_KEY: "sb_publishable_7G26IDsC0jBcg5jxhf6yqg_7fYRP4UG"
};

const state = {
  token: localStorage.getItem("work_session_token") || "",
  user: null,
  data: { notes: [], projects: [], managerAccounts: [] },
  hasAdmin: null,
  view: "calendar",
  month: new Date(),
  modal: null,
  selectedRating: 0
};

const CATEGORIES = {
  idea: "Nápady",
  in_progress: "Rozpracované projekty",
  done: "Hotové projekty"
};

const PRIORITIES = {
  low: "Nízká",
  normal: "Normální",
  high: "Vysoká"
};

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function toIsoDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatCzDate(value) {
  if (!value) return "";
  const date = new Date(value + "T12:00:00");
  return date.toLocaleDateString("cs-CZ", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatDateTime(value) {
  if (!value) return "";
  return new Date(value).toLocaleString("cs-CZ");
}

function isAdmin() {
  return state.user?.role === "admin";
}

function isManager() {
  return state.user?.role === "manager";
}

function roleLabel(role) {
  return role === "admin" ? "Hlavní účet" : "Manažerka / divák";
}

async function rpc(name, params = {}) {
  const response = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      "apikey": CONFIG.SUPABASE_KEY,
      "Authorization": `Bearer ${CONFIG.SUPABASE_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(params)
  });

  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch (_) {
    payload = text;
  }

  if (!response.ok) {
    const message = payload?.message || payload?.error_description || payload?.hint || "Nastala chyba v databázi.";
    throw new Error(message);
  }

  return payload;
}

function showToast(message) {
  const old = document.querySelector(".toast");
  if (old) old.remove();
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2800);
}

function showError(message) {
  const box = document.querySelector("[data-error]");
  if (box) box.innerHTML = `<div class="error-box">${escapeHtml(message)}</div>`;
}

function setLoading(target, loading = true) {
  if (!target) return;
  target.disabled = loading;
  target.dataset.originalText ||= target.textContent;
  target.textContent = loading ? "Pracuji..." : target.dataset.originalText;
}

async function loadData() {
  const payload = await rpc("get_app_data", { p_token: state.token });
  state.user = payload.currentUser;
  state.data.notes = payload.notes || [];
  state.data.projects = payload.projects || [];
  state.data.managerAccounts = payload.managerAccounts || [];
  localStorage.setItem("work_session_token", state.token);
}

async function init() {
  try {
    state.hasAdmin = await rpc("app_has_admin");
  } catch (error) {
    console.warn(error);
    state.hasAdmin = true;
  }

  if (state.token) {
    try {
      await loadData();
      renderApp();
      return;
    } catch (error) {
      console.warn(error);
      localStorage.removeItem("work_session_token");
      state.token = "";
      state.user = null;
    }
  }
  renderLogin();
}

function renderLogin() {
  const firstAdminMode = state.hasAdmin === false;
  document.getElementById("app").innerHTML = `
    <section class="auth-shell auth-centered">
      <div class="auth-panel">
        <div class="logo-lockup">
          <img src="assets/logo.svg" alt="Logo">
          <div>
            <div class="logo-title">Přehled práce<br>od Daniela Třetiny</div>
            <div class="logo-subtitle">Kalendář, poznámky, projekty a zpětná vazba</div>
          </div>
        </div>

        ${firstAdminMode ? `
          <form class="auth-card" id="initialAdminForm">
            <h1>Vytvořit admin účet</h1>
            <div data-error></div>
            <div class="success-box">Nejdřív vytvoř hlavní admin účet. Další účty potom přidáš v nastavení.</div>
            <div class="form-row">
              <label for="initialName">Jméno</label>
              <input id="initialName" autocomplete="name" placeholder="Daniel Třetina" required>
            </div>
            <div class="form-row">
              <label for="initialUsername">Uživatelské jméno</label>
              <input id="initialUsername" autocomplete="username" placeholder="např. daniel" required>
            </div>
            <div class="form-row">
              <label for="initialPassword">Heslo</label>
              <input id="initialPassword" type="password" autocomplete="new-password" minlength="6" placeholder="Minimálně 6 znaků" required>
            </div>
            <button class="btn primary" type="submit" style="width:100%">Vytvořit admina</button>
          </form>
        ` : `
          <form class="auth-card" id="loginForm">
            <h1>Přihlášení</h1>
            <div data-error></div>
            <div class="form-row">
              <label for="username">Uživatelské jméno</label>
              <input id="username" autocomplete="username" required>
            </div>
            <div class="form-row">
              <label for="password">Heslo</label>
              <input id="password" type="password" autocomplete="current-password" required>
            </div>
            <button class="btn primary" type="submit" style="width:100%">Přihlásit se</button>
          </form>
        `}
      </div>
    </section>
  `;

  const loginForm = document.getElementById("loginForm");
  if (loginForm) {
    loginForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = event.submitter;
      setLoading(button, true);
      try {
        const username = document.getElementById("username").value.trim();
        const password = document.getElementById("password").value;
        const result = await rpc("login_user", { p_username: username, p_password: password });
        state.token = result.token;
        state.user = result.user;
        await loadData();
        renderApp();
      } catch (error) {
        showError(error.message);
      } finally {
        setLoading(button, false);
      }
    });
  }

  const initialAdminForm = document.getElementById("initialAdminForm");
  if (initialAdminForm) {
    initialAdminForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = event.submitter;
      setLoading(button, true);
      try {
        const result = await rpc("register_first_admin", {
          p_name: document.getElementById("initialName").value.trim(),
          p_username: document.getElementById("initialUsername").value.trim(),
          p_password: document.getElementById("initialPassword").value
        });
        state.token = result.token;
        state.user = result.user;
        state.hasAdmin = true;
        await loadData();
        renderApp();
        showToast("Admin účet byl vytvořen.");
      } catch (error) {
        showError(error.message);
      } finally {
        setLoading(button, false);
      }
    });
  }
}

function renderApp() {
  document.getElementById("app").innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="brand">
          <img src="assets/logo.svg" alt="Logo">
          <div class="brand-name">Přehled práce<br>od Daniela Třetiny</div>
        </div>

        <nav class="nav">
          <button class="${state.view === "calendar" ? "active" : ""}" onclick="App.setView('calendar')">Kalendář</button>
          <button class="${state.view === "projects" ? "active" : ""}" onclick="App.setView('projects')">Projekty</button>
          ${isAdmin() ? `<button class="${state.view === "settings" ? "active" : ""}" onclick="App.setView('settings')">Nastavení</button>` : ""}
        </nav>

        <div class="sidebar-footer">
          <div class="user-pill">${escapeHtml(state.user?.name || "")}</div>
          <span class="role-pill">${escapeHtml(roleLabel(state.user?.role))}</span>
          <div style="margin-top:12px">
            <button class="btn ghost" style="width:100%" onclick="App.logout()">Odhlásit se</button>
          </div>
        </div>
      </aside>

      <main class="main">
        <div id="page"></div>
      </main>
    </div>
  `;
  renderPage();
}

function renderPage() {
  if (!isAdmin() && state.view === "settings") state.view = "calendar";
  if (state.view === "calendar") return renderCalendar();
  if (state.view === "projects") return renderProjects();
  if (isAdmin()) return renderSettings();
  state.view = "calendar";
  return renderCalendar();
}

function renderCalendar() {
  const month = state.month;
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const firstDay = new Date(year, monthIndex, 1);
  const lastDay = new Date(year, monthIndex + 1, 0);
  const startOffset = (firstDay.getDay() + 6) % 7;
  const gridStart = new Date(year, monthIndex, 1 - startOffset);
  const days = Array.from({ length: 42 }, (_, index) => {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + index);
    return d;
  });

  const monthName = month.toLocaleDateString("cs-CZ", { month: "long", year: "numeric" });

  document.getElementById("page").innerHTML = `
    <div class="topbar">
      <div>
        <div class="eyebrow">Kalendář</div>
        <h1 class="page-title">Pracovní poznámky</h1>
        <div class="page-subtitle">
          Klikni na den, přidej poznámku a k poznámce nahraj dokument. Dokument se po kliknutí otevře v novém okně.
        </div>
      </div>
      <div class="actions">
        <button class="btn" onclick="App.exportNotes()">Stáhnout všechny poznámky</button>
      </div>
    </div>

    <section class="card card-pad">
      <div class="toolbar">
        <button class="btn ghost" onclick="App.changeMonth(-1)">← Předchozí</button>
        <div class="month-title">${escapeHtml(monthName.charAt(0).toUpperCase() + monthName.slice(1))}</div>
        <button class="btn ghost" onclick="App.changeMonth(1)">Další →</button>
      </div>

      <div class="calendar-grid">
        ${["Po", "Út", "St", "Čt", "Pá", "So", "Ne"].map(d => `<div class="weekday">${d}</div>`).join("")}
        ${days.map(d => dayCell(d, monthIndex)).join("")}
      </div>
    </section>
  `;
}

function dayCell(date, activeMonth) {
  const iso = toIsoDate(date);
  const notes = state.data.notes.filter(note => note.date === iso);
  const docCount = notes.reduce((sum, note) => sum + (note.documents?.length || 0), 0);
  const muted = date.getMonth() !== activeMonth ? "muted" : "";
  return `
    <button class="day-cell ${muted}" onclick="App.openDay('${iso}')">
      <div class="day-number">${date.getDate()}</div>
      <div class="day-meta">
        ${notes.length ? `<span class="badge">${notes.length} pozn.</span>` : ""}
        ${docCount ? `<span class="badge orange">${docCount} dok.</span>` : ""}
      </div>
    </button>
  `;
}

function openDay(dateIso) {
  const notes = state.data.notes.filter(note => note.date === dateIso)
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));

  state.modal = { type: "day", dateIso };

  document.body.insertAdjacentHTML("beforeend", `
    <div class="modal-backdrop" id="modalBackdrop" onclick="App.closeModalFromBackdrop(event)">
      <div class="modal">
        <div class="modal-header">
          <div>
            <div class="eyebrow">Detail dne</div>
            <h2>${formatCzDate(dateIso)}</h2>
          </div>
          <button class="close-btn" onclick="App.closeModal()">×</button>
        </div>
        <div class="modal-body">
          ${isAdmin() ? noteForm(dateIso) : `<div class="success-box">Manažerka může poznámky a dokumenty pouze zobrazit.</div>`}
          <h3 style="margin:20px 0 12px">Poznámky v tomto dni</h3>
          <div id="dayNotes">
            ${notes.length ? notes.map(noteItem).join("") : `<div class="empty">Zatím zde nejsou žádné poznámky.</div>`}
          </div>

          ${isAdmin() && notes.length ? uploadDocumentForm(notes) : ""}
        </div>
      </div>
    </div>
  `);
}

function noteForm(dateIso) {
  return `
    <form class="card card-pad" id="noteForm">
      <h3 style="margin-bottom:14px">Přidat poznámku</h3>
      <div class="form-grid">
        <div class="form-row">
          <label>Název</label>
          <input name="title" placeholder="Např. Schůzka, úkol, domluva..." required>
        </div>
        <div class="form-row">
          <label>Priorita</label>
          <select name="priority">
            <option value="normal">Normální</option>
            <option value="high">Vysoká</option>
            <option value="low">Nízká</option>
          </select>
        </div>
        <div class="form-row full">
          <label>Text poznámky</label>
          <textarea name="content" placeholder="Sem napiš poznámku k danému dni..." required></textarea>
        </div>
      </div>
      <button class="btn primary" type="submit">Uložit poznámku</button>
    </form>
  `;
}

function noteItem(note) {
  return `
    <article class="note-item">
      <div class="project-footer">
        <span class="badge">${escapeHtml(PRIORITIES[note.priority] || note.priority || "Normální")}</span>
        <span class="badge gray">Upraveno: ${escapeHtml(formatDateTime(note.updated_at))}</span>
      </div>
      <h3>${escapeHtml(note.title)}</h3>
      <div class="note-content">${escapeHtml(note.content)}</div>

      ${note.documents?.length ? `
        <div class="docs-list">
          ${note.documents.map(doc => `
            <div class="doc-item">
              <div>
                <strong>${escapeHtml(doc.file_name)}</strong><br>
                <small>${Math.round((doc.file_size || 0) / 1024)} kB · ${escapeHtml(doc.mime_type || "soubor")}</small>
              </div>
              <div class="actions">
                <button class="btn" onclick="App.openDocument('${doc.id}')">Otevřít</button>
                ${isAdmin() ? `<button class="btn danger" onclick="App.deleteDocument('${doc.id}')">Smazat</button>` : ""}
              </div>
            </div>
          `).join("")}
        </div>
      ` : ""}

      ${isAdmin() ? `
        <div class="inline-actions">
          <button class="btn ghost" onclick="App.editNote('${note.id}')">Upravit</button>
          <button class="btn danger" onclick="App.deleteNote('${note.id}')">Smazat</button>
        </div>
      ` : ""}
    </article>
  `;
}

function uploadDocumentForm(notes) {
  return `
    <form class="card card-pad" id="documentForm" style="margin-top:18px">
      <h3 style="margin-bottom:14px">Nahrát dokument k poznámce</h3>
      <div class="form-grid">
        <div class="form-row">
          <label>Vyber poznámku</label>
          <select name="note_id" required>
            ${notes.map(note => `<option value="${note.id}">${escapeHtml(note.title)}</option>`).join("")}
          </select>
        </div>
        <div class="form-row">
          <label>Dokument</label>
          <input name="file" type="file" required>
        </div>
      </div>
      <button class="btn primary" type="submit">Nahrát dokument</button>
    </form>
  `;
}

async function handleModalForms(event) {
  const noteFormEl = event.target.closest("#noteForm");
  if (noteFormEl) {
    event.preventDefault();
    const button = event.submitter;
    setLoading(button, true);
    const form = new FormData(noteFormEl);
    try {
      const dateIso = state.modal.dateIso;
      await rpc("add_calendar_note", {
        p_token: state.token,
        p_date: dateIso,
        p_title: form.get("title"),
        p_content: form.get("content"),
        p_priority: form.get("priority")
      });
      await reload(false);
      closeModal();
      openDay(dateIso);
      showToast("Poznámka byla uložena.");
    } catch (error) {
      alert(error.message);
    } finally {
      setLoading(button, false);
    }
  }

  const documentFormEl = event.target.closest("#documentForm");
  if (documentFormEl) {
    event.preventDefault();
    const button = event.submitter;
    setLoading(button, true);
    const form = new FormData(documentFormEl);
    const file = form.get("file");
    try {
      const contentBase64 = await fileToBase64(file);
      await rpc("add_calendar_document", {
        p_token: state.token,
        p_note_id: form.get("note_id"),
        p_file_name: file.name,
        p_mime_type: file.type || "application/octet-stream",
        p_file_size: file.size,
        p_content_base64: contentBase64
      });
      const dateIso = state.modal.dateIso;
      await reload(false);
      closeModal();
      openDay(dateIso);
      showToast("Dokument byl nahrán.");
    } catch (error) {
      alert(error.message);
    } finally {
      setLoading(button, false);
    }
  }

  const projectFormEl = event.target.closest("#projectForm");
  if (projectFormEl) {
    event.preventDefault();
    const button = event.submitter;
    setLoading(button, true);
    const form = new FormData(projectFormEl);
    const id = form.get("id");
    const payload = {
      p_token: state.token,
      p_title: form.get("title"),
      p_short_description: form.get("short_description"),
      p_full_description: form.get("full_description"),
      p_category: form.get("category"),
      p_priority: form.get("priority"),
      p_status: form.get("status")
    };
    try {
      if (id) {
        await rpc("update_project", { ...payload, p_project_id: id });
        showToast("Projekt byl upraven.");
      } else {
        await rpc("create_project", payload);
        showToast("Projekt byl vytvořen.");
      }
      await reload(false);
      closeModal();
    } catch (error) {
      alert(error.message);
    } finally {
      setLoading(button, false);
    }
  }

  const checklistForm = event.target.closest("#checklistForm");
  if (checklistForm) {
    event.preventDefault();
    const button = event.submitter;
    setLoading(button, true);
    const form = new FormData(checklistForm);
    try {
      await rpc("add_checklist_item", {
        p_token: state.token,
        p_project_id: form.get("project_id"),
        p_text: form.get("text")
      });
      await refreshProjectModal(form.get("project_id"), "Bod checklistu byl přidán.");
    } catch (error) {
      alert(error.message);
    } finally {
      setLoading(button, false);
    }
  }

  const reviewForm = event.target.closest("#reviewForm");
  if (reviewForm) {
    event.preventDefault();
    const button = event.submitter;
    setLoading(button, true);
    const form = new FormData(reviewForm);
    try {
      await rpc("save_project_review", {
        p_token: state.token,
        p_project_id: form.get("project_id"),
        p_rating: state.selectedRating || Number(form.get("rating") || 0),
        p_comment: form.get("comment")
      });
      await refreshProjectModal(form.get("project_id"), "Hodnocení bylo uloženo.");
    } catch (error) {
      alert(error.message);
    } finally {
      setLoading(button, false);
    }
  }

  const managerAccountForm = event.target.closest("#managerAccountForm");
  if (managerAccountForm) {
    event.preventDefault();
    const button = event.submitter;
    setLoading(button, true);
    const form = new FormData(managerAccountForm);
    try {
      await rpc("create_manager_account", {
        p_token: state.token,
        p_name: form.get("name"),
        p_username: form.get("username"),
        p_password: form.get("password")
      });
      managerAccountForm.reset();
      await reload(false);
      showToast("Účet byl vytvořen a přiřazen k tomuto adminovi.");
    } catch (error) {
      showError(error.message);
    } finally {
      setLoading(button, false);
    }
  }

}

document.addEventListener("submit", handleModalForms);

async function reload(render = true) {
  await loadData();
  if (render) renderApp();
  else renderPage();
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function base64ToBlob(base64, mimeType) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType || "application/octet-stream" });
}

function closeModalFromBackdrop(event) {
  if (event.target.id === "modalBackdrop") closeModal();
}

function closeModal() {
  document.getElementById("modalBackdrop")?.remove();
  state.modal = null;
  state.selectedRating = 0;
}

async function editNote(noteId) {
  const note = state.data.notes.find(n => n.id === noteId);
  if (!note) return;
  closeModal();
  document.body.insertAdjacentHTML("beforeend", `
    <div class="modal-backdrop" id="modalBackdrop" onclick="App.closeModalFromBackdrop(event)">
      <div class="modal small">
        <div class="modal-header">
          <div>
            <div class="eyebrow">Upravit poznámku</div>
            <h2>${escapeHtml(formatCzDate(note.date))}</h2>
          </div>
          <button class="close-btn" onclick="App.closeModal()">×</button>
        </div>
        <div class="modal-body">
          <form id="editNoteForm">
            <div class="form-row">
              <label>Název</label>
              <input name="title" value="${escapeHtml(note.title)}" required>
            </div>
            <div class="form-row">
              <label>Priorita</label>
              <select name="priority">
                ${Object.entries(PRIORITIES).map(([key, label]) => `<option value="${key}" ${note.priority === key ? "selected" : ""}>${label}</option>`).join("")}
              </select>
            </div>
            <div class="form-row">
              <label>Text poznámky</label>
              <textarea name="content" required>${escapeHtml(note.content)}</textarea>
            </div>
            <button class="btn primary" type="submit">Uložit změny</button>
          </form>
        </div>
      </div>
    </div>
  `);

  document.getElementById("editNoteForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.submitter;
    setLoading(button, true);
    const form = new FormData(event.target);
    try {
      await rpc("update_calendar_note", {
        p_token: state.token,
        p_note_id: noteId,
        p_title: form.get("title"),
        p_content: form.get("content"),
        p_priority: form.get("priority")
      });
      const dateIso = note.date;
      await reload(false);
      closeModal();
      openDay(dateIso);
      showToast("Poznámka byla upravena.");
    } catch (error) {
      alert(error.message);
    } finally {
      setLoading(button, false);
    }
  });
}

async function deleteNote(noteId) {
  const note = state.data.notes.find(n => n.id === noteId);
  if (!note || !confirm(`Opravdu smazat poznámku „${note.title}“ včetně dokumentů?`)) return;
  await rpc("delete_calendar_note", { p_token: state.token, p_note_id: noteId });
  const dateIso = note.date;
  await reload(false);
  closeModal();
  openDay(dateIso);
  showToast("Poznámka byla smazána.");
}

async function deleteDocument(documentId) {
  if (!confirm("Opravdu smazat tento dokument?")) return;
  const dateIso = state.modal?.dateIso;
  await rpc("delete_calendar_document", { p_token: state.token, p_document_id: documentId });
  await reload(false);
  closeModal();
  if (dateIso) openDay(dateIso);
  showToast("Dokument byl smazán.");
}

async function openDocument(documentId) {
  try {
    const doc = await rpc("get_calendar_document", { p_token: state.token, p_document_id: documentId });
    const blob = base64ToBlob(doc.content_base64, doc.mime_type);
    const url = URL.createObjectURL(blob);
    const win = window.open(url, "_blank", "noopener,noreferrer");
    if (!win) {
      const a = document.createElement("a");
      a.href = url;
      a.download = doc.file_name || "dokument";
      a.click();
    }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (error) {
    alert(error.message);
  }
}

function exportNotes() {
  const sorted = [...state.data.notes].sort((a, b) => a.date.localeCompare(b.date));
  const lines = [
    "Přehled práce od Daniela Třetiny",
    "Export všech kalendářových poznámek",
    `Vygenerováno: ${new Date().toLocaleString("cs-CZ")}`,
    ""
  ];

  if (!sorted.length) {
    lines.push("Zatím nejsou uložené žádné poznámky.");
  }

  for (const note of sorted) {
    lines.push("------------------------------------------------------------");
    lines.push(`Datum: ${formatCzDate(note.date)}`);
    lines.push(`Název: ${note.title}`);
    lines.push(`Priorita: ${PRIORITIES[note.priority] || note.priority || "Normální"}`);
    lines.push(`Upraveno: ${formatDateTime(note.updated_at)}`);
    lines.push("");
    lines.push(note.content || "");
    if (note.documents?.length) {
      lines.push("");
      lines.push("Dokumenty:");
      for (const doc of note.documents) lines.push(`- ${doc.file_name}`);
    }
    lines.push("");
  }

  const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `prehled-prace-poznamky-${todayIso()}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

function renderProjects() {
  document.getElementById("page").innerHTML = `
    <div class="topbar">
      <div>
        <div class="eyebrow">Projekty</div>
        <h1 class="page-title">Projektový přehled</h1>
        <div class="page-subtitle">
          Nápady, rozpracované projekty a hotové projekty. Manažerka může přidat hodnocení a komentář, ale nemůže měnit zadání.
        </div>
      </div>
      <div class="actions">
        ${isAdmin() ? `<button class="btn primary" onclick="App.openProjectForm()">Vytvořit projekt</button>` : ""}
      </div>
    </div>

    <section class="board">
      ${Object.entries(CATEGORIES).map(([key, label]) => projectColumn(key, label)).join("")}
    </section>
  `;
}

function projectColumn(category, label) {
  const projects = state.data.projects
    .filter(project => project.category === category)
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));

  return `
    <div class="column">
      <div class="column-head">
        <h2>${label}</h2>
        <span class="badge">${projects.length}</span>
      </div>
      ${projects.length ? projects.map(projectCard).join("") : `<div class="empty">Zatím zde nejsou žádné projekty.</div>`}
    </div>
  `;
}

function projectCard(project) {
  const review = project.reviews?.[0];
  return `
    <button class="project-card" onclick="App.openProjectDetail('${project.id}')">
      <div class="project-title">${escapeHtml(project.title)}</div>
      <div class="project-desc">${escapeHtml(project.short_description || "Bez krátkého popisu.")}</div>
      <div class="project-footer">
        <span class="badge">${escapeHtml(PRIORITIES[project.priority] || project.priority || "Normální")}</span>
        ${review ? `<span class="badge orange">★ ${review.rating}/5</span>` : ""}
        ${(project.checklist || []).length ? `<span class="badge gray">${project.checklist.filter(i => i.is_done).length}/${project.checklist.length} kroků</span>` : ""}
      </div>
    </button>
  `;
}

function openProjectForm(projectId = null) {
  document.getElementById("modalBackdrop")?.remove();
  state.modal = null;
  const project = projectId ? state.data.projects.find(p => p.id === projectId) : null;
  const title = project ? "Upravit projekt" : "Vytvořit projekt";

  document.body.insertAdjacentHTML("beforeend", `
    <div class="modal-backdrop" id="modalBackdrop" onclick="App.closeModalFromBackdrop(event)">
      <div class="modal">
        <div class="modal-header">
          <div>
            <div class="eyebrow">Projekt</div>
            <h2>${title}</h2>
          </div>
          <button class="close-btn" onclick="App.closeModal()">×</button>
        </div>
        <div class="modal-body">
          <form id="projectForm">
            <input type="hidden" name="id" value="${project ? project.id : ""}">
            <div class="form-grid">
              <div class="form-row">
                <label>Název projektu</label>
                <input name="title" value="${escapeHtml(project?.title || "")}" required>
              </div>
              <div class="form-row">
                <label>Kategorie</label>
                <select name="category">
                  ${Object.entries(CATEGORIES).map(([key, label]) => `<option value="${key}" ${project?.category === key ? "selected" : ""}>${label}</option>`).join("")}
                </select>
              </div>
              <div class="form-row">
                <label>Priorita</label>
                <select name="priority">
                  ${Object.entries(PRIORITIES).map(([key, label]) => `<option value="${key}" ${project?.priority === key ? "selected" : ""}>${label}</option>`).join("")}
                </select>
              </div>
              <div class="form-row">
                <label>Stav</label>
                <input name="status" value="${escapeHtml(project?.status || "Aktivní")}">
              </div>
              <div class="form-row full">
                <label>Krátký popis</label>
                <input name="short_description" value="${escapeHtml(project?.short_description || "")}" required>
              </div>
              <div class="form-row full">
                <label>Delší zadání</label>
                <textarea name="full_description" required>${escapeHtml(project?.full_description || "")}</textarea>
              </div>
            </div>
            <button class="btn primary" type="submit">${project ? "Uložit změny" : "Vytvořit projekt"}</button>
          </form>
        </div>
      </div>
    </div>
  `);
}

function openProjectDetail(projectId) {
  const project = state.data.projects.find(p => p.id === projectId);
  if (!project) return;
  state.modal = { type: "project", projectId };
  const review = project.reviews?.[0];

  document.body.insertAdjacentHTML("beforeend", `
    <div class="modal-backdrop" id="modalBackdrop" onclick="App.closeModalFromBackdrop(event)">
      <div class="modal">
        <div class="modal-header">
          <div>
            <div class="eyebrow">${escapeHtml(CATEGORIES[project.category] || project.category)}</div>
            <h2>${escapeHtml(project.title)}</h2>
            <div class="page-subtitle">Vytvořeno ${formatDateTime(project.created_at)} · Upraveno ${formatDateTime(project.updated_at)}</div>
          </div>
          <button class="close-btn" onclick="App.closeModal()">×</button>
        </div>

        <div class="modal-body">
          <div class="project-footer">
            <span class="badge">${escapeHtml(PRIORITIES[project.priority] || project.priority || "Normální")}</span>
            <span class="badge gray">${escapeHtml(project.status || "Aktivní")}</span>
          </div>

          <div class="card card-pad" style="margin:16px 0">
            <h3>Zadání projektu</h3>
            <p class="note-content">${escapeHtml(project.full_description || project.short_description || "")}</p>
          </div>

          ${isAdmin() ? adminProjectActions(project) : `<div class="success-box">Jsi přihlášená jako manažerka. Projekt můžeš číst a hodnotit, ale nemůžeš měnit zadání ani kategorii.</div>`}

          <div class="card card-pad" style="margin-top:18px">
            <h3>Checklist</h3>
            <div style="margin-top:12px">
              ${(project.checklist || []).length ? project.checklist.map(item => checklistItem(item)).join("") : `<div class="empty">Checklist je zatím prázdný.</div>`}
            </div>
            ${isAdmin() ? `
              <form id="checklistForm" style="margin-top:14px">
                <input type="hidden" name="project_id" value="${project.id}">
                <div class="form-row">
                  <label>Nový bod checklistu</label>
                  <input name="text" placeholder="Např. Připravit návrh, odeslat podklady..." required>
                </div>
                <button class="btn primary" type="submit">Přidat bod</button>
              </form>
            ` : ""}
          </div>

          ${reviewSection(project, review)}
        </div>
      </div>
    </div>
  `);
}

function adminProjectActions(project) {
  return `
    <div class="actions">
      <button class="btn" onclick="App.openProjectForm('${project.id}')">Upravit projekt</button>
      <select onchange="App.moveProject('${project.id}', this.value)" style="max-width:260px">
        ${Object.entries(CATEGORIES).map(([key, label]) => `<option value="${key}" ${project.category === key ? "selected" : ""}>Přesunout: ${label}</option>`).join("")}
      </select>
      <button class="btn danger" onclick="App.deleteProject('${project.id}')">Smazat projekt</button>
    </div>
  `;
}

function checklistItem(item) {
  return `
    <div class="check-item ${item.is_done ? "done" : ""}">
      <input type="checkbox" ${item.is_done ? "checked" : ""} ${isAdmin() ? `onchange="App.toggleChecklist('${item.id}', this.checked)"` : "disabled"}>
      <span>${escapeHtml(item.text)}</span>
      ${isAdmin() ? `<button class="btn danger" style="margin-left:auto" onclick="App.deleteChecklist('${item.id}')">Smazat</button>` : ""}
    </div>
  `;
}

function reviewSection(project, review) {
  const ownReview = review && review.reviewer_user_id === state.user.id ? review : null;
  const rating = ownReview?.rating || review?.rating || 0;
  state.selectedRating = rating;

  if (isManager()) {
    return `
      <div class="review-card" style="margin-top:18px">
        <h3>Zpětná vazba manažerky</h3>
        <form id="reviewForm">
          <input type="hidden" name="project_id" value="${project.id}">
          <input type="hidden" name="rating" id="ratingInput" value="${rating}">
          <label>Hodnocení</label>
          <div class="star-row">
            ${[1,2,3,4,5].map(n => `<button type="button" class="star ${n <= rating ? "active" : ""}" onclick="App.setRating(${n})">★</button>`).join("")}
          </div>
          <div class="form-row">
            <label>Komentář manažerky</label>
            <textarea name="comment" placeholder="Sem napiš krátké hodnocení projektu...">${escapeHtml(ownReview?.comment || "")}</textarea>
          </div>
          <button class="btn primary" type="submit">Uložit hodnocení</button>
        </form>
      </div>
    `;
  }

  return `
    <div class="review-card" style="margin-top:18px">
      <h3>Zpětná vazba manažerky</h3>
      ${review ? `
        <div class="star-row">${[1,2,3,4,5].map(n => `<span class="star ${n <= review.rating ? "active" : ""}">★</span>`).join("")}</div>
        <div class="note-content">${escapeHtml(review.comment || "Bez komentáře.")}</div>
        <div class="page-subtitle">Upraveno ${formatDateTime(review.updated_at)}</div>
      ` : `<div class="empty">Manažerka zatím nepřidala hodnocení.</div>`}
    </div>
  `;
}

async function refreshProjectModal(projectId, toastMessage) {
  await reload(false);
  closeModal();
  openProjectDetail(projectId);
  if (toastMessage) showToast(toastMessage);
}

async function moveProject(projectId, category) {
  const project = state.data.projects.find(p => p.id === projectId);
  if (!project || project.category === category) return;
  await rpc("move_project", { p_token: state.token, p_project_id: projectId, p_category: category });
  await reload(false);
  closeModal();
  showToast(`Projekt byl přesunut do: ${CATEGORIES[category]}.`);
}

async function deleteProject(projectId) {
  const project = state.data.projects.find(p => p.id === projectId);
  if (!project || !confirm(`Opravdu smazat projekt „${project.title}“ včetně checklistu a hodnocení?`)) return;
  await rpc("delete_project", { p_token: state.token, p_project_id: projectId });
  await reload(false);
  closeModal();
  showToast("Projekt byl smazán.");
}

async function toggleChecklist(itemId, checked) {
  const project = state.data.projects.find(p => (p.checklist || []).some(i => i.id === itemId));
  await rpc("update_checklist_item", { p_token: state.token, p_item_id: itemId, p_is_done: checked });
  if (project) await refreshProjectModal(project.id, checked ? "Bod je označený jako hotový." : "Bod je znovu otevřený.");
}

async function deleteChecklist(itemId) {
  const project = state.data.projects.find(p => (p.checklist || []).some(i => i.id === itemId));
  if (!confirm("Opravdu smazat tento bod checklistu?")) return;
  await rpc("delete_checklist_item", { p_token: state.token, p_item_id: itemId });
  if (project) await refreshProjectModal(project.id, "Bod checklistu byl smazán.");
}

function setRating(rating) {
  state.selectedRating = rating;
  document.getElementById("ratingInput").value = rating;
  document.querySelectorAll(".star-row .star").forEach((star, index) => {
    star.classList.toggle("active", index < rating);
  });
}

function renderSettings() {
  const managers = state.data.managerAccounts || [];
  document.getElementById("page").innerHTML = `
    <div class="topbar">
      <div>
        <div class="eyebrow">Nastavení</div>
        <h1 class="page-title">Správa účtů</h1>
        <div class="page-subtitle">Tady může admin vytvářet účty pro manažerku. Každý vytvořený účet uvidí pouze data tohoto admin účtu.</div>
      </div>
    </div>

    <section class="settings-grid">
      <div class="card card-pad">
        <h2>Vytvořit účet manažerky</h2>
        <div data-error></div>
        <form id="managerAccountForm" style="margin-top:16px">
          <div class="form-row">
            <label>Jméno</label>
            <input name="name" placeholder="Např. Manažerka" required>
          </div>
          <div class="form-row">
            <label>Uživatelské jméno</label>
            <input name="username" placeholder="např. managerka1" required>
          </div>
          <div class="form-row">
            <label>Heslo</label>
            <input name="password" type="password" minlength="6" placeholder="Minimálně 6 znaků" required>
          </div>
          <button class="btn primary" type="submit">Vytvořit účet</button>
        </form>
      </div>

      <div class="card card-pad">
        <h2>Vytvořené účty</h2>
        ${managers.length ? managers.map(account => `
          <div class="note-item">
            <h3>${escapeHtml(account.name)}</h3>
            <div class="page-subtitle">Uživatelské jméno: <strong>${escapeHtml(account.username)}</strong></div>
            <span class="badge">Přístup jen k tomuto admin účtu</span>
          </div>
        `).join("") : `<div class="empty">Zatím není vytvořený žádný manažerský účet.</div>`}
      </div>

      <div class="card card-pad">
        <h2>Aktuální admin</h2>
        <p><strong>${escapeHtml(state.user?.name || "")}</strong><br>${escapeHtml(state.user?.username || "")}</p>
      </div>
    </section>
  `;
}

async function logout() {
  try {
    if (state.token) await rpc("logout_user", { p_token: state.token });
  } catch (_) {}
  localStorage.removeItem("work_session_token");
  state.token = "";
  state.user = null;
  state.data = { notes: [], projects: [], managerAccounts: [] };
  state.hasAdmin = null;
  renderLogin();
}

function setView(view) {
  if (view === "settings" && !isAdmin()) return;
  state.view = view;
  renderApp();
}

function changeMonth(delta) {
  state.month = new Date(state.month.getFullYear(), state.month.getMonth() + delta, 1);
  renderCalendar();
}

window.App = {
  setView,
  changeMonth,
  openDay,
  closeModal,
  closeModalFromBackdrop,
  editNote,
  deleteNote,
  openDocument,
  deleteDocument,
  exportNotes,
  openProjectForm,
  openProjectDetail,
  moveProject,
  deleteProject,
  toggleChecklist,
  deleteChecklist,
  setRating,
  reload,
  logout
};

init();
