// ===== Auth Elements =====
const loginGate = document.querySelector("#loginGate");
const topbar = document.querySelector("#topbar");
const mainShell = document.querySelector("#mainShell");
const topbarUser = document.querySelector("#topbarUser");
const topbarAvatar = document.querySelector("#topbarAvatar");
const topbarName = document.querySelector("#topbarName");
const logoutBtn = document.querySelector("#logoutBtn");

// ===== App Elements =====
const form = document.querySelector("#createForm");
const submitBtn = document.querySelector("#submitBtn");
const formError = document.querySelector("#formError");
const configBadge = document.querySelector("#configBadge");
const cacheBadge = document.querySelector("#cacheBadge");
const keyField = document.querySelector("[data-key-field]");
const projectSelect = document.querySelector("#projectSelect");
const groupSelect = document.querySelector("#groupSelect");
const domainSelect = document.querySelector("#domainSelect");
const refreshGroupsBtn = document.querySelector("#refreshGroupsBtn");
const refreshDomainsBtn = document.querySelector("#refreshDomainsBtn");
const openCreateGroupBtn = document.querySelector("#openCreateGroupBtn");
const moreOptions = document.querySelector("#moreOptions");

const linkOutput = document.querySelector("#linkOutput");
const statusOutput = document.querySelector("#statusOutput");
const metaOutput = document.querySelector("#metaOutput");
const jsonOutput = document.querySelector("#jsonOutput");
const copyLinkBtn = document.querySelector("#copyLinkBtn");
const openLinkBtn = document.querySelector("#openLinkBtn");
const showQrBtn = document.querySelector("#showQrBtn");
const resolveRedirectBtn = document.querySelector("#resolveRedirectBtn");
const resolveOutput = document.querySelector("#resolveOutput");
const resolveMetaOutput = document.querySelector("#resolveMetaOutput");

const statTotalLinks = document.querySelector("#statTotalLinks");
const statRedirectTests = document.querySelector("#statRedirectTests");
const statQrCount = document.querySelector("#statQrCount");
const statResolvedCount = document.querySelector("#statResolvedCount");

const historyCount = document.querySelector("#historyCount");
const historySearchInput = document.querySelector("#historySearchInput");
const historyGroupFilter = document.querySelector("#historyGroupFilter");
const historyStatusFilter = document.querySelector("#historyStatusFilter");
const exportHistoryBtn = document.querySelector("#exportHistoryBtn");
const clearHistoryBtn = document.querySelector("#clearHistoryBtn");
const historyTableBody = document.querySelector("#historyTableBody");
const historyEmptyHint = document.querySelector("#historyEmptyHint");

const groupModal = document.querySelector("#groupModal");
const groupModalForm = document.querySelector("#groupModalForm");
const groupModalProjectInfo = document.querySelector("#groupModalProjectInfo");
const newGroupNameInput = document.querySelector("#newGroupName");
const groupModalError = document.querySelector("#groupModalError");
const groupModalStatus = document.querySelector("#groupModalStatus");
const closeGroupModalBtn = document.querySelector("#closeGroupModalBtn");
const cancelGroupModalBtn = document.querySelector("#cancelGroupModalBtn");
const createGroupBtn = document.querySelector("#createGroupBtn");

const qrModal = document.querySelector("#qrModal");
const qrModalTitle = document.querySelector("#qrModalTitle");
const qrModalImage = document.querySelector("#qrModalImage");
const qrModalPlaceholder = document.querySelector("#qrModalPlaceholder");
const qrModalText = document.querySelector("#qrModalText");
const qrModalError = document.querySelector("#qrModalError");
const closeQrModalBtn = document.querySelector("#closeQrModalBtn");
const cancelQrModalBtn = document.querySelector("#cancelQrModalBtn");
const downloadQrBtn = document.querySelector("#downloadQrBtn");

const webhookCallbackUrlInput = document.querySelector("#webhookCallbackUrl");

const LS_KEYS = {
  webhookCallbackUrl: "shorturl:webhook_callback_url",
  history: "shorturl:history:v1",
  migrated: "shorturl:history_migrated",
};
const DEFAULT_PROJECT_NAME = "我的项目";
const MAX_HISTORY_ITEMS = 500;

const state = {
  config: null,
  serverHasApiKey: false,
  latestLinkUrl: "",
  projects: [],
  groups: [],
  domains: [],
  inflight: {
    projects: null,
    groups: null,
    domains: null,
  },
  lastFetchTick: {
    projects: 0,
    groups: 0,
    domains: 0,
  },
  historyItems: [],
  currentUser: null,
  qrModal: {
    sourceUrl: "",
    dataUrl: "",
  },
  filters: {
    search: "",
    group: "",
    status: "all",
  },
};

