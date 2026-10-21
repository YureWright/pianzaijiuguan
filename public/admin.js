"use strict";

const ADMIN_DEFAULTS = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta"
};

const adminState = {
  token: "",
  roles: [],
  editingId: null,
  avatarUrl: "",
  portraitUrl: "",
  avatarEmoji: "🎲",
  dialogToken: 0,
  imageBusy: 0,
  saving: false,
  musicUrl: "",
  musicVolume: 35,
  musicEnabled: false,
  musicBusy: false
};

function $(id) {
  return document.getElementById(id);
}

function escapeHtml(value) {
  const characters = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  };
  return String(value == null ? "" : value).replace(/[&<>"']/g, (character) => characters[character]);
}

function toast(message, danger) {
  const element = $("toast");
  element.textContent = message;
  element.classList.toggle("danger", Boolean(danger));
  element.classList.add("show");
  clearTimeout(adminState.toastTimer);
  adminState.toastTimer = setTimeout(() => element.classList.remove("show"), 3600);
}

async function adminApi(path, options) {
  const opts = options || {};
  const headers = {};
  if (opts.body) {
    headers["Content-Type"] = "application/json";
  }
  if (adminState.token) {
    headers.Authorization = "Bearer " + adminState.token;
  }
  const response = await fetch(path, {
    method: opts.method || "GET",
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    cache: "no-store"
  });
  let payload = {};
  try {
    payload = await response.json();
  } catch (error) {
    payload = {};
  }
  if (response.status === 401 && path !== "/api/admin/login") {
    logoutLocal();
    throw new Error(payload.error || "登录已失效。");
  }
  if (!response.ok) {
    throw new Error(payload.error || "请求失败。");
  }
  return payload;
}

function showLogin() {
  $("login-view").hidden = false;
  $("dashboard-view").hidden = true;
  $("logout-button").hidden = true;
}

function showDashboard() {
  $("login-view").hidden = true;
  $("dashboard-view").hidden = false;
  $("logout-button").hidden = false;
}

function logoutLocal() {
  adminState.token = "";
  sessionStorage.removeItem("liars-admin-token");
  showLogin();
  $("admin-password").value = "";
}

async function loadRoles() {
  const payload = await adminApi("/api/admin/roles");
  adminState.roles = Array.isArray(payload.roles) ? payload.roles : [];
  renderRoles();
}

async function loadMusic() {
  const payload = await adminApi("/api/admin/music");
  const music = payload.music || {};
  adminState.musicUrl = music.url || "";
  adminState.musicVolume = Math.round((Number(music.volume) || 0.35) * 100);
  adminState.musicEnabled = Boolean(music.enabled);
  renderMusic();
}

function renderMusic() {
  $("music-url").value = /^data:audio\//i.test(adminState.musicUrl) ? "" : adminState.musicUrl;
  $("music-volume").value = String(adminState.musicVolume);
  $("music-volume-value").textContent = adminState.musicVolume + "%";
  $("music-enabled").checked = adminState.musicEnabled;
  const preview = $("music-preview");
  if (adminState.musicUrl) {
    preview.src = adminState.musicUrl;
  } else {
    preview.removeAttribute("src");
    preview.load();
  }
  $("music-file-status").textContent = adminState.musicUrl
    ? (/^data:audio\//i.test(adminState.musicUrl) ? "使用已上传的音频文件" : adminState.musicUrl)
    : "尚未设置音乐";
}

async function saveMusic() {
  if (adminState.musicBusy) {
    return;
  }
  adminState.musicBusy = true;
  const button = $("save-music");
  button.disabled = true;
  try {
    const payload = await adminApi("/api/admin/music", {
      method: "PUT",
      body: {
        url: adminState.musicUrl,
        volume: adminState.musicVolume / 100,
        enabled: adminState.musicEnabled
      }
    });
    const music = payload.music || {};
    adminState.musicUrl = music.url || "";
    adminState.musicVolume = Math.round((Number(music.volume) || 0.35) * 100);
    adminState.musicEnabled = Boolean(music.enabled);
    renderMusic();
    toast("背景音乐设置已保存。");
  } catch (error) {
    toast(error.message, true);
  } finally {
    adminState.musicBusy = false;
    button.disabled = false;
  }
}

async function clearMusic() {
  if (!window.confirm("确定移除游戏背景音乐吗？")) {
    return;
  }
  try {
    await adminApi("/api/admin/music", {
      method: "PUT",
      body: { clear: true }
    });
    adminState.musicUrl = "";
    adminState.musicEnabled = false;
    $("music-file").value = "";
    renderMusic();
    toast("背景音乐已移除。");
  } catch (error) {
    toast(error.message, true);
  }
}

function roleAvatar(role) {
  if (role.portraitUrl) {
    return "<img src=\"" + escapeHtml(role.portraitUrl) + "\" alt=\"\">";
  }
  if (role.avatarUrl) {
    return "<img src=\"" + escapeHtml(role.avatarUrl) + "\" alt=\"\">";
  }
  return escapeHtml(role.avatarEmoji || "🎲");
}

function renderRoles() {
  const grid = $("role-grid");
  const enabled = adminState.roles.filter((role) => role.enabled).length;
  const keys = adminState.roles.filter((role) => role.hasKey).length;
  $("role-count").textContent = adminState.roles.length;
  $("enabled-count").textContent = enabled;
  $("key-count").textContent = keys;
  if (adminState.roles.length === 0) {
    grid.innerHTML = "<div class=\"admin-empty\">还没有 AI 角色。点击右上角新增。</div>";
    return;
  }
  grid.innerHTML = adminState.roles.map((role) => {
    return [
      "<article class=\"admin-role-card " + (role.enabled ? "" : "disabled") + "\" data-role-id=\"" + escapeHtml(role.id) + "\">",
      "  <div class=\"role-card-head\">",
      "    <span class=\"role-card-avatar\">" + roleAvatar(role) + "</span>",
      "    <div class=\"role-card-title\">",
      "      <strong>" + escapeHtml(role.name) + "</strong>",
      "      <small>" + escapeHtml(role.provider + " · " + role.model) + "</small>",
      "    </div>",
      "  </div>",
      "  <div class=\"role-status-row\">",
      "    <span class=\"role-pill " + (role.enabled ? "good" : "") + "\">" + (role.enabled ? "已启用" : "已停用") + "</span>",
      "    <span class=\"role-pill " + (role.hasKey ? "good" : "warn") + "\">" + (role.hasKey ? "密钥 " + escapeHtml(role.apiKeyMasked) : "未配置密钥") + "</span>",
      "  </div>",
      "  <div class=\"role-card-model\">" + escapeHtml(role.baseUrl) + "</div>",
      "  <div class=\"role-card-actions\">",
      "    <button class=\"ghost-button toggle-button " + (role.enabled ? "on" : "") + "\" type=\"button\" data-role-action=\"toggle\">" + (role.enabled ? "停用" : "启用") + "</button>",
      "    <button class=\"secondary-button\" type=\"button\" data-role-action=\"edit\">编辑</button>",
      "  </div>",
      "</article>"
    ].join("");
  }).join("");
}

function setAvatarPreview() {
  const preview = $("avatar-preview");
  if (adminState.avatarUrl) {
    preview.innerHTML = "<img src=\"" + escapeHtml(adminState.avatarUrl) + "\" alt=\"\">";
  } else {
    preview.textContent = adminState.avatarEmoji || "🎲";
  }
}

function openRoleDialog(role) {
  adminState.dialogToken += 1;
  adminState.imageBusy = 0;
  const source = role || {
    name: "",
    provider: "openai",
    baseUrl: ADMIN_DEFAULTS.openai,
    model: "",
    avatarEmoji: "🎲",
    avatarUrl: "",
    portraitUrl: "",
    systemPrompt: "",
    enabled: true,
    hasKey: false,
    apiKeyMasked: ""
  };
  adminState.editingId = role ? role.id : null;
  adminState.avatarUrl = source.avatarUrl || "";
  adminState.portraitUrl = source.portraitUrl || "";
  adminState.avatarEmoji = source.avatarEmoji || "🎲";
  $("role-dialog-title").textContent = role ? "编辑 AI 角色" : "新增 AI 角色";
  $("role-name").value = source.name || "";
  $("role-provider").value = source.provider || "openai";
  $("role-base-url").value = source.baseUrl || ADMIN_DEFAULTS[source.provider || "openai"];
  $("role-model").value = source.model || "";
  $("role-api-key").value = "";
  $("role-prompt").value = source.systemPrompt || "";
  $("role-clear-key").checked = false;
  $("role-enabled").checked = source.enabled !== false;
  $("role-avatar-emoji").value = source.avatarEmoji || "";
  $("avatar-file").value = "";
  $("portrait-file").value = "";
  $("key-status").textContent = source.hasKey ? "已配置：" + source.apiKeyMasked : "尚未配置";
  $("delete-role").hidden = !role;
  setAvatarPreview();
  setPortraitPreview();
  if (typeof $("role-dialog").showModal === "function") {
    $("role-dialog").showModal();
  }
}

function setPortraitPreview() {
  const preview = $("portrait-preview");
  if (adminState.portraitUrl) {
    preview.innerHTML = "<img src=\"" + escapeHtml(adminState.portraitUrl) + "\" alt=\"\">";
  } else {
    preview.textContent = "默认立绘";
  }
}

function closeRoleDialog() {
  adminState.dialogToken += 1;
  $("role-dialog").close();
}

function resizeImage(file, width, height) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("无法读取头像文件。"));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("头像图片无法解析。"));
      image.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        const scale = Math.max(width / image.width, height / image.height);
        const drawWidth = image.width * scale;
        const drawHeight = image.height * scale;
        context.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
        resolve(canvas.toDataURL("image/webp", 0.84));
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

