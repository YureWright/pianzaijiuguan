"use strict";

const ADMIN_DEFAULTS = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta"
};
const TTS_VOICE_CATALOG = [
  { value: "Ethan", name: "晨煦", gender: "男声", style: "阳光、温暖、有北方口音", language: "普通话 / 多语种", usage: "旁白、解说" },
  { value: "Cherry", name: "芊悦", gender: "女声", style: "阳光积极、亲切自然", language: "普通话 / 多语种", usage: "通用对话" },
  { value: "Serena", name: "苏瑶", gender: "女声", style: "温柔、细腻", language: "普通话 / 多语种", usage: "情绪表达" },
  { value: "Chelsie", name: "千雪", gender: "女声", style: "二次元、轻快", language: "普通话 / 多语种", usage: "活泼角色" },
  { value: "Dylan", name: "晓东", gender: "男声", style: "北京胡同少年", language: "北京话 / 多语种", usage: "年轻角色" },
  { value: "Jada", name: "阿珍", gender: "女声", style: "风风火火的沪上阿姐", language: "上海话 / 多语种", usage: "强势角色" },
  { value: "Sunny", name: "晴儿", gender: "女声", style: "甜美亲切的川妹子", language: "四川话 / 多语种", usage: "旁白、亲和角色" },
  { value: "Nofish", name: "不吃鱼", gender: "男声", style: "不会翘舌音的设计师", language: "普通话 / 多语种", usage: "冷幽默角色" },
  { value: "Momo", name: "茉兔", gender: "女声", style: "撒娇搞怪、俏皮", language: "普通话 / 多语种", usage: "捣蛋角色" },
  { value: "Bella", name: "萌宝", gender: "女声", style: "可爱萝莉音", language: "普通话 / 多语种", usage: "可爱角色" },
  { value: "Eric", name: "程川", gender: "男声", style: "跳脱市井的成都男子", language: "四川话 / 多语种", usage: "市井角色" }
];

const DOUBAO_VOICE_CATALOG = [
  { value: "BV001_streaming", name: "通用女声", gender: "女声", style: "经典通用女声，清晰自然", language: "中文", usage: "豆包默认音色" },
  { value: "BV002_streaming", name: "通用男声", gender: "男声", style: "经典通用男声，稳重自然", language: "中文", usage: "通用对话" },
  { value: "BV700_streaming", name: "灿灿", gender: "女声", style: "支持 22 种情感与风格", language: "中文 / 多语种", usage: "情绪表达" },
  { value: "BV701_streaming", name: "擎苍", gender: "男声", style: "有声阅读质感，适合旁白", language: "中文", usage: "旁白、解说" },
  { value: "BV123_streaming", name: "阳光青年", gender: "男声", style: "年轻、明亮、有活力", language: "中文", usage: "年轻角色" },
  { value: "BV104_streaming", name: "温柔淑女", gender: "女声", style: "柔和、克制、亲切", language: "中文", usage: "温和角色" },
  { value: "BV107_streaming", name: "霸气青叔", gender: "男声", style: "低沉、强势、有压迫感", language: "中文", usage: "强势角色" },
  { value: "BV004_streaming", name: "开朗青年", gender: "男声", style: "开朗、健谈、轻松", language: "中文", usage: "活跃角色" }
];