function $(name) {
  return form.elements[name];
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function setInlineError(message = "", suggestion = null) {
  const input = document.getElementById("targetUrlInput");
  if (!message) {
    formError.hidden = true;
    formError.innerHTML = "";
    input.classList.remove("has-error");
    return;
  }
  input.classList.add("has-error");
  formError.hidden = false;
  if (suggestion) {
    formError.innerHTML =
      `<span class="error-text">${escapeHtml(message)}</span><button type="button" class="error-suggestion-btn" data-url="${escapeHtml(suggestion)}">使用 ${escapeHtml(suggestion)}</button>`;
    formError.querySelector(".error-suggestion-btn").addEventListener("click", (e) => {
      e.preventDefault();
      input.value = e.currentTarget.dataset.url;
      setInlineError("");
      input.focus();
    });
  } else {
    formError.innerHTML = `<span class="error-text">${escapeHtml(message)}</span>`;
  }
}

function setGroupModalError(message = "") {
  if (!message) {
    groupModalError.hidden = true;
    groupModalError.textContent = "";
    return;
  }
  groupModalError.hidden = false;
  groupModalError.textContent = message;
}

function setStatus(text, kind = "") {
  statusOutput.textContent = text;
  statusOutput.className = `status-output${kind ? ` ${kind}` : ""}`;
  statusOutput.hidden = !text;
}

function setMetaText(text = "") {
  metaOutput.textContent = text;
  metaOutput.hidden = !text;
}

function setGroupModalStatus(text, kind = "") {
  groupModalStatus.textContent = text;
  groupModalStatus.className = `status-output${kind ? ` ${kind}` : ""}`;
}

function setJsonOutput(data) {
  jsonOutput.textContent = JSON.stringify(data ?? {}, null, 2);
}

function setLinkResult(url) {
  const resultLinkRow = document.querySelector("#resultLinkRow");
  state.latestLinkUrl = url || "";
  if (!state.latestLinkUrl) {
    if (resultLinkRow) resultLinkRow.hidden = true;
    linkOutput.className = "link-output empty";
    linkOutput.textContent = "尚未创建";
    openLinkBtn.href = "#";
    return;
  }

  if (resultLinkRow) resultLinkRow.hidden = false;
  linkOutput.className = "link-output";
  linkOutput.innerHTML = `<a href="${escapeHtml(state.latestLinkUrl)}" target="_blank" rel="noreferrer">${escapeHtml(state.latestLinkUrl)}</a>`;
  openLinkBtn.href = buildRedirectProxyUrl(state.latestLinkUrl);
}

function setBadge(el, text, kind = "") {
  el.textContent = text;
  el.className = `badge${kind ? ` ${kind}` : ""}`;
}

function getCurrentApiKey() {
  if (state.serverHasApiKey) return "";
  return normalizeText($("apikey").value);
}

function getApiKeyRequestPart() {
  const apikey = getCurrentApiKey();
  return apikey ? { apikey } : {};
}

function buildRedirectProxyUrl(url) {
  const text = normalizeText(url);
  return text ? `/go?url=${encodeURIComponent(text)}` : "#";
}

function formatDateTime(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function setResolveText(text, kind = "") {
  if (!resolveOutput) return;
  resolveOutput.textContent = text;
  resolveOutput.className = `status-output${kind ? ` ${kind}` : ""}`;
  resolveOutput.hidden = !text;
}

function setResolveMetaText(text = "") {
  if (!resolveMetaOutput) return;
  resolveMetaOutput.textContent = text;
  resolveMetaOutput.hidden = !text;
}

function safeLocalStorageGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeLocalStorageSet(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function extractGroupNameFromLabel(label) {
  const text = normalizeText(label);
  if (!text) return "";
  const idx = text.indexOf(" (");
  return idx > 0 ? text.slice(0, idx) : text;
}

// ===== Server History =====
function normalizeServerHistoryItem(raw) {
  if (!raw || typeof raw !== "object") return null;
  const linkUrl = normalizeText(raw.link_url);
  const targetUrl = normalizeText(raw.target_url);
  if (!linkUrl || !targetUrl) return null;
  return {
    id: raw.id,
    linkUrl,
    targetUrl,
    name: normalizeText(raw.name),
    domain: normalizeText(raw.domain),
    groupId: normalizeText(raw.group_id),
    groupName: normalizeText(raw.group_name),
    createdAt: normalizeText(raw.created_at),
  };
}

async function loadServerHistory() {
  try {
    const res = await fetch("/api/history");
    const data = await res.json();
    if (!data.ok || !Array.isArray(data.items)) return;
    state.historyItems = data.items.map(normalizeServerHistoryItem).filter(Boolean);
    renderDashboardHistory();
  } catch {
    // Silently fail
  }
}

async function deleteServerHistoryItem(id) {
  try {
    await fetch(`/api/history/${id}`, { method: "DELETE" });
  } catch {
    // ignore
  }
}

async function clearServerHistory() {
  try {
    await fetch("/api/history", { method: "DELETE" });
  } catch {
    // ignore
  }
}

async function migrateLocalStorageHistory() {
  const migrated = safeLocalStorageGet(LS_KEYS.migrated);
  if (migrated) return;

  const raw = safeLocalStorageGet(LS_KEYS.history);
  if (!raw) {
    safeLocalStorageSet(LS_KEYS.migrated, "1");
    return;
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      safeLocalStorageSet(LS_KEYS.migrated, "1");
      return;
    }

    const res = await fetch("/api/history/migrate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: parsed }),
    });
    const data = await res.json();
    if (data.ok) {
      safeLocalStorageSet(LS_KEYS.migrated, "1");
      console.log(`Migrated ${data.migrated} history items to server.`);
      await loadServerHistory();
    }
  } catch (err) {
    console.error("History migration failed:", err);
  }
}

function getHistoryStats() {
  return {
    total: state.historyItems.length,
    redirectTests: 0,
    qrCount: 0,
    resolvedCount: 0,
  };
}

function renderDashboardStats() {
  const stats = getHistoryStats();
  if (statTotalLinks) statTotalLinks.textContent = String(stats.total);
  if (statRedirectTests) statRedirectTests.textContent = String(stats.redirectTests);
  if (statQrCount) statQrCount.textContent = String(stats.qrCount);
  if (statResolvedCount) statResolvedCount.textContent = String(stats.resolvedCount);
  if (historyCount) historyCount.textContent = `(${stats.total})`;
}

function getFilteredHistoryItems() {
  const search = normalizeText(state.filters.search).toLowerCase();
  const group = normalizeText(state.filters.group);
  const status = normalizeText(state.filters.status) || "all";

  return state.historyItems.filter((item) => {
    if (group && item.groupId !== group) return false;
    if (!search) return true;
    const haystack = [
      item.linkUrl,
      item.targetUrl,
      item.name,
      item.groupName,
      item.groupId,
    ]
      .filter(Boolean)
      .join("\n")
      .toLowerCase();
    return haystack.includes(search);
  });
}

function renderHistoryGroupFilterOptions() {
  if (!historyGroupFilter) return;
  const previous = historyGroupFilter.value;
  const groups = new Map();
  for (const item of state.historyItems) {
    if (!item.groupId) continue;
    if (!groups.has(item.groupId)) {
      groups.set(item.groupId, item.groupName || item.groupId);
    }
  }

  historyGroupFilter.innerHTML = `<option value="">全部分组</option>`;
  for (const [groupId, groupName] of groups.entries()) {
    const opt = document.createElement("option");
    opt.value = groupId;
    opt.textContent = groupName || groupId;
    historyGroupFilter.appendChild(opt);
  }
  if ([...historyGroupFilter.options].some((opt) => opt.value === previous)) {
    historyGroupFilter.value = previous;
  }
}

function renderHistoryTable() {
  if (!historyTableBody) return;
  const items = getFilteredHistoryItems();
  historyTableBody.innerHTML = "";

  if (historyEmptyHint) {
    historyEmptyHint.hidden = items.length > 0;
  }

  if (items.length === 0) return;

  const rowsHtml = items
    .map((item) => {
      const createdAtText = formatDateTime(item.createdAt);
      return `
        <tr class="history-row" data-id="${escapeHtml(item.id)}">
          <td class="col-short">
            <a class="table-link" href="${escapeHtml(buildRedirectProxyUrl(item.linkUrl))}" target="_blank" rel="noreferrer">${escapeHtml(item.linkUrl)}</a>
          </td>
          <td class="col-target">
            <div class="table-subtext" title="${escapeHtml(item.targetUrl)}">→ ${escapeHtml(item.targetUrl)}</div>
          </td>
          <td class="col-group">
            <div>${escapeHtml(item.groupName || "未记录")}</div>
            <div class="table-subtext">${escapeHtml(item.groupId || "-")}</div>
          </td>
          <td class="col-clicks">
            <div class="table-subtext">${createdAtText || "-"}</div>
          </td>
          <td class="col-status"><span class="table-pill success">可用</span></td>
          <td class="col-actions">
            <div class="table-actions">
              <button type="button" class="action-btn" data-action="copy" data-id="${escapeHtml(item.id)}">复制</button>
              <button type="button" class="action-btn" data-action="qr" data-id="${escapeHtml(item.id)}">二维码</button>
              <button type="button" class="action-btn danger" data-action="delete" data-id="${escapeHtml(item.id)}">删除</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");

  historyTableBody.innerHTML = rowsHtml;
}

function renderDashboardHistory() {
  renderDashboardStats();
  renderHistoryGroupFilterOptions();
  renderHistoryTable();
}

function findHistoryItemById(id) {
  return state.historyItems.find((item) => String(item.id) === String(id)) || null;
}

function exportHistoryAsJson() {
  const blob = new Blob([JSON.stringify(state.historyItems, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `shortlinks-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function renderQrModalState({ loading = false, error = "", dataUrl = "", text = "" } = {}) {
  if (!qrModal) return;
  if (qrModalError) {
    qrModalError.hidden = !error;
    qrModalError.textContent = error || "";
  }

  const hasData = Boolean(dataUrl);
  state.qrModal.dataUrl = dataUrl || state.qrModal.dataUrl || "";
  state.qrModal.sourceUrl = text || state.qrModal.sourceUrl || "";

  if (qrModalImage) {
    qrModalImage.hidden = !hasData;
    if (hasData) qrModalImage.src = dataUrl;
  }
  if (qrModalPlaceholder) {
    qrModalPlaceholder.hidden = hasData;
    qrModalPlaceholder.textContent = loading
      ? "正在生成二维码..."
      : error
      ? "二维码生成失败"
      : "暂无二维码";
  }
  if (qrModalText) {
    if (text) {
      qrModalText.className = "link-output";
      qrModalText.textContent = text;
    } else if (!hasData) {
      qrModalText.className = "link-output empty";
      qrModalText.textContent = "尚未生成";
    }
  }

  const disabled = loading || !hasData;
  const copyQrImageBtn = document.querySelector("#copyQrImageBtn");
  if (copyQrImageBtn) copyQrImageBtn.disabled = disabled;
  if (downloadQrBtn) downloadQrBtn.disabled = disabled;
  const copyQrLinkBtn = document.querySelector("#copyQrLinkBtn");
  if (copyQrLinkBtn) copyQrLinkBtn.hidden = !text && !hasData;
}

function openDialog(dialogEl) {
  if (!dialogEl) return;
  if (typeof dialogEl.showModal === "function") {
    dialogEl.showModal();
  } else {
    dialogEl.setAttribute("open", "");
  }
}

function closeDialog(dialogEl) {
  if (!dialogEl) return;
  if (typeof dialogEl.close === "function") {
    dialogEl.close();
  } else {
    dialogEl.removeAttribute("open");
  }
}

async function postJSON(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

async function generateQrForUrl(url, historyId = "") {
  const sourceUrl = normalizeText(url);
  if (!sourceUrl) return;

  if (qrModalTitle) {
    qrModalTitle.textContent = "短链二维码";
  }

  state.qrModal = { sourceUrl, dataUrl: "" };
  renderQrModalState({ loading: true, text: sourceUrl });
  openDialog(qrModal);

  try {
    const { res, data } = await postJSON("/api/tools/qrcode", { text: sourceUrl });
    if (!res.ok || data?.code !== 0) {
      throw new Error(data?.message || "二维码生成失败");
    }
    const dataUrl = normalizeText(data?.data?.data_url);
    renderQrModalState({ loading: false, text: sourceUrl, dataUrl });
  } catch (error) {
    renderQrModalState({
      loading: false,
      error: `二维码生成失败：${String(error.message || error)}`,
      text: sourceUrl,
    });
    setStatus("二维码生成失败", "error");
  }
}

async function resolveRedirectForUrl(url, historyId = "") {
  const sourceUrl = normalizeText(url);
  if (!sourceUrl) return;
  setResolveText("正在追踪跳转路径...", "pending");
  setResolveMetaText("");

  try {
    const { res, data } = await postJSON("/api/tools/resolve-redirect", { url: sourceUrl });
    if (!res.ok || data?.code !== 0) {
      throw new Error(data?.message || "跳转路径查询失败");
    }

    const finalUrl = normalizeText(data?.data?.final_url);
    const redirected = Boolean(data?.data?.redirected);
    const steps = Array.isArray(data?.data?.steps) ? data.data.steps : [];
    const stepText = steps
      .map((step) => `${step.status}${step.location ? ` → ${step.location}` : ""}`)
      .join(" | ");

    if (redirected && finalUrl) {
      setResolveText(`最终跳转到：${finalUrl}`, "success");
    } else {
      setResolveText("该链接没有跳转（可能直接打开了目标页面）", "pending");
    }
    setResolveMetaText(stepText || "未获取到跳转路径信息");
  } catch (error) {
    setResolveText(`查询失败：${String(error.message || error)}`, "error");
    setResolveMetaText("请检查短链是否可访问，或稍后重试。");
  }
}

async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const ta = document.createElement("textarea");
  ta.value = value;
  ta.style.cssText = "position:fixed;opacity:0;left:-9999px";
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  ta.remove();
}

async function handleHistoryAction(event) {
  const button = event.target.closest("[data-action][data-id]");
  if (!button) return;
  const action = button.dataset.action;
  const id = button.dataset.id;
  const item = findHistoryItemById(id);
  if (!item) return;

  if (action === "delete") {
    await deleteServerHistoryItem(id);
    state.historyItems = state.historyItems.filter((it) => String(it.id) !== String(id));
    renderDashboardHistory();
    setStatus("已删除短链记录", "success");
    return;
  }

  if (action === "copy") {
    try {
      await copyText(item.linkUrl);
      setStatus("短链已复制到剪贴板", "success");
    } catch {
      setStatus("复制失败，请手动复制", "error");
    }
    return;
  }

  if (action === "qr") {
    generateQrForUrl(item.linkUrl, id);
    return;
  }

  if (action === "redirect") {
    const redirectUrl = buildRedirectProxyUrl(item.linkUrl);
    window.open(redirectUrl, "_blank", "noopener,noreferrer");
    setStatus("已打开跳转测试窗口", "success");
    return;
  }

  if (action === "resolve") {
    resolveRedirectForUrl(item.linkUrl, id);
  }
}

function bindDashboardEvents() {
  if (historySearchInput) {
    let searchTimer;
    historySearchInput.addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        state.filters.search = historySearchInput.value;
        renderHistoryTable();
      }, 200);
    });
  }
  if (historyGroupFilter) {
    historyGroupFilter.addEventListener("change", () => {
      state.filters.group = historyGroupFilter.value;
      renderHistoryTable();
    });
  }
  if (historyStatusFilter) {
    historyStatusFilter.addEventListener("change", () => {
      state.filters.status = historyStatusFilter.value || "all";
      renderHistoryTable();
    });
  }
  if (historyTableBody) {
    historyTableBody.addEventListener("click", handleHistoryAction);
  }
  if (exportHistoryBtn) {
    exportHistoryBtn.addEventListener("click", () => {
      if (state.historyItems.length === 0) {
        setStatus("暂无可导出的短链记录", "pending");
        return;
      }
      exportHistoryAsJson();
      setStatus("已导出短链记录", "success");
    });
  }
  if (clearHistoryBtn) {
    clearHistoryBtn.addEventListener("click", async () => {
      if (state.historyItems.length === 0) return;
      const confirmed = window.confirm("确认清空所有短链历史记录吗？此操作不可恢复。");
      if (!confirmed) return;
      await clearServerHistory();
      state.historyItems = [];
      renderDashboardHistory();
      setStatus("已清空短链历史记录", "success");
    });
  }

  if (showQrBtn) {
    showQrBtn.addEventListener("click", () => {
      if (!state.latestLinkUrl) return;
      const item = state.historyItems.find((it) => it.linkUrl === state.latestLinkUrl);
      generateQrForUrl(state.latestLinkUrl, item?.id || "");
    });
  }
  if (resolveRedirectBtn) {
    resolveRedirectBtn.addEventListener("click", () => {
      if (!state.latestLinkUrl) return;
      const item = state.historyItems.find((it) => it.linkUrl === state.latestLinkUrl);
      resolveRedirectForUrl(state.latestLinkUrl, item?.id || "");
    });
  }

  if (closeQrModalBtn) closeQrModalBtn.addEventListener("click", () => closeDialog(qrModal));
  if (cancelQrModalBtn) cancelQrModalBtn.addEventListener("click", () => closeDialog(qrModal));
  if (qrModal) {
    qrModal.addEventListener("cancel", (event) => {
      event.preventDefault();
      closeDialog(qrModal);
    });
    qrModal.addEventListener("click", (event) => {
      if (event.target === qrModal) closeDialog(qrModal);
    });
  }

  const copyQrImageBtn = document.querySelector("#copyQrImageBtn");
  if (copyQrImageBtn) {
    copyQrImageBtn.addEventListener("click", async () => {
      if (!state.qrModal.dataUrl) return;
      try {
        const res = await fetch(state.qrModal.dataUrl);
        const blob = await res.blob();
        await navigator.clipboard.write([
          new ClipboardItem({ "image/png": blob }),
        ]);
        copyQrImageBtn.textContent = "已复制";
        setTimeout(() => { copyQrImageBtn.textContent = "复制二维码"; }, 1500);
      } catch {
        setStatus("复制失败，请长按图片保存", "error");
      }
    });
  }

  if (downloadQrBtn) {
    downloadQrBtn.addEventListener("click", () => {
      if (!state.qrModal.dataUrl) return;
      const a = document.createElement("a");
      a.href = state.qrModal.dataUrl;
      a.download = `shortlink-qrcode-${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    });
  }

  const copyQrLinkBtn = document.querySelector("#copyQrLinkBtn");
  if (copyQrLinkBtn) {
    copyQrLinkBtn.addEventListener("click", async () => {
      if (!state.qrModal.sourceUrl) return;
      try {
        await copyText(state.qrModal.sourceUrl);
        copyQrLinkBtn.textContent = "已复制";
        setTimeout(() => { copyQrLinkBtn.textContent = "复制"; }, 1500);
      } catch {
        setStatus("复制失败", "error");
      }
    });
  }
}

function initDashboardState() {
  state.historyItems = [];
  state.filters.search = "";
  state.filters.group = "";
  state.filters.status = historyStatusFilter?.value || "all";
  renderDashboardHistory();
  setResolveText("");
  setResolveMetaText("");
  renderQrModalState({ loading: false, text: "", dataUrl: "" });
}

function populateSelect(select, options, {
  placeholder = "请选择",
  keepCurrent = true,
  getValue = (item) => item.value,
  getLabel = (item) => item.label,
} = {}) {
  const previous = keepCurrent ? select.value : "";
  const frag = document.createDocumentFragment();
  const ph = document.createElement("option");
  ph.value = "";
  ph.textContent = placeholder;
  frag.appendChild(ph);

  for (const item of options) {
    const opt = document.createElement("option");
    opt.value = String(getValue(item));
    opt.textContent = String(getLabel(item));
    frag.appendChild(opt);
  }

  select.innerHTML = "";
  select.appendChild(frag);
  if (previous && options.some((item) => String(getValue(item)) === previous)) {
    select.value = previous;
  }
}

function setProjectsLoading(loading) {
  projectSelect.disabled = loading;
  if (loading) {
    projectSelect.innerHTML = `<option value="">加载项目中...</option>`;
  }
}

function setGroupsLoading(loading, message = "加载分组中...") {
  groupSelect.disabled = loading || !projectSelect.value;
  refreshGroupsBtn.disabled = loading || !projectSelect.value;
  openCreateGroupBtn.disabled = loading || !projectSelect.value;
  if (loading) {
    groupSelect.innerHTML = `<option value="">${message}</option>`;
  }
}

function setDomainsLoading(loading) {
  domainSelect.disabled = loading;
  refreshDomainsBtn.disabled = loading;
  if (loading) {
    domainSelect.innerHTML = `<option value="">加载域名中...</option>`;
  }
}

function requireApiKeyForMeta() {
  if (state.serverHasApiKey) return "";
  const apikey = getCurrentApiKey();
  if (!apikey) {
    return "请先填写 apikey（或在服务端配置 XIAOMARK_API_KEY）再加载项目/分组/自有域名。";
  }
  return "";
}

function pickDefaultProject(projects) {
  if (!Array.isArray(projects) || projects.length === 0) return null;
  return (
    projects.find((item) => normalizeText(item?.name) === DEFAULT_PROJECT_NAME) ||
    projects[0] ||
    null
  );
}

async function loadProjects({ forceUi = false, background = false } = {}) {
  if (state.inflight.projects) return state.inflight.projects;
  const keyErr = requireApiKeyForMeta();
  if (keyErr) {
    setInlineError(keyErr);
    return;
  }

  const now = Date.now();
  if (!forceUi && now - state.lastFetchTick.projects < 300) return;
  state.lastFetchTick.projects = now;

  if (!background) {
    setProjectsLoading(true);
  }
  setInlineError("");

  state.inflight.projects = (async () => {
    try {
      const { res, data } = await postJSON("/api/meta/projects", getApiKeyRequestPart());
      if (!res.ok || data?.code !== 0) {
        throw new Error(data?.message || "项目列表加载失败");
      }
      const projects = Array.isArray(data?.data?.projects) ? data.data.projects : [];
      state.projects = projects;
      populateSelect(projectSelect, projects, {
        placeholder: projects.length ? "默认项目" : "暂无项目",
        getValue: (item) => item.id,
        getLabel: (item) => `${item.name} (${item.id})`,
      });

      const defaultProject = pickDefaultProject(projects);
      if (defaultProject) {
        projectSelect.value = defaultProject.id;
      }

      refreshGroupsBtn.disabled = !projectSelect.value;
      openCreateGroupBtn.disabled = !projectSelect.value;
      if (projectSelect.value) {
        await loadGroups({ background });
      } else {
        state.groups = [];
        populateSelect(groupSelect, [], { placeholder: "未找到可用项目" });
        groupSelect.disabled = true;
        setMetaText("未找到可用项目，请先在小码后台创建项目。");
      }
    } catch (error) {
      setInlineError(`加载项目失败：${String(error.message || error)}`);
      setMetaText("项目列表加载失败");
      if (!background) {
        state.projects = [];
        populateSelect(projectSelect, [], { placeholder: "加载项目失败" });
        projectSelect.disabled = false;
      }
    } finally {
      if (!background) {
        setProjectsLoading(false);
      } else {
        projectSelect.disabled = false;
      }
      state.inflight.projects = null;
    }
  })();

  return state.inflight.projects;
}

async function loadGroups({ forceUi = false, background = false } = {}) {
  if (state.inflight.groups) return state.inflight.groups;
  const keyErr = requireApiKeyForMeta();
  if (keyErr) {
    setInlineError(keyErr);
    return;
  }
  const projectId = normalizeText(projectSelect.value);
  if (!projectId) {
    populateSelect(groupSelect, [], { placeholder: "默认项目未加载" });
    groupSelect.disabled = true;
    refreshGroupsBtn.disabled = true;
    openCreateGroupBtn.disabled = true;
    return;
  }

  const now = Date.now();
  if (!forceUi && now - state.lastFetchTick.groups < 300) return;
  state.lastFetchTick.groups = now;

  if (!background) {
    setGroupsLoading(true);
  }
  setInlineError("");

  state.inflight.groups = (async () => {
    try {
      const { res, data } = await postJSON("/api/meta/groups", {
        ...getApiKeyRequestPart(),
        project_id: projectId,
      });
      if (!res.ok || data?.code !== 0) {
        throw new Error(data?.message || "分组列表加载失败");
      }

      const groups = Array.isArray(data?.data?.groups) ? data.data.groups : [];
      state.groups = groups;
      populateSelect(groupSelect, groups, {
        placeholder: groups.length ? "请选择分组" : "暂无分组（可点击新建）",
        getValue: (item) => item.id,
        getLabel: (item) => `${item.name} (${item.id}) · ${item.total_links ?? 0} 条`,
      });

      if (!groupSelect.value && groups.length >= 1) {
        groupSelect.value = groups[0].id;
      }
    } catch (error) {
      setInlineError(`加载分组失败：${String(error.message || error)}`);
      setMetaText("分组列表加载失败");
      if (!background) {
        state.groups = [];
        populateSelect(groupSelect, [], { placeholder: "加载分组失败" });
      }
    } finally {
      if (!background) {
        setGroupsLoading(false, "加载分组中...");
      }
      groupSelect.disabled = !projectId;
      refreshGroupsBtn.disabled = !projectId;
      openCreateGroupBtn.disabled = !projectId;
      state.inflight.groups = null;
    }
  })();

  return state.inflight.groups;
}

async function loadDomains({ forceUi = false, background = false } = {}) {
  if (state.inflight.domains) return state.inflight.domains;
  const keyErr = requireApiKeyForMeta();
  if (keyErr) {
    setInlineError(keyErr);
    return;
  }

  const now = Date.now();
  if (!forceUi && now - state.lastFetchTick.domains < 300) return;
  state.lastFetchTick.domains = now;

  if (!background) {
    setDomainsLoading(true);
  }
  setInlineError("");

  state.inflight.domains = (async () => {
    try {
      const currentValue = domainSelect.value;
      const { res, data } = await postJSON("/api/meta/private-domains", getApiKeyRequestPart());
      if (!res.ok || data?.code !== 0) {
        throw new Error(data?.message || "自有域名列表加载失败");
      }

      const domains = Array.isArray(data?.data?.private_domains)
        ? data.data.private_domains
        : [];
      state.domains = domains;
      populateSelect(domainSelect, domains, {
        placeholder: "默认域名（不指定，使用小码默认）",
        getValue: (item) => item.domain,
        getLabel: (item) => `${item.domain}${item.ssl_enabled ? " · HTTPS" : " · HTTP"}`,
      });
      if (currentValue) domainSelect.value = currentValue;
    } catch (error) {
      setInlineError(`加载自有域名失败：${String(error.message || error)}`);
      setMetaText("自有域名列表加载失败");
      if (!background) {
        state.domains = [];
        populateSelect(domainSelect, [], { placeholder: "加载域名失败" });
      }
    } finally {
      if (!background) {
        setDomainsLoading(false);
      } else {
        domainSelect.disabled = false;
        refreshDomainsBtn.disabled = false;
      }
      state.inflight.domains = null;
    }
  })();

  return state.inflight.domains;
}

function syncMutualExclusionHints() {
  const wechat = $("escape_from_wechat").checked;
  const bot = $("advanced_bot_detection").checked;
  if (wechat && bot) {
    setInlineError("根据小码文档，微信内强制浏览器打开 与 深度过滤机器访问 不能同时开启。");
    openSettingsModal();
  } else if (
    formError.textContent.includes("微信内强制浏览器打开 与 深度过滤机器访问")
  ) {
    setInlineError("");
  }
}

function collectPayload() {
  const fd = new FormData(form);
  const get = (key) => normalizeText(fd.get(key));

  // Get group name for server-side history
  const groupLabel = groupSelect?.selectedOptions?.[0]?.textContent || "";
  const groupName = extractGroupNameFromLabel(groupLabel);

  const payload = {
    apikey: get("apikey"),
    project_id: get("project_id"),
    group_id: get("group_id"),
    target_url: get("target_url"),
    name: get("name"),
    domain: get("domain"),
    key: get("key"),
    key_length: get("key_length"),
    webhook_callback_url: get("webhook_callback_url"),
    webhook_scene: get("webhook_scene"),
    escape_from_wechat: fd.get("escape_from_wechat") === "on",
    advanced_bot_detection: fd.get("advanced_bot_detection") === "on",
    webhook: fd.get("webhook") === "on",
    _group_name: groupName,
  };

  for (const key of [
    "apikey",
    "project_id",
    "name",
    "domain",
    "key",
    "key_length",
    "webhook_callback_url",
    "webhook_scene",
  ]) {
    if (!payload[key]) delete payload[key];
  }
  return payload;
}

function validatePayload(payload) {
  if (!state.serverHasApiKey && !payload.apikey) {
    return "请填写 apikey，或在服务端配置 XIAOMARK_API_KEY。";
  }
  if (!payload.project_id) {
    return "默认项目尚未加载成功，请稍后重试。";
  }
  if (!payload.group_id) {
    return "请先选择分组。";
  }
  if (!payload.target_url) {
    return "请填写 target_url（目标链接）。";
  }

  let url;
  try {
    url = new URL(payload.target_url);
  } catch {
    const raw = payload.target_url.trim();
    if (raw.includes(".") && !raw.includes(" ") && !/^(\w+):\/\//.test(raw)) {
      const suggested = "https://" + raw;
      try {
        new URL(suggested);
        return { message: "请输入完整链接，例如 ", suggestion: suggested };
      } catch {
        // fall through
      }
    }
    return "target_url 不是有效链接。";
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    return "target_url 必须以 http:// 或 https:// 开头。";
  }

  if (payload.escape_from_wechat && payload.advanced_bot_detection) {
    return "微信内强制浏览器打开 与 深度过滤机器访问 不能同时开启。";
  }
  if (payload.key && !/^[A-Za-z0-9_-]{1,32}$/.test(payload.key)) {
    return "自定义后缀 key 只能包含字母、数字、下划线、连字符，且不超过 32 位。";
  }
  if (payload.key_length !== undefined) {
    const n = Number(payload.key_length);
    if (!Number.isInteger(n) || n < 4 || n > 8) {
      return "随机后缀长度 key_length 必须是 4-8 的整数。";
    }
    payload.key_length = n;
  }

  if (payload.webhook_callback_url) {
    try {
      const webhookUrl = new URL(payload.webhook_callback_url);
      if (!["http:", "https:"].includes(webhookUrl.protocol)) {
        return "Webhook 推送地址仅支持 http/https。";
      }
    } catch {
      return "Webhook 推送地址不是有效 URL。";
    }
  }

  if (!payload.webhook) {
    delete payload.webhook_scene;
  }

  delete payload.project_id;
  return "";
}

async function handleSubmit(event) {
  event.preventDefault();
  setInlineError("");
  setStatus("请求发送中...", "pending");
  setMetaText("");
  setResolveText("");
  setResolveMetaText("");
  submitBtn.disabled = true;

  const payload = collectPayload();
  const validationError = validatePayload(payload);
  if (validationError) {
    const errMsg = typeof validationError === "object" ? validationError.message : validationError;
    const errSuggestion = typeof validationError === "object" ? validationError.suggestion : null;
    setInlineError(errMsg, errSuggestion);
    setStatus("");
    if (errMsg.includes("Webhook") || errMsg.includes("后缀") || errMsg.includes("过滤")) {
      openSettingsModal();
    }
    submitBtn.disabled = false;
    return;
  }

  if (webhookCallbackUrlInput.value.trim()) {
    try {
      localStorage.setItem(LS_KEYS.webhookCallbackUrl, webhookCallbackUrlInput.value.trim());
    } catch {
      // Ignore localStorage failures
    }
  }

  try {
    const { res, data } = await postJSON("/api/shortlinks/create", payload);
    setJsonOutput(data);

    if (!res.ok || data?.code !== 0) {
      setStatus(`失败：${data?.message || "请求失败"}`, "error");
      setLinkResult("");
      setInlineError(data?.message || "创建短链失败");
      return;
    }

    const linkUrl = data?.data?.link_url || "";
    setLinkResult(linkUrl);
    setStatus("短链创建成功", "success");
    setMetaText("");

    // Reload server history to include new item
    if (linkUrl) {
      await loadServerHistory();
    }
  } catch (error) {
    setStatus(`网络错误：${String(error.message || error)}`, "error");
    setInlineError("请求失败，请检查本地服务是否启动，以及服务器网络是否可访问小码 API。");
    setJsonOutput({ error: String(error.message || error) });
    setLinkResult("");
  } finally {
    submitBtn.disabled = false;
  }
}

function handleReset() {
  setInlineError("");
  setStatus("");
  setMetaText("");
  setResolveText("");
  setResolveMetaText("");
  setJsonOutput({});
  setLinkResult("");

  $("advanced_bot_detection").checked = true;
  $("webhook").checked = true;
  $("escape_from_wechat").checked = false;
  $("key_length").value = "4";

  const cachedWebhookUrl = loadStoredWebhookCallbackUrl();
  webhookCallbackUrlInput.value =
    cachedWebhookUrl || state.config?.defaults?.webhookCallbackUrl || "";

  setTimeout(() => {
    if (projectSelect.value) loadGroups();
  }, 0);
}

async function copyLatestLink() {
  if (!state.latestLinkUrl) return;
  try {
    await copyText(state.latestLinkUrl);
    setStatus("短链已复制到剪贴板", "success");
  } catch {
    setStatus("复制失败，请手动复制", "error");
  }
}

function getSelectedProject() {
  const id = projectSelect.value;
  return state.projects.find((item) => item.id === id) || null;
}

function openGroupModal() {
  const project = getSelectedProject();
  if (!project) {
    setInlineError("默认项目尚未加载成功，暂时无法创建分组。");
    return;
  }
  groupModalProjectInfo.textContent = `${project.name} (${project.id})`;
  newGroupNameInput.value = "";
  setGroupModalError("");
  setGroupModalStatus("填写分组名称后提交");
  if (typeof groupModal.showModal === "function") {
    groupModal.showModal();
  } else {
    groupModal.setAttribute("open", "");
  }
  setTimeout(() => newGroupNameInput.focus(), 0);
}

function closeGroupModal() {
  if (typeof groupModal.close === "function") {
    groupModal.close();
  } else {
    groupModal.removeAttribute("open");
  }
}

async function handleCreateGroup(event) {
  event.preventDefault();
  setGroupModalError("");
  setGroupModalStatus("创建中...", "pending");
  createGroupBtn.disabled = true;

  const project = getSelectedProject();
  const name = normalizeText(newGroupNameInput.value);
  if (!project) {
    setGroupModalError("默认项目尚未加载成功。");
    setGroupModalStatus("无法创建分组", "error");
    createGroupBtn.disabled = false;
    return;
  }
  if (!name) {
    setGroupModalError("请输入分组名称。");
    setGroupModalStatus("请输入分组名称", "error");
    createGroupBtn.disabled = false;
    return;
  }
  if (name.length > 64) {
    setGroupModalError("分组名称长度不能超过 64 字符。");
    setGroupModalStatus("分组名称过长", "error");
    createGroupBtn.disabled = false;
    return;
  }

  const keyErr = requireApiKeyForMeta();
  if (keyErr) {
    setGroupModalError(keyErr);
    setGroupModalStatus("缺少 apikey", "error");
    createGroupBtn.disabled = false;
    return;
  }

  try {
    const { res, data } = await postJSON("/api/meta/groups/create", {
      ...getApiKeyRequestPart(),
      project_id: project.id,
      name,
    });
    if (!res.ok || data?.code !== 0) {
      throw new Error(data?.message || "创建分组失败");
    }

    const newGroupId = data?.data?.group_id || "";
    setGroupModalStatus(`创建成功：${newGroupId || name}`, "success");
    await loadGroups({ forceUi: true });
    if (newGroupId) groupSelect.value = newGroupId;
    setStatus("分组创建成功，可继续创建短链", "success");
    setMetaText(`已创建分组 ${name}${newGroupId ? ` (${newGroupId})` : ""}`);
    setTimeout(closeGroupModal, 400);
  } catch (error) {
    setGroupModalError(String(error.message || error));
    setGroupModalStatus("创建分组失败", "error");
  } finally {
    createGroupBtn.disabled = false;
  }
}

function loadStoredWebhookCallbackUrl() {
  try {
    return localStorage.getItem(LS_KEYS.webhookCallbackUrl) || "";
  } catch {
    return "";
  }
}

function applyDefaultsFromConfig(config) {
  const defaults = config?.defaults || {};
  $("key_length").value = String(defaults.keyLength ?? 4);
  $("escape_from_wechat").checked = Boolean(defaults.escapeFromWechat);
  $("advanced_bot_detection").checked = Boolean(defaults.advancedBotDetection ?? true);
  $("webhook").checked = Boolean(defaults.webhookEnabled ?? true);
  if (defaults.webhookScene) $("webhook_scene").value = defaults.webhookScene;

  const localWebhookUrl = loadStoredWebhookCallbackUrl();
  webhookCallbackUrlInput.value = localWebhookUrl || defaults.webhookCallbackUrl || "";
  $("webhook_callback_url").value = defaults.webhookCallbackUrl || "";
}

async function loadConfig() {
  setBadge(configBadge, "检查配置中...");
  setBadge(cacheBadge, "缓存策略加载中...");
  try {
    const res = await fetch("/api/config");
    const config = await res.json();
    state.config = config;
    state.serverHasApiKey = Boolean(config?.apiKeyConfigured);

    if (state.serverHasApiKey) {
      setBadge(configBadge, "服务端已配置 API Key", "ok");
      keyField.hidden = true;
    } else {
      setBadge(configBadge, "服务端未配置 API Key（需在页面填写）", "warn");
      keyField.hidden = false;
    }

    const ttl = Number(config?.cacheTtlMs || 0);
    setBadge(
      cacheBadge,
      ttl > 0 ? `服务端缓存 ${Math.round(ttl / 1000)}s（使用刷新按钮获取最新）` : "无缓存",
      "ok"
    );

    applyDefaultsFromConfig(config);
    setStatus("");

    if (state.serverHasApiKey || getCurrentApiKey()) {
      loadProjects();
      loadDomains();
    }
  } catch (error) {
    setBadge(configBadge, "配置检查失败", "err");
    setBadge(cacheBadge, "缓存策略获取失败", "err");
    keyField.hidden = false;
    setStatus(`配置检查失败：${String(error.message || error)}`, "error");
  }
}

function setupSelectRefreshTriggers() {
  const refreshGroups = () => loadGroups({ forceUi: true });
  const refreshDomains = () => loadDomains({ forceUi: true });
  refreshGroupsBtn.addEventListener("click", refreshGroups);
  refreshDomainsBtn.addEventListener("click", refreshDomains);
}

function wireEvents() {
  form.addEventListener("submit", handleSubmit);
  form.addEventListener("reset", () => setTimeout(handleReset, 0));
  copyLinkBtn.addEventListener("click", copyLatestLink);
  if (openLinkBtn) {
    openLinkBtn.addEventListener("click", () => {
      // No-op for now — redirect tracking removed with server history
    });
  }

  $("escape_from_wechat").addEventListener("change", syncMutualExclusionHints);
  $("advanced_bot_detection").addEventListener("change", syncMutualExclusionHints);

  $("webhook").addEventListener("change", () => {
    if (!$("webhook").checked) {
      $("webhook_scene").value = "";
    }
  });

  openCreateGroupBtn.addEventListener("click", openGroupModal);
  closeGroupModalBtn.addEventListener("click", closeGroupModal);
  cancelGroupModalBtn.addEventListener("click", closeGroupModal);
  groupModalForm.addEventListener("submit", handleCreateGroup);
  groupModal.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeGroupModal();
  });

  $("apikey").addEventListener("change", () => {
    if (state.serverHasApiKey) return;
    state.projects = [];
    state.groups = [];
    state.domains = [];
    populateSelect(projectSelect, [], { placeholder: "默认项目" });
    projectSelect.value = "";
    populateSelect(groupSelect, [], { placeholder: "正在加载默认项目分组..." });
    populateSelect(domainSelect, [], { placeholder: "默认域名（不指定，使用小码默认）" });
    loadProjects({ forceUi: true });
    loadDomains({ forceUi: true });
  });

  setupSelectRefreshTriggers();
  bindDashboardEvents();
}

// ===== Auth Flow =====
function showLoginGate() {
  loginGate.hidden = false;
  topbar.hidden = true;
  mainShell.hidden = true;
}

function showApp(user) {
  loginGate.hidden = true;
  topbar.hidden = false;
  mainShell.hidden = false;

  if (user) {
    state.currentUser = user;
    topbarUser.hidden = false;
    topbarName.textContent = user.name || "";
    if (user.avatarUrl) {
      topbarAvatar.src = user.avatarUrl;
      topbarAvatar.alt = user.name || "";
    } else {
      topbarAvatar.style.display = "none";
    }
  }
}

async function checkSession() {
  try {
    const res = await fetch("/api/auth/session");
    const data = await res.json();
    if (data.ok && data.loggedIn && data.user) {
      showApp(data.user);
      return true;
    }
  } catch {
    // fallthrough
  }
  showLoginGate();
  return false;
}

async function handleLogout() {
  try {
    await fetch("/api/auth/logout", { method: "POST" });
  } catch {
    // ignore
  }
  state.currentUser = null;
  state.historyItems = [];
  showLoginGate();
}

// ===== Settings Modal =====
const settingsModal = document.querySelector("#settingsModal");
const openSettingsBtn = document.querySelector("#openSettingsBtn");
const closeSettingsBtn = document.querySelector("#closeSettingsBtn");
const closeSettingsDoneBtn = document.querySelector("#closeSettingsDoneBtn");

function openSettingsModal() {
  if (settingsModal) settingsModal.showModal();
}

if (openSettingsBtn) openSettingsBtn.addEventListener("click", openSettingsModal);
if (closeSettingsBtn) closeSettingsBtn.addEventListener("click", () => settingsModal.close());
if (closeSettingsDoneBtn) closeSettingsDoneBtn.addEventListener("click", () => settingsModal.close());
if (settingsModal) settingsModal.addEventListener("click", (e) => {
  if (e.target === settingsModal) settingsModal.close();
});

// ===== Logout button =====
if (logoutBtn) logoutBtn.addEventListener("click", handleLogout);

// ===== Init =====
setJsonOutput({});
setLinkResult("");
setStatus("");
setMetaText("");
setResolveText("");
setResolveMetaText("");
populateSelect(projectSelect, [], { placeholder: "默认项目" });
populateSelect(groupSelect, [], { placeholder: "正在加载默认项目分组..." });
populateSelect(domainSelect, [], { placeholder: "默认域名（不指定，使用小码默认）" });
groupSelect.disabled = true;
refreshGroupsBtn.disabled = true;
openCreateGroupBtn.disabled = true;

// Start auth flow
(async () => {
  const loggedIn = await checkSession();
  if (loggedIn) {
    initDashboardState();
    wireEvents();
    loadConfig();
    await migrateLocalStorageHistory();
    await loadServerHistory();
  }
})();