async function saveRole() {
  if (adminState.saving) {
    return;
  }
  if (adminState.imageBusy > 0) {
    toast("图片还在处理中，请稍候再保存。", true);
    return;
  }
  const name = $("role-name").value.trim();
  const model = $("role-model").value.trim();
  if (!name || !model) {
    toast("角色名称和模型名称不能为空。", true);
    return;
  }
  const provider = $("role-provider").value;
  const saveButton = $("save-role");
  adminState.saving = true;
  saveButton.disabled = true;
  const body = {
    name,
    provider,
    baseUrl: $("role-base-url").value.trim() || ADMIN_DEFAULTS[provider],
    model,
    avatarEmoji: $("role-avatar-emoji").value.trim() || "🎲",
    avatarUrl: adminState.avatarUrl,
    portraitUrl: adminState.portraitUrl,
    systemPrompt: $("role-prompt").value,
    enabled: $("role-enabled").checked,
    clearApiKey: $("role-clear-key").checked
  };
  const apiKey = $("role-api-key").value.trim();
  if (apiKey) {
    body.apiKey = apiKey;
  }
  try {
    if (adminState.editingId) {
      await adminApi("/api/admin/roles/" + encodeURIComponent(adminState.editingId), {
        method: "PUT",
        body
      });
    } else {
      await adminApi("/api/admin/roles", { method: "POST", body });
    }
    closeRoleDialog();
    await loadRoles();
    toast("AI 角色已保存。");
  } catch (error) {
    toast(error.message, true);
  } finally {
    adminState.saving = false;
    saveButton.disabled = false;
  }
}