const DOUBAO_V3_VOICE_CATALOG = [
  { value: "zh_female_vv_uranus_bigtts", name: "Vivi 2.0", gender: "女声", style: "豆包语音 2.0 主打音色，自然多语种", language: "中文 / 30+ 语种", usage: "豆包推荐音色" },
  { value: "zh_female_xiaohe_uranus_bigtts", name: "小何 2.0", gender: "女声", style: "自然亲切，支持多方言", language: "中文 / 30+ 语种", usage: "通用对话" },
  { value: "zh_male_m191_uranus_bigtts", name: "云舟 2.0", gender: "男声", style: "沉稳自然，支持多方言", language: "中文 / 30+ 语种", usage: "通用男声" },
  { value: "zh_male_taocheng_uranus_bigtts", name: "小天 2.0", gender: "男声", style: "年轻自然，适合对话", language: "中文 / 30+ 语种", usage: "活跃角色" },
  { value: "zh_male_liufei_uranus_bigtts", name: "刘飞 2.0", gender: "男声", style: "成熟、清晰、有辨识度", language: "中文 / 30+ 语种", usage: "强势角色" },
  { value: "zh_female_sophie_uranus_bigtts", name: "魅力苏菲 2.0", gender: "女声", style: "成熟、有魅力", language: "中文 / 30+ 语种", usage: "情绪表达" },
  { value: "zh_female_qingxinnvsheng_uranus_bigtts", name: "清新女声 2.0", gender: "女声", style: "清新、干净、自然", language: "中文 / 30+ 语种", usage: "旁白、解说" },
  { value: "zh_female_cancan_uranus_bigtts", name: "知性灿灿 2.0", gender: "女声", style: "知性、活泼、表现力强", language: "中文 / 30+ 语种", usage: "角色扮演" },
  { value: "zh_male_wenrouxiaoge_uranus_bigtts", name: "温柔小哥 2.0", gender: "男声", style: "温柔、亲切", language: "中文 / 30+ 语种", usage: "温和角色" },
  { value: "zh_male_yangguangqingnian_uranus_bigtts", name: "阳光青年 2.0", gender: "男声", style: "阳光、有朝气", language: "中文 / 30+ 语种", usage: "年轻角色" }
];

function doubaoCatalogFor(mode) {
  return mode === "apikey" ? DOUBAO_V3_VOICE_CATALOG : DOUBAO_VOICE_CATALOG;
}

function doubaoDefaultVoice() {
  return adminState.doubao && adminState.doubao.authMode === "apikey"
    ? "zh_female_vv_uranus_bigtts"
    : "BV001_streaming";
}

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
  musicBusy: false,
  tts: null,
  ttsBusy: false,
  ttsPreviewUrl: "",
  ttsPreviewToken: 0,
  ttsPreviewButton: null,
  ttsPreviewButtonLabel: "",
  roleTesting: false,
  doubao: null,
  doubaoBusy: false
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

async function loadTts() {
  const payload = await adminApi("/api/admin/tts");
  applyTts(payload.tts || {});
}

function applyTts(tts) {
  adminState.tts = tts || {};
  $("tts-base-url").value = adminState.tts.baseUrl || "https://dashscope.aliyuncs.com/api/v1";
  $("tts-model").value = adminState.tts.model || "qwen3-tts-flash";
  $("tts-narrator-voice").value = adminState.tts.narratorVoice || "Sunny";
  $("tts-default-voice").value = adminState.tts.defaultVoice || "Cherry";
  $("tts-speed").value = String(Number(adminState.tts.speed) || 1);
  $("tts-format").value = adminState.tts.format || "mp3";
  $("tts-enabled").checked = Boolean(adminState.tts.enabled);
  $("tts-api-key").value = "";
  $("tts-clear-key").checked = false;
  $("tts-key-status").textContent = adminState.tts.hasKey
    ? "已配置：" + (adminState.tts.apiKeyMasked || "已保存")
    : "尚未配置";
  $("tts-status").textContent = adminState.tts.enabled
    ? "大模型语音已启用，旁白音色 " + (adminState.tts.narratorVoice || "Sunny")
    : "大模型语音未启用，将使用浏览器语音";
}

async function saveTts(quiet) {
  if (adminState.ttsBusy) {
    return false;
  }
  adminState.ttsBusy = true;
  const button = $("save-tts");
  button.disabled = true;
  try {
    const body = {
      enabled: $("tts-enabled").checked,
      baseUrl: $("tts-base-url").value.trim(),
      model: $("tts-model").value.trim(),
      narratorVoice: $("tts-narrator-voice").value.trim(),
      defaultVoice: $("tts-default-voice").value.trim(),
      speed: Number($("tts-speed").value) || 1,
      format: $("tts-format").value,
      clearApiKey: $("tts-clear-key").checked
    };
    const apiKey = $("tts-api-key").value.trim();
    if (apiKey) {
      body.apiKey = apiKey;
    }
    const payload = await adminApi("/api/admin/tts", { method: "PUT", body });
    applyTts(payload.tts || {});
    if (!quiet) {
      toast("千问语音设置已保存。");
    }
    return true;
  } catch (error) {
    toast(error.message, true);
    return false;
  } finally {
    adminState.ttsBusy = false;
    button.disabled = false;
  }
}

