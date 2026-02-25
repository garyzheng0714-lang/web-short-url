const form = document.querySelector("#createForm");
const submitBtn = document.querySelector("#submitBtn");
const formError = document.querySelector("#formError");
const configBadge = document.querySelector("#configBadge");
const cacheBadge = document.querySelector("#cacheBadge");
const keyField = document.querySelector("[data-key-field]");
const projectSelect = document.querySelector("#projectSelect");
const groupSelect = document.querySelector("#groupSelect");
const domainSelect = document.querySelector("#domainSelect");
const refreshProjectsBtn = document.querySelector("#refreshProjectsBtn");
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

const groupModal = document.querySelector("#groupModal");
const groupModalForm = document.querySelector("#groupModalForm");
const groupModalProjectInfo = document.querySelector("#groupModalProjectInfo");
const newGroupNameInput = document.querySelector("#newGroupName");
const groupModalError = document.querySelector("#groupModalError");
const groupModalStatus = document.querySelector("#groupModalStatus");
const closeGroupModalBtn = document.querySelector("#closeGroupModalBtn");
const cancelGroupModalBtn = document.querySelector("#cancelGroupModalBtn");
const createGroupBtn = document.querySelector("#createGroupBtn");

const webhookCallbackUrlInput = document.querySelector("#webhookCallbackUrl");

const LS_KEYS = {
  webhookCallbackUrl: "shorturl:webhook_callback_url",
};

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

function setInlineError(message = "") {
  if (!message) {
    formError.hidden = true;
    formError.textContent = "";
    return;
  }
  formError.hidden = false;
  formError.textContent = message;
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
}

function setMetaText(text = "") {
  metaOutput.textContent = text;
}

function setGroupModalStatus(text, kind = "") {
  groupModalStatus.textContent = text;
  groupModalStatus.className = `status-output${kind ? ` ${kind}` : ""}`;
}

function setJsonOutput(data) {
  jsonOutput.textContent = JSON.stringify(data ?? {}, null, 2);
}

function setLinkResult(url) {
  state.latestLinkUrl = url || "";
  if (!state.latestLinkUrl) {
    linkOutput.className = "link-output empty";
    linkOutput.textContent = "尚未创建";
    copyLinkBtn.disabled = true;
    openLinkBtn.classList.add("disabled-link");
    openLinkBtn.href = "#";
    return;
  }

  linkOutput.className = "link-output";
  linkOutput.innerHTML = `<a href="${escapeHtml(state.latestLinkUrl)}" target="_blank" rel="noreferrer">${escapeHtml(state.latestLinkUrl)}</a>`;
  copyLinkBtn.disabled = false;
  openLinkBtn.classList.remove("disabled-link");
  openLinkBtn.href = state.latestLinkUrl;
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
  refreshProjectsBtn.disabled = loading;
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

async function postJSON(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

function requireApiKeyForMeta() {
  if (state.serverHasApiKey) return "";
  const apikey = getCurrentApiKey();
  if (!apikey) {
    return "请先填写 apikey（或在服务端配置 XIAOMARK_API_KEY）再加载项目/分组/自有域名。";
  }
  return "";
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
        placeholder: projects.length ? "请选择项目" : "暂无项目",
        getValue: (item) => item.id,
        getLabel: (item) => `${item.name} (${item.id})`,
      });

      if (!projectSelect.value && projects.length === 1) {
        projectSelect.value = projects[0].id;
      }

      setMetaText(
        `项目列表已更新（${projects.length} 项，缓存：${data?._meta?.cache || "unknown"}${background ? "，静默刷新" : ""}）`
      );
      refreshGroupsBtn.disabled = !projectSelect.value;
      openCreateGroupBtn.disabled = !projectSelect.value;
      if (projectSelect.value) {
        await loadGroups({ background });
      } else {
        state.groups = [];
        populateSelect(groupSelect, [], { placeholder: "请先选择项目" });
        groupSelect.disabled = true;
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
    populateSelect(groupSelect, [], { placeholder: "请先选择项目" });
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

      if (!groupSelect.value && groups.length === 1) {
        groupSelect.value = groups[0].id;
      }
      setMetaText(
        `分组列表已更新（${groups.length} 项，缓存：${data?._meta?.cache || "unknown"}${background ? "，静默刷新" : ""}）`
      );
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
      setMetaText(
        `自有域名已更新（${domains.length} 项，缓存：${data?._meta?.cache || "unknown"}${background ? "，静默刷新" : ""}）`
      );
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
    moreOptions.open = true;
  } else if (
    formError.textContent.includes("微信内强制浏览器打开 与 深度过滤机器访问")
  ) {
    setInlineError("");
  }
}