async function toggleRole(role) {
  try {
    await adminApi("/api/admin/roles/" + encodeURIComponent(role.id), {
      method: "PUT",
      body: { enabled: !role.enabled }
    });
    await loadRoles();
  } catch (error) {
    toast(error.message, true);
  }
}

async function deleteRole() {
  if (!adminState.editingId) {
    return;
  }
  if (!window.confirm("确定永久删除这个 AI 角色？")) {
    return;
  }
  try {
    await adminApi("/api/admin/roles/" + encodeURIComponent(adminState.editingId), { method: "DELETE" });
    closeRoleDialog();
    await loadRoles();
    toast("AI 角色已删除。");
  } catch (error) {
    toast(error.message, true);
  }
}

async function changePassword() {
  const currentPassword = $("current-password").value;
  const newPassword = $("new-password").value;
  const confirmPassword = $("confirm-password").value;
  if (newPassword !== confirmPassword) {
    toast("两次输入的新密码不一致。", true);
    return;
  }
  try {
    await adminApi("/api/admin/password", {
      method: "POST",
      body: { currentPassword, newPassword }
    });
    $("password-dialog").close();
    logoutLocal();
    toast("管理员密码已更新，请重新登录。");
  } catch (error) {
    toast(error.message, true);
  }
}

function wireEvents() {
  $("login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const payload = await adminApi("/api/admin/login", {
        method: "POST",
        body: { password: $("admin-password").value }
      });
      adminState.token = payload.token;
      sessionStorage.setItem("liars-admin-token", payload.token);
      showDashboard();
      await loadRoles();
      await loadMusic();
    } catch (error) {
      toast(error.message, true);
    }
  });

  $("logout-button").addEventListener("click", async () => {
    try {
      await adminApi("/api/admin/logout", { method: "POST" });
    } catch (error) {
      // Local logout still works.
    }
    logoutLocal();
  });

  $("add-role-button").addEventListener("click", () => openRoleDialog(null));
  $("role-dialog-close").addEventListener("click", closeRoleDialog);
  $("cancel-role").addEventListener("click", closeRoleDialog);
  $("save-role").addEventListener("click", saveRole);
  $("delete-role").addEventListener("click", deleteRole);

  $("role-provider").addEventListener("change", () => {
    const provider = $("role-provider").value;
    const current = $("role-base-url").value.trim();
    if (!current || Object.values(ADMIN_DEFAULTS).includes(current)) {
      $("role-base-url").value = ADMIN_DEFAULTS[provider];
    }
  });

  $("role-avatar-emoji").addEventListener("input", () => {
    adminState.avatarEmoji = $("role-avatar-emoji").value.trim() || "🎲";
    if (!adminState.avatarUrl) {
      setAvatarPreview();
    }
  });

  $("avatar-file").addEventListener("change", async (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) {
      return;
    }
    const token = adminState.dialogToken;
    adminState.imageBusy += 1;
    try {
      const resized = await resizeImage(file, 256, 256);
      if (token !== adminState.dialogToken) {
        return;
      }
      adminState.avatarUrl = resized;
      setAvatarPreview();
      toast("头像已压缩，保存角色后生效。");
    } catch (error) {
      toast(error.message, true);
    } finally {
      adminState.imageBusy = Math.max(0, adminState.imageBusy - 1);
    }
  });

  $("remove-avatar").addEventListener("click", () => {
    adminState.avatarUrl = "";
    $("avatar-file").value = "";
    setAvatarPreview();
  });

  $("portrait-file").addEventListener("change", async (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) {
      return;
    }
    const token = adminState.dialogToken;
    adminState.imageBusy += 1;
    try {
      const resized = await resizeImage(file, 420, 630);
      if (token !== adminState.dialogToken) {
        return;
      }
      adminState.portraitUrl = resized;
      setPortraitPreview();
      toast("立绘已压缩，保存角色后生效。");
    } catch (error) {
      toast(error.message, true);
    } finally {
      adminState.imageBusy = Math.max(0, adminState.imageBusy - 1);
    }
  });

  $("reset-portrait").addEventListener("click", () => {
    adminState.portraitUrl = "";
    $("portrait-file").value = "";
    setPortraitPreview();
  });

  $("role-grid").addEventListener("click", (event) => {
    const button = event.target.closest("[data-role-action]");
    const card = event.target.closest("[data-role-id]");
    if (!button || !card) {
      return;
    }
    const role = adminState.roles.find((item) => item.id === card.getAttribute("data-role-id"));
    if (!role) {
      return;
    }
    if (button.getAttribute("data-role-action") === "edit") {
      openRoleDialog(role);
    } else {
      toggleRole(role);
    }
  });

  $("password-button").addEventListener("click", () => {
    $("current-password").value = "";
    $("new-password").value = "";
    $("confirm-password").value = "";
    $("password-dialog").showModal();
  });
  $("password-dialog-close").addEventListener("click", () => $("password-dialog").close());
  $("cancel-password").addEventListener("click", () => $("password-dialog").close());
  $("save-password").addEventListener("click", changePassword);

  $("music-url").addEventListener("input", () => {
    adminState.musicUrl = $("music-url").value.trim();
    $("music-file-status").textContent = adminState.musicUrl || "尚未设置音乐";
  });
  $("music-volume").addEventListener("input", () => {
    adminState.musicVolume = Number($("music-volume").value) || 0;
    $("music-volume-value").textContent = adminState.musicVolume + "%";
  });
  $("music-enabled").addEventListener("change", () => {
    adminState.musicEnabled = $("music-enabled").checked;
  });
  $("music-file").addEventListener("change", () => {
    const file = $("music-file").files && $("music-file").files[0];
    if (!file) {
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      toast("音乐文件不能超过 8MB。", true);
      $("music-file").value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      adminState.musicUrl = String(reader.result || "");
      renderMusic();
      toast("音频已载入，点击保存后生效。");
    };
    reader.onerror = () => toast("音频读取失败。", true);
    reader.readAsDataURL(file);
  });
  $("save-music").addEventListener("click", saveMusic);
  $("clear-music").addEventListener("click", clearMusic);

  $("reset-leaderboard").addEventListener("click", async () => {
    if (!window.confirm("确认清空全部用户名、用户战绩和 AI 统计？")) {
      return;
    }
    if (!window.confirm("此操作不可恢复。再次确认要重置排行榜和已有用户吗？")) {
      return;
    }
    try {
      await adminApi("/api/admin/leaderboard/reset", { method: "POST" });
      toast("排行榜与用户数据已清空。");
    } catch (error) {
      toast(error.message, true);
    }
  });

  document.querySelectorAll("dialog").forEach((dialog) => {
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) {
        dialog.close();
      }
    });
  });
}

async function initialize() {
  wireEvents();
  adminState.token = sessionStorage.getItem("liars-admin-token") || "";
  if (!adminState.token) {
    showLogin();
    return;
  }
  try {
    showDashboard();
    await loadRoles();
    await loadMusic();
  } catch (error) {
    $("admin-password").value = "";
    showLogin();
  }
}

initialize();