async function loadDoubao() {
  const payload = await adminApi("/api/admin/doubao");
  applyDoubao(payload.doubao || {});
}

function applyDoubao(doubao) {
  adminState.doubao = doubao || {};
  const authMode = adminState.doubao.authMode === "apikey" ? "apikey" : "classic";
  $("doubao-auth-mode").value = authMode;
  $("doubao-endpoint").value = adminState.doubao.endpoint || (authMode === "apikey"
    ? "https://openspeech.bytedance.com/api/v3/tts/unidirectional"
    : "https://openspeech.bytedance.com/api/v1/tts");
  $("doubao-app-id").value = adminState.doubao.appId || "";
  $("doubao-api-key").value = "";
  $("doubao-resource-id").value = adminState.doubao.resourceId || "seed-tts-2.0";
  $("doubao-cluster").value = adminState.doubao.cluster || "volcano_tts";
  $("doubao-voice-type").value = adminState.doubao.voiceType || doubaoDefaultVoice();
  $("doubao-speed").value = String(Number(adminState.doubao.speed) || 1);
  $("doubao-format").value = adminState.doubao.format || "mp3";
  $("doubao-enabled").checked = Boolean(adminState.doubao.enabled);
  $("doubao-access-token").value = "";
  $("doubao-clear-token").checked = false;
  $("doubao-clear-api-key").checked = false;
  $("doubao-token-status").textContent = adminState.doubao.hasToken
    ? "已配置：" + (adminState.doubao.tokenMasked || "已保存")
    : "尚未配置";
  $("doubao-api-key-status").textContent = adminState.doubao.hasApiKey
    ? "已配置：" + (adminState.doubao.apiKeyMasked || "已保存")
    : "尚未配置";
  $("doubao-status").textContent = adminState.doubao.enabled
    ? "豆包语音已启用 · " + (authMode === "apikey" ? "新版 API Key" : "经典版") +
      " · " + ($("doubao-voice-type").value || doubaoDefaultVoice())
    : "豆包语音未启用";
  toggleDoubaoAuthFields(authMode);
  renderDoubaoCatalog(authMode);
}

function toggleDoubaoAuthFields(mode) {
  const useApiKey = mode === "apikey";
  document.querySelectorAll(".doubao-classic-field").forEach((element) => {
    element.hidden = useApiKey;
  });
  document.querySelectorAll(".doubao-apikey-field").forEach((element) => {
    element.hidden = !useApiKey;
  });
  $("doubao-clear-token").closest("label").hidden = useApiKey;
  $("doubao-clear-api-key").closest("label").hidden = !useApiKey;
}

async function saveDoubao(quiet) {
  if (adminState.doubaoBusy) {
    return false;
  }
  adminState.doubaoBusy = true;
  const button = $("save-doubao");
  button.disabled = true;
  try {
    const body = {
      enabled: $("doubao-enabled").checked,
      authMode: $("doubao-auth-mode").value,
      endpoint: $("doubao-endpoint").value.trim(),
      appId: $("doubao-app-id").value.trim(),
      apiKey: $("doubao-api-key").value.trim(),
      resourceId: $("doubao-resource-id").value.trim(),
      cluster: $("doubao-cluster").value.trim(),
      voiceType: $("doubao-voice-type").value.trim(),
      speed: Number($("doubao-speed").value) || 1,
      format: $("doubao-format").value,
      clearAccessToken: $("doubao-clear-token").checked,
      clearApiKey: $("doubao-clear-api-key").checked
    };
    const token = $("doubao-access-token").value.trim();
    if (token) {
      body.accessToken = token;
    }
    const payload = await adminApi("/api/admin/doubao", { method: "PUT", body });
    applyDoubao(payload.doubao || {});
    if (!quiet) {
      toast("豆包经典语音设置已保存。");
    }
    return true;
  } catch (error) {
    toast(error.message, true);
    return false;
  } finally {
    adminState.doubaoBusy = false;
    button.disabled = false;
  }
}