function collectPayload() {
  const fd = new FormData(form);
  const get = (key) => normalizeText(fd.get(key));
  const payload = {
    apikey: get("apikey"),
    project_id: get("project_id"), // UI only (for convenience; not used by create API)
    group_id: get("group_id"),
    target_url: get("target_url"),
    name: get("name"),
    domain: get("domain"),
    key: get("key"),
    key_length: get("key_length"),
    webhook_callback_url: get("webhook_callback_url"), // UI only
    webhook_scene: get("webhook_scene"),
    escape_from_wechat: fd.get("escape_from_wechat") === "on",
    advanced_bot_detection: fd.get("advanced_bot_detection") === "on",
    webhook: fd.get("webhook") === "on",
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
    return "请先选择项目。";
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

  // create API does not need project_id or webhook callback URL.
  delete payload.project_id;
  return "";
}

async function handleSubmit(event) {
  event.preventDefault();
  setInlineError("");
  setStatus("请求发送中...", "pending");
  setMetaText("");
  submitBtn.disabled = true;

  const payload = collectPayload();
  const validationError = validatePayload(payload);
  if (validationError) {
    setInlineError(validationError);
    setStatus("表单校验未通过", "error");
    if (validationError.includes("Webhook") || validationError.includes("后缀") || validationError.includes("过滤")) {
      moreOptions.open = true;
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
    setStatus(`成功：${data?.message || "创建成功"}`, "success");
    setMetaText("短链创建成功");
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
  setStatus("等待提交");
  setMetaText("");
  setJsonOutput({});
  setLinkResult("");

  // Restore defaults after reset.
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
    await navigator.clipboard.writeText(state.latestLinkUrl);
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
    setInlineError("请先选择项目，再创建分组。");
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
    setGroupModalError("未选择项目。");
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
      ttl > 0 ? `服务端缓存 ${Math.round(ttl / 1000)}s（点击下拉仍会触发刷新请求）` : "无缓存",
      "ok"
    );

    applyDefaultsFromConfig(config);
    setStatus("准备就绪");

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
  const refreshProjects = () => loadProjects({ forceUi: true });
  const refreshGroups = () => loadGroups({ forceUi: true });
  const refreshDomains = () => loadDomains({ forceUi: true });
  const backgroundRefreshProjects = () => loadProjects({ forceUi: true, background: true });
  const backgroundRefreshGroups = () => loadGroups({ forceUi: true, background: true });
  const backgroundRefreshDomains = () => loadDomains({ forceUi: true, background: true });

  refreshProjectsBtn.addEventListener("click", refreshProjects);
  refreshGroupsBtn.addEventListener("click", refreshGroups);
  refreshDomainsBtn.addEventListener("click", refreshDomains);

  for (const [select, handler] of [
    [projectSelect, backgroundRefreshProjects],
    [groupSelect, backgroundRefreshGroups],
    [domainSelect, backgroundRefreshDomains],
  ]) {
    select.addEventListener("focus", handler);
    select.addEventListener("pointerdown", handler);
  }
}

function wireEvents() {
  form.addEventListener("submit", handleSubmit);
  form.addEventListener("reset", () => setTimeout(handleReset, 0));
  copyLinkBtn.addEventListener("click", copyLatestLink);

  projectSelect.addEventListener("change", async () => {
    setInlineError("");
    await loadGroups({ forceUi: true });
  });

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

  webhookCallbackUrlInput.addEventListener("change", () => {
    const value = normalizeText(webhookCallbackUrlInput.value);
    try {
      if (value) localStorage.setItem(LS_KEYS.webhookCallbackUrl, value);
    } catch {
      // Ignore localStorage failures
    }
  });

  $("apikey").addEventListener("change", () => {
    if (state.serverHasApiKey) return;
    state.projects = [];
    state.groups = [];
    state.domains = [];
    populateSelect(projectSelect, [], { placeholder: "点击加载项目" });
    populateSelect(groupSelect, [], { placeholder: "请先选择项目" });
    populateSelect(domainSelect, [], { placeholder: "默认域名（不指定，使用小码默认）" });
    loadProjects({ forceUi: true });
    loadDomains({ forceUi: true });
  });

  setupSelectRefreshTriggers();
}

setJsonOutput({});
setLinkResult("");
setStatus("初始化中...");
setMetaText("");
populateSelect(projectSelect, [], { placeholder: "点击加载项目" });
populateSelect(groupSelect, [], { placeholder: "请先选择项目" });
populateSelect(domainSelect, [], { placeholder: "默认域名（不指定，使用小码默认）" });
groupSelect.disabled = true;
refreshGroupsBtn.disabled = true;
openCreateGroupBtn.disabled = true;

wireEvents();
loadConfig();