async function testDoubaoTts() {
  if (!await saveDoubao(true)) {
    return;
  }
  try {
    await startTtsPreview({
      provider: "doubao",
      voice: $("doubao-voice-type").value.trim() || "BV001_streaming",
      text: $("doubao-test-text").value.trim() || "豆包经典语音，今晚由我来坐庄。",
      button: $("doubao-test"),
      onStatus: (status) => {
        $("doubao-status").textContent = status;
      }
    });
    toast("豆包经典语音试听成功。");
  } catch (error) {
    $("doubao-status").textContent = "试听失败：" + error.message;
    toast(error.message, true);
  }
}

async function testTts() {
  if (!await saveTts(true)) {
    return;
  }
  const button = $("tts-test");
  try {
    await startTtsPreview({
      provider: "qwen",
      voice: $("tts-narrator-voice").value.trim() || "Sunny",
      text: $("tts-test-text").value.trim() || "欢迎来到骗子酒馆，今晚没人值得相信。",
      button,
      onStatus: (status) => {
        $("tts-status").textContent = status;
      }
    });
    toast("千问语音试听成功。");
  } catch (error) {
    $("tts-status").textContent = "试听失败：" + error.message;
    toast(error.message, true);
  }
}

function restorePreviewButton() {
  const button = adminState.ttsPreviewButton;
  if (button) {
    button.disabled = false;
    button.textContent = adminState.ttsPreviewButtonLabel;
  }
  adminState.ttsPreviewButton = null;
  adminState.ttsPreviewButtonLabel = "";
}

async function startTtsPreview(options) {
  const opts = options || {};
  const provider = opts.provider === "doubao" ? "doubao" : "qwen";
  const voice = String(opts.voice || "").trim();
  const text = String(opts.text || "").replace(/\s+/g, " ").trim();
  if (!voice) {
    throw new Error("请先选择音色。");
  }
  if (!text) {
    throw new Error("试听文本不能为空。");
  }
  restorePreviewButton();
  adminState.ttsPreviewToken += 1;
  const token = adminState.ttsPreviewToken;
  const button = opts.button || null;
  if (button) {
    adminState.ttsPreviewButton = button;
    adminState.ttsPreviewButtonLabel = button.textContent;
    button.disabled = true;
    button.textContent = "合成中…";
  }
  if (typeof opts.onStatus === "function") {
    opts.onStatus("正在调用千问合成试听音频…");
  }
  try {
    const headers = { "Content-Type": "application/json" };
    if (adminState.token) {
      headers.Authorization = "Bearer " + adminState.token;
    }
    const response = await fetch("/api/admin/tts/test", {
      method: "POST",
      headers,
      cache: "no-store",
      body: JSON.stringify({ provider, text, voice })
    });
    if (!response.ok) {
      let message = "试听失败。";
      try {
        const payload = await response.json();
        message = payload.error || message;
      } catch (error) {
        // Keep the generic message when the server does not return JSON.
      }
      throw new Error(message);
    }
    const blob = await response.blob();
    if (token !== adminState.ttsPreviewToken) {
      return;
    }
    const audio = $("tts-preview");
    audio.onended = null;
    audio.onerror = null;
    audio.pause();
    if (adminState.ttsPreviewUrl) {
      URL.revokeObjectURL(adminState.ttsPreviewUrl);
    }
    adminState.ttsPreviewUrl = URL.createObjectURL(blob);
    audio.src = adminState.ttsPreviewUrl;
    audio.load();
    await audio.play();
    if (token !== adminState.ttsPreviewToken) {
      return;
    }
    if (button) {
      button.textContent = "播放中…";
    }
    if (typeof opts.onStatus === "function") {
      opts.onStatus("试听播放中 · " + voice);
    }
    audio.onended = () => {
      if (token !== adminState.ttsPreviewToken) {
        return;
      }
      restorePreviewButton();
      if (typeof opts.onStatus === "function") {
        opts.onStatus("试听完成");
      }
    };
    audio.onerror = () => {
      if (token === adminState.ttsPreviewToken) {
        restorePreviewButton();
      }
    };
  } catch (error) {
    if (token === adminState.ttsPreviewToken) {
      restorePreviewButton();
    }
    throw error;
  }
}

function rolePreviewText(role) {
  return "我是" + (role && role.name ? role.name : "这位牌手") + "，今晚的牌桌由我说了算。";
}

async function previewRoleVoice(role, button) {
  try {
    await startTtsPreview({
      provider: role.ttsProvider === "doubao" ? "doubao" : "qwen",
      voice: role.voice || "Cherry",
      text: rolePreviewText(role),
      button
    });
    toast(role.name + " 音色试听成功。");
  } catch (error) {
    toast(error.message, true);
  }
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
      "    <span class=\"role-pill\">" + escapeHtml(roleVoiceLabel(role)) + "</span>",
      "  </div>",
      "  <div class=\"role-card-model\">" + escapeHtml(role.baseUrl) + "</div>",
      "  <div class=\"role-card-actions\">",
      "    <button class=\"ghost-button toggle-button " + (role.enabled ? "on" : "") + "\" type=\"button\" data-role-action=\"toggle\">" + (role.enabled ? "停用" : "启用") + "</button>",
      "    <button class=\"secondary-button\" type=\"button\" data-role-action=\"voice-preview\">试听音色</button>",
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

function nextAvailableRoleVoice(excludeId) {
  const used = new Set(adminState.roles
    .filter((role) => role.id !== excludeId && role.voice)
    .map((role) => role.voice));
  return TTS_VOICE_CATALOG.find((voice) => !used.has(voice.value))?.value || TTS_VOICE_CATALOG[0].value;
}

function voiceInfo(value, provider) {
  const catalog = provider === "doubao"
    ? DOUBAO_VOICE_CATALOG.concat(DOUBAO_V3_VOICE_CATALOG)
    : TTS_VOICE_CATALOG;
  return catalog.find((voice) => voice.value === value) || null;
}

function roleVoiceLabel(role) {
  const provider = role.ttsProvider === "doubao" ? "doubao" : "qwen";
  const info = voiceInfo(role.voice, provider);
  const prefix = provider === "doubao" ? "豆包" : "千问";
  return prefix + " · " + (info ? info.name + " / " + info.value : (role.voice || "默认"));
}

function setRoleVoiceCatalog(provider) {
  const input = $("role-voice");
  const useDoubao = provider === "doubao";
  input.setAttribute("list", useDoubao ? "doubao-voice-options" : "tts-voice-options");
  input.placeholder = useDoubao ? doubaoDefaultVoice() : "Cherry";
  const catalog = useDoubao
    ? DOUBAO_VOICE_CATALOG.concat(DOUBAO_V3_VOICE_CATALOG)
    : TTS_VOICE_CATALOG;
  if (!catalog.some((voice) => voice.value === input.value.trim())) {
    input.value = useDoubao ? doubaoDefaultVoice() : "Cherry";
  }
}

function renderDoubaoCatalog(mode) {
  const datalist = $("doubao-voice-options");
  const grid = $("doubao-voice-grid");
  const allVoices = DOUBAO_VOICE_CATALOG.concat(DOUBAO_V3_VOICE_CATALOG);
  if (datalist) {
    datalist.innerHTML = allVoices.map((voice) => {
      return "<option value=\"" + escapeHtml(voice.value) + "\">" + escapeHtml(voice.name + " · " + voice.gender + " · " + voice.style) + "</option>";
    }).join("");
  }
  if (!grid) {
    return;
  }
  grid.innerHTML = doubaoCatalogFor(mode).map((voice) => {
    return [
      "<article class=\"tts-voice-card\">",
      "  <div class=\"tts-voice-card-head\"><b>" + escapeHtml(voice.value) + "</b><em>" + escapeHtml(voice.name) + "</em><span>" + escapeHtml(voice.gender) + "</span></div>",
      "  <p>" + escapeHtml(voice.style) + "</p>",
      "  <small>" + escapeHtml(voice.language) + " · " + escapeHtml(voice.usage) + "</small>",
      "  <div class=\"tts-voice-card-actions\">",
      "    <button type=\"button\" data-doubao-pick=\"" + escapeHtml(voice.value) + "\">设为默认</button>",
      "  </div>",
      "</article>"
    ].join("");
  }).join("");
}

function renderVoiceCatalog() {
  const datalist = $("tts-voice-options");
  const grid = $("tts-voice-grid");
  if (datalist) {
    datalist.innerHTML = TTS_VOICE_CATALOG.map((voice) => {
      return "<option value=\"" + escapeHtml(voice.value) + "\">" + escapeHtml(voice.name + " · " + voice.gender + " · " + voice.style) + "</option>";
    }).join("");
  }
  renderDoubaoCatalog(adminState.doubao && adminState.doubao.authMode === "apikey" ? "apikey" : "classic");
  if (!grid) {
    return;
  }
  grid.innerHTML = TTS_VOICE_CATALOG.map((voice) => {
    return [
      "<article class=\"tts-voice-card\">",
      "  <div class=\"tts-voice-card-head\"><b>" + escapeHtml(voice.value) + "</b><em>" + escapeHtml(voice.name) + "</em><span>" + escapeHtml(voice.gender) + "</span></div>",
      "  <p>" + escapeHtml(voice.style) + "</p>",
      "  <small>" + escapeHtml(voice.language) + " · " + escapeHtml(voice.usage) + "</small>",
      "  <div class=\"tts-voice-card-actions\">",
      "    <button type=\"button\" data-voice-pick=\"" + escapeHtml(voice.value) + "\" data-voice-target=\"narrator\">设为旁白</button>",
      "    <button type=\"button\" data-voice-pick=\"" + escapeHtml(voice.value) + "\" data-voice-target=\"default\">设为默认 AI</button>",
      "  </div>",
      "</article>"
    ].join("");
  }).join("");
}

function updateRoleVoiceNote() {
  const note = $("role-voice-note");
  if (!note) {
    return;
  }
  const provider = $("role-tts-provider").value;
  const value = $("role-voice").value.trim();
  const info = voiceInfo(value, provider);
  note.textContent = info
    ? info.name + " · " + info.gender + " · " + info.style + " · " + info.language
    : (value
      ? "自定义音色：" + value
      : (provider === "doubao" ? "请选择或填写豆包音色 ID" : "请选择或填写千问 TTS 音色名"));
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
    ttsProvider: "qwen",
    voice: nextAvailableRoleVoice(null),
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
  $("role-tts-provider").value = source.ttsProvider === "doubao" ? "doubao" : "qwen";
  $("role-voice").value = source.voice || (role ? "" : nextAvailableRoleVoice(null));
  setRoleVoiceCatalog($("role-tts-provider").value);
  updateRoleVoiceNote();
  $("role-api-key").value = "";
  $("role-test-status").textContent = "";
  $("role-test-status").className = "role-test-status";
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

async function testRoleApi() {
  if (adminState.roleTesting) {
    return;
  }
  const model = $("role-model").value.trim();
  if (!model) {
    toast("请先填写模型名称。", true);
    return;
  }
  const provider = $("role-provider").value;
  const body = {
    provider,
    baseUrl: $("role-base-url").value.trim() || ADMIN_DEFAULTS[provider],
    model,
    roleId: adminState.editingId,
    clearApiKey: $("role-clear-key").checked
  };
  const apiKey = $("role-api-key").value.trim();
  if (apiKey) {
    body.apiKey = apiKey;
  }
  const button = $("test-role-api");
  const status = $("role-test-status");
  adminState.roleTesting = true;
  button.disabled = true;
  button.textContent = "测试中…";
  status.className = "role-test-status pending";
  status.textContent = "正在连接模型接口…";
  try {
    const result = await adminApi("/api/admin/roles/test", { method: "POST", body });
    status.className = "role-test-status success";
    status.textContent = "连接成功 · " + result.latencyMs + "ms · " + result.model + " · 回复：" + result.response;
    toast("模型连接测试成功，延迟 " + result.latencyMs + "ms。");
  } catch (error) {
    status.className = "role-test-status fail";
    status.textContent = "连接失败：" + error.message;
    toast(error.message, true);
  } finally {
    adminState.roleTesting = false;
    button.disabled = false;
    button.textContent = "测试连接";
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
    ttsProvider: $("role-tts-provider").value,
    voice: $("role-voice").value.trim() || ($("role-tts-provider").value === "doubao"
      ? doubaoDefaultVoice()
      : (nextAvailableRoleVoice(adminState.editingId) || "Cherry")),
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
      await loadTts();
      await loadDoubao();
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
  $("test-role-api").addEventListener("click", testRoleApi);
  $("delete-role").addEventListener("click", deleteRole);

  $("role-provider").addEventListener("change", () => {
    const provider = $("role-provider").value;
    const current = $("role-base-url").value.trim();
    if (!current || Object.values(ADMIN_DEFAULTS).includes(current)) {
      $("role-base-url").value = ADMIN_DEFAULTS[provider];
    }
    $("role-test-status").textContent = "";
    $("role-test-status").className = "role-test-status";
  });

  $("role-tts-provider").addEventListener("change", () => {
    setRoleVoiceCatalog($("role-tts-provider").value);
    updateRoleVoiceNote();
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
    const action = button.getAttribute("data-role-action");
    if (action === "edit") {
      openRoleDialog(role);
    } else if (action === "voice-preview") {
      previewRoleVoice(role, button);
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
  $("save-tts").addEventListener("click", () => saveTts(false));
  $("tts-test").addEventListener("click", testTts);
  $("save-doubao").addEventListener("click", () => saveDoubao(false));
  $("doubao-test").addEventListener("click", testDoubaoTts);
  $("doubao-auth-mode").addEventListener("change", () => {
    const mode = $("doubao-auth-mode").value === "apikey" ? "apikey" : "classic";
    const endpoint = $("doubao-endpoint").value.trim();
    if (!endpoint ||
        endpoint === "https://openspeech.bytedance.com/api/v1/tts" ||
        endpoint === "https://openspeech.bytedance.com/api/v3/tts/unidirectional") {
      $("doubao-endpoint").value = mode === "apikey"
        ? "https://openspeech.bytedance.com/api/v3/tts/unidirectional"
        : "https://openspeech.bytedance.com/api/v1/tts";
    }
    const catalog = doubaoCatalogFor(mode);
    if (!catalog.some((voice) => voice.value === $("doubao-voice-type").value.trim())) {
      $("doubao-voice-type").value = catalog[0].value;
    }
    toggleDoubaoAuthFields(mode);
    renderDoubaoCatalog(mode);
  });
  $("doubao-voice-grid").addEventListener("click", (event) => {
    const button = event.target.closest("[data-doubao-pick]");
    if (!button) {
      return;
    }
    const voice = button.getAttribute("data-doubao-pick");
    $("doubao-voice-type").value = voice;
    $("doubao-status").textContent = "默认豆包音色已设为 " + voice;
  });
  $("tts-voice-grid").addEventListener("click", (event) => {
    const button = event.target.closest("[data-voice-pick]");
    if (!button) {
      return;
    }
    const voice = button.getAttribute("data-voice-pick");
    if (button.getAttribute("data-voice-target") === "narrator") {
      $("tts-narrator-voice").value = voice;
      $("tts-status").textContent = "旁白音色已设为 " + voice;
    } else {
      $("tts-default-voice").value = voice;
      $("tts-status").textContent = "默认 AI 音色已设为 " + voice;
    }
  });
  $("role-voice").addEventListener("input", updateRoleVoiceNote);
  $("role-voice-preview").addEventListener("click", async () => {
    const button = $("role-voice-preview");
    try {
      await startTtsPreview({
        provider: $("role-tts-provider").value,
        voice: $("role-voice").value.trim(),
        text: rolePreviewText({ name: $("role-name").value.trim() }),
        button
      });
      toast("当前角色音色试听成功。");
    } catch (error) {
      toast(error.message, true);
    }
  });

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
  renderVoiceCatalog();
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
    await loadTts();
    await loadDoubao();
  } catch (error) {
    $("admin-password").value = "";
    showLogin();
  }
}

initialize();
