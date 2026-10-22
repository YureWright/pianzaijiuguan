"use strict";

const experience = window.TavernExperience;

const SEAT_POSITIONS = ["bottom", "left", "top", "right"];
const PROVIDER_DEFAULTS = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta"
};
const PROVIDER_LABELS = {
  openai: "OpenAI 兼容",
  anthropic: "Anthropic",
  gemini: "Gemini"
};
const SESSION_KEY = "liars-session-token";

const app = {
  sessionToken: null,
  account: null,
  usernameForced: false,
  pendingEnterAfterName: false,
  leaderboardData: null,
  leaderboardTab: "deception",
  leaderboardFetchedAt: 0,
  leaderboardLoading: false,
  leaderboardPromise: null,
  leaderboardGameoverKey: "",
  roomCode: null,
  playerId: null,
  playerToken: null,
  viewerId: null,
  room: null,
  eventSource: null,
  selected: new Set(),
  handSorted: false,
  actionPending: false,
  actionRequestId: 0,
  voidingGame: false,
  connected: false,
  serverOffset: 0,
  profiles: [],
  serverModelNames: [],
  aiRoles: [],
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  localStream: null,
  cameraOn: false,
  cameraStarting: false,
  cameraRequestId: 0,
  pc: null,
  remoteId: null,
  remoteSeat: null,
  remoteStream: null,
  remoteCameraOn: false,
  polite: false,
  makingOffer: false,
  ignoreOffer: false,
  isSettingRemoteAnswerPending: false,
  pendingIce: [],
  peerRetryTimer: null,
  peerRetryCount: 0,
  offerTimer: null,
  lastRevealId: null,
  lastLogId: null,
  lastChatKey: null,
  animationQueue: [],
  fxAnimating: false,
  fxGeneration: 0,
  toastTimer: null,
  audioContext: null,
  eventErrorTimer: null,
  voiceEnabled: experience.preferences.narration !== "off",
  musicConfig: null,
  musicUserEnabled: true,
  ttsConfig: null,
  voicePrefetch: new Map(),
  voiceRequests: new Set(),
  cancelCurrentVoice: null,
  voices: [],
  voiceQueue: [],
  voiceMetrics: { started: 0, completed: 0, fallbacks: 0 },
  speaking: false,
  voiceGeneration: 0,
  voiceEpoch: 0,
  currentVoiceItem: null,
  currentVoiceAudio: null,
  currentVoiceUrl: "",
  voiceTimers: [],
  lastSpokenThoughtKey: "",
  lastRoundThoughtsKey: "",
  gateLocked: false,
  activeSpeechId: null,
  ackedSpeechIds: new Set(),
  speechWatchdog: null,
  mindHideTimer: null,
  pendingVictoryState: null,
  victoryShowKey: "",
  victoryTimer: null,
  victoryCountdownTimer: null,
  victoryClosed: false,
  settlementFinishing: false,
  pendingDeathId: null,
  deathVisualApplied: false
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

function formatTime(timestamp) {
  try {
    return new Date(timestamp).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  } catch (error) {
    return "";
  }
}

async function apiRequest(path, options) {
  const opts = options || {};
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  let response;
  try {
    response = await fetch(path, {
      method: opts.method || "GET",
      headers: opts.body ? { "Content-Type": "application/json" } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      cache: "no-store",
      signal: controller.signal
    });
  } catch (error) {
    throw new Error(error.name === "AbortError" ? "响应有点慢，请稍后重试。" : "连接暂时中断，请检查网络。");
  } finally {
    clearTimeout(timeout);
  }
  let payload = {};
  try {
    payload = await response.json();
  } catch (error) {
    payload = {};
  }
  if (!response.ok) {
    const error = new Error(payload.error || "请求失败，请稍后再试。");
    error.code = payload.code || "";
    error.payload = payload;
    throw error;
  }
  return payload;
}

function showToast(message, danger) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.toggle("danger", Boolean(danger));
  toast.classList.add("show");
  clearTimeout(app.toastTimer);
  app.toastTimer = setTimeout(() => toast.classList.remove("show"), 3600);
}

function setConnectionStatus(text, offline) {
  const pill = $("connection-pill");
  pill.classList.toggle("offline", Boolean(offline));
  pill.innerHTML = "<i></i> " + escapeHtml(text);
}

function getNickname() {
  const input = $("player-name");
  const name = (input.value || "").trim().slice(0, 16) || "匿名赌徒";
  try {
    localStorage.setItem("liars-bar-name", name);
  } catch (error) {
    // Local storage is optional.
  }
  return name;
}

function loadNickname() {
  try {
    const stored = localStorage.getItem("liars-bar-name");
    if (stored) {
      $("player-name").value = stored;
    }
  } catch (error) {
    // Local storage is optional.
  }
}

function saveSessionToken(token) {
  app.sessionToken = token || null;
  try {
    if (token) {
      localStorage.setItem(SESSION_KEY, token);
    } else {
      localStorage.removeItem(SESSION_KEY);
    }
  } catch (error) {
    // Local storage is optional.
  }
}

function loadSessionToken() {
  try {
    return localStorage.getItem(SESSION_KEY) || "";
  } catch (error) {
    return "";
  }
}

function setAccount(account) {
  app.account = account || null;
  const loginForm = $("login-form");
  const panel = $("account-panel");
  if (!app.account) {
    loginForm.hidden = false;
    panel.hidden = true;
    return;
  }
  loginForm.hidden = true;
  panel.hidden = false;
  $("account-location").textContent = app.account.location;
  $("account-name").textContent = app.account.displayName;
  const stats = app.account.stats || {};
  $("account-hint").textContent = app.account.pendingRename
    ? "你已被淘汰。必须先更换用户名，才能参加下一局。"
    : "已赢 " + (stats.wins || 0) + " 局 · 成功欺骗 " + (stats.deceptions || 0) +
      " 次 · 最佳连胜 " + (stats.bestStreak || 0);
}

async function refreshAccount() {
  if (!app.sessionToken) {
    return null;
  }
  try {
    const payload = await apiRequest("/api/account/session", {
      method: "POST",
      body: { sessionToken: app.sessionToken }
    });
    setAccount(payload.account);
    return payload.account;
  } catch (error) {
    if (error.message.includes("失效")) {
      saveSessionToken("");
      setAccount(null);
    }
    return null;
  }
}

function openUsernameDialog(forced) {
  if (!app.account) {
    return;
  }
  app.usernameForced = Boolean(forced);
  $("username-location").textContent = app.account.location + " ·";
  $("username-input").value = "";
  $("username-reason").textContent = forced
    ? "你已被淘汰。死亡后必须更换用户名，且不能与另一位玩家重复。"
    : "用户名会自动加上地点前缀，并且不能与另一位玩家重复。";
  $("username-cancel").hidden = app.usernameForced;
  $("username-close").hidden = app.usernameForced;
  openDialog("username-dialog");
  setTimeout(() => $("username-input").focus(), 30);
}

async function submitUsername(event) {
  event.preventDefault();
  if (!app.sessionToken) {
    showToast("登录已失效，请重新登录。", true);
    return;
  }
  const username = $("username-input").value.trim();
  if (!username) {
    showToast("请输入用户名。", true);
    return;
  }
  const button = $("username-form").querySelector("button[type=submit]");
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "保存中...";
  try {
    const payload = await apiRequest("/api/account/username", {
      method: "POST",
      body: { sessionToken: app.sessionToken, username }
    });
    setAccount(payload.account);
    $("username-dialog").close();
    app.usernameForced = false;
    showToast("用户名已更新为 " + payload.account.displayName);
    if (app.pendingEnterAfterName) {
      app.pendingEnterAfterName = false;
      await enterTable();
    } else if (app.roomCode && app.room && app.room.phase === "gameover") {
      await enterTable();
    }
  } catch (error) {
    showToast(error.message, true);
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

async function loginAccount(event) {
  event.preventDefault();
  const button = $("login-form").querySelector("button[type=submit]");
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "登录中...";
  try {
    const payload = await apiRequest("/api/account/login", {
      method: "POST",
      body: {
        location: $("login-location").value,
        key: $("login-key").value.trim()
      }
    });
    saveSessionToken(payload.sessionToken);
    setAccount(payload.account);
    $("login-key").value = "";
    if (payload.account.needsUsername) {
      app.pendingEnterAfterName = true;
      openUsernameDialog(Boolean(payload.account.pendingRename));
    } else {
      await enterTable();
    }
  } catch (error) {
    showToast(error.message, true);
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

async function enterTable() {
  if (!app.sessionToken) {
    showToast("请先登录上海或杭州账户。", true);
    return;
  }
  try {
    const payload = await apiRequest("/api/table/enter", {
      method: "POST",
      body: { sessionToken: app.sessionToken }
    });
    if (payload.account) {
      setAccount(payload.account);
    }
    enterRoom(payload);
    if (payload.spectator) {
      showToast("当前牌局已开始，你正在观战。");
    }
  } catch (error) {
    if (error.code === "USERNAME_REQUIRED") {
      if (error.payload && error.payload.account) {
        setAccount(error.payload.account);
      }
      app.pendingEnterAfterName = true;
      openUsernameDialog(Boolean(app.account && app.account.pendingRename));
      return;
    }
    showToast(error.message, true);
  }
}

async function logoutAccount() {
  try {
    if (app.sessionToken) {
      await apiRequest("/api/account/logout", {
        method: "POST",
        body: { sessionToken: app.sessionToken }
      });
    }
  } catch (error) {
    // Logging out locally is still useful if the session already expired.
  }
  saveSessionToken("");
  setAccount(null);
  await leaveRoom(true);
  $("login-key").focus();
}

async function openLeaderboard() {
  openDialog("leaderboard-dialog");
  $("leaderboard-body").textContent = "正在读取排行榜...";
  try {
    await fetchLeaderboard(true);
  } catch (error) {
    $("leaderboard-body").innerHTML = "<div class=\"board-empty\">排行榜读取失败：" + escapeHtml(error.message) + "</div>";
  }
}

async function fetchLeaderboard(force) {
  if (app.leaderboardLoading && app.leaderboardPromise) {
    return app.leaderboardPromise;
  }
  if (!force && app.leaderboardData && Date.now() - app.leaderboardFetchedAt < 15000) {
    renderLeaderboard();
    return app.leaderboardData;
  }
  app.leaderboardLoading = true;
  app.leaderboardPromise = apiRequest("/api/leaderboard").then((data) => {
    app.leaderboardData = data;
    app.leaderboardFetchedAt = Date.now();
    renderLeaderboard();
    return data;
  }).finally(() => {
    app.leaderboardLoading = false;
    app.leaderboardPromise = null;
  });
  return app.leaderboardPromise;
}

async function ensureSideLeaderboard(force) {
  const panel = $("side-leaderboard");
  if (!panel) {
    return;
  }
  if (!app.leaderboardData) {
    panel.innerHTML = "<div class=\"board-empty\">正在读取排行榜...</div>";
  }
  try {
    await fetchLeaderboard(Boolean(force));
  } catch (error) {
    if (!app.leaderboardData) {
      panel.innerHTML = "<div class=\"board-empty\">排行榜读取失败</div>";
    }
  }
}

function leaderboardView(data) {
  document.querySelectorAll("[data-board]").forEach((button) => {
    button.classList.toggle("active", button.getAttribute("data-board") === app.leaderboardTab);
  });
  document.querySelectorAll("[data-side-board]").forEach((button) => {
    button.classList.toggle("active", button.getAttribute("data-side-board") === app.leaderboardTab);
  });
  if (app.leaderboardTab === "ai") {
    const rows = (data.ai || []).map((entry, index) => ({
      name: entry.name,
      value: Math.round(entry.winRate * 100) + "%",
      detail: entry.wins + " 胜 / " + entry.games + " 局",
      avatar: entry.portraitUrl || entry.avatarUrl || ""
    }));
    return { rows, title: "AI 胜率", detail: "胜率相同按胜场排序" };
  }
  const users = (data.users || []).slice();
  let rows;
  let title;
  let detail;
  if (app.leaderboardTab === "kills") {
    users.sort((left, right) => (right.kills - left.kills) || (right.wins - left.wins));
    title = "成功击杀";
    detail = "质疑击杀 + 被质疑时反杀";
    rows = users.map((entry) => ({
      name: entry.displayName,
      value: String(entry.kills || 0),
      detail: "质疑击杀 " + (entry.challengeKills || 0) + " · 质疑失败反杀 " + (entry.failedChallengeKills || 0)
    }));
  } else if (app.leaderboardTab === "streak") {
    users.sort((left, right) => (right.bestStreak - left.bestStreak) || (right.wins - left.wins));
    title = "最多连续获胜";
    detail = "失败即中断连胜，死亡后必须更换用户名";
    rows = users.map((entry) => ({
      name: entry.displayName,
      value: String(entry.bestStreak || 0),
      detail: "当前连胜 " + (entry.currentStreak || 0) + " · 累计胜场 " + (entry.wins || 0)
    }));
  } else {
    users.sort((left, right) => (right.deception - left.deception) || (right.wins - left.wins));
    title = "最多成功欺骗";
    detail = "说谎后未被成功质疑";
    rows = users.map((entry) => ({
      name: entry.displayName,
      value: String(entry.deception || 0),
      detail: "累计胜场 " + (entry.wins || 0) + " · 参赛 " + (entry.gamesPlayed || 0) + " 局"
    }));
  }
  return { rows, title, detail };
}

function renderLeaderboard() {
  const body = $("leaderboard-body");
  const side = $("side-leaderboard");
  const data = app.leaderboardData;
  if (!data) {
    if (body) body.innerHTML = "<div class=\"board-empty\">暂无排行榜数据。</div>";
    if (side) side.innerHTML = "<div class=\"board-empty\">暂无排行榜数据。</div>";
    return;
  }
  const view = leaderboardView(data);
  const markup = boardMarkup(view.rows, view.title, view.detail);
  if (body) body.innerHTML = markup;
  if (side) side.innerHTML = markup;
}

function boardMarkup(rows, title, detail) {
  if (!rows || rows.length === 0) {
    return "<div class=\"board-empty\">还没有数据，先打一局吧。</div>";
  }
  return [
    "<div class=\"board-heading\"><strong>" + escapeHtml(title) + "</strong><small>" + escapeHtml(detail) + "</small></div>",
    "<div class=\"board-list\">",
    rows.map((entry, index) => {
      const avatar = entry.avatar
        ? "<span class=\"board-avatar\"><img src=\"" + escapeHtml(entry.avatar) + "\" alt=\"\"></span>"
        : "<span class=\"board-avatar board-avatar-empty\">♠</span>";
      return "<div class=\"board-row\"><span class=\"board-place\">" + (index + 1) + "</span>" +
        avatar + "<span class=\"board-person\"><strong>" + escapeHtml(entry.name) + "</strong><small>" +
        escapeHtml(entry.detail) + "</small></span><b class=\"board-value\">" + escapeHtml(entry.value) + "</b></div>";
    }).join(""),
    "</div>"
  ].join("");
}

function queueVictorySettlement(state) {
  const gameoverLog = state.log.slice().reverse().find((entry) => entry.type === "gameover");
  const key = gameoverLog ? gameoverLog.id : (state.winnerId || "none") + ":" + (state.roundResult || "");
  if (key === app.victoryShowKey) {
    return;
  }
  app.victoryShowKey = key;
  app.pendingVictoryState = state;
  app.victoryClosed = false;
  app.pendingDeathId = null;
  app.deathVisualApplied = false;
  maybeShowVictorySettlement();
}

function maybeShowVictorySettlement() {
  const voiceBusy = app.speaking || app.voiceQueue.length > 0 || app.currentVoiceItem ||
    app.voiceTimers.length > 0 || animationsBlockedByVoice();
  if (!app.pendingVictoryState || app.fxAnimating || app.animationQueue.length > 0 || voiceBusy) {
    return;
  }
  const state = app.pendingVictoryState;
  app.pendingVictoryState = null;
  showVictorySettlement(state);
}

function showVictorySettlement(state) {
  const dialog = $("victory-dialog");
  const winner = state.players.find((player) => player.id === state.winnerId) || null;
  if (winner && (winner.portraitUrl || winner.avatarUrl)) {
    $("victory-portrait").innerHTML = "<img src=\"" + escapeHtml(winner.portraitUrl || winner.avatarUrl) + "\" alt=\"\">";
  } else {
    $("victory-portrait").textContent = winner ? (winner.emoji || "♠") : "♠";
  }
  $("victory-name").textContent = state.winnerName || "无人";
  $("victory-result").textContent = state.roundResult || "牌局结束";
  const ranked = state.players
    .filter((player) => player.occupied)
    .slice()
    .sort((left, right) => {
      if (left.id === state.winnerId) return -1;
      if (right.id === state.winnerId) return 1;
      return left.seat - right.seat;
    });
  $("victory-ranking").innerHTML = ranked.map((player) => {
    const isWinner = player.id === state.winnerId;
    return "<div class=\"victory-row" + (isWinner ? " winner" : "") + "\">" +
      "<span class=\"victory-place\">" + (isWinner ? "♛" : "席" + (player.seat + 1)) + "</span>" +
      "<span class=\"victory-row-name\">" + escapeHtml(player.name) + "</span>" +
      "<span class=\"victory-row-tag\">" + (isWinner ? "胜者" : (player.alive ? "存活" : "出局")) + "</span></div>";
  }).join("");
  clearTimeout(app.victoryTimer);
  clearInterval(app.victoryCountdownTimer);
  let remaining = 12;
  $("victory-countdown").textContent = remaining + "s";
  app.victoryCountdownTimer = setInterval(() => {
    remaining = Math.max(0, remaining - 1);
    $("victory-countdown").textContent = remaining + "s";
  }, 1000);
  if (!dialog.open) {
    dialog.showModal();
  }
  app.victoryTimer = setTimeout(finishVictorySettlement, 12000);
}

async function finishVictorySettlement() {
  if (app.victoryClosed) {
    return;
  }
  app.victoryClosed = true;
  app.settlementFinishing = true;
  const settlementKey = app.victoryShowKey;
  if (app.room) renderActionBar(app.room);
  clearTimeout(app.victoryTimer);
  clearInterval(app.victoryCountdownTimer);
  app.victoryTimer = null;
  app.victoryCountdownTimer = null;
  const dialog = $("victory-dialog");
  if (dialog && dialog.open) {
    dialog.close();
  }
  try {
    await new Promise((resolve) => setTimeout(resolve, 260));
    if (!app.sessionToken) return;
    const account = await refreshAccount();
    if (settlementKey !== app.victoryShowKey || !app.room || app.room.phase !== "gameover") return;
    if (account && account.pendingRename) openUsernameDialog(true);
  } finally {
    if (settlementKey === app.victoryShowKey) {
      app.settlementFinishing = false;
      if (app.room) renderActionBar(app.room);
    }
  }
}

function createLocalProfile(overrides) {
  const source = overrides || {};
  return {
    id: "local-" + Math.random().toString(36).slice(2) + Date.now().toString(36),
    name: source.name || source.model || "新模型",
    provider: source.provider || "openai",
    baseUrl: source.baseUrl || PROVIDER_DEFAULTS[source.provider || "openai"],
    model: source.model || "",
    apiKey: source.apiKey || ""
  };
}

function renderModelSummary() {
  const summary = $("model-summary");
  const text = $("model-summary-text");
  if (app.aiRoles.length > 0) {
    summary.classList.add("active");
    text.textContent = "管理员已启用 " + app.aiRoles.length + " 位 AI：" + app.aiRoles.map((role) => role.name).join(" / ");
    return;
  }
  summary.classList.remove("active");
  text.textContent = "管理员尚未启用 AI 角色";
}

function avatarMarkup(role, className) {
  if (role && (role.portraitUrl || role.avatarUrl)) {
    return "<span class=\"" + className + "\"><img src=\"" + escapeHtml(role.portraitUrl || role.avatarUrl) + "\" alt=\"\"></span>";
  }
  return "<span class=\"" + className + "\">" + escapeHtml(role && role.avatarEmoji ? role.avatarEmoji : "🎲") + "</span>";
}

function renderAiRoster() {
  const list = $("ai-roster-list");
  if (!list) {
    return;
  }
  if (app.aiRoles.length === 0) {
    list.innerHTML = "<div class=\"model-empty\">管理员尚未启用 AI 角色。</div>";
    return;
  }
  list.innerHTML = app.aiRoles.map((role) => {
    return [
      "<div class=\"ai-roster-card\">",
      avatarMarkup(role, "ai-roster-avatar"),
      "  <div class=\"ai-roster-info\">",
      "    <strong>" + escapeHtml(role.name) + "</strong>",
      "    <small>" + escapeHtml((role.provider || "") + " · " + (role.model || "")) + "</small>",
      "  </div>",
      "</div>"
    ].join("");
  }).join("");
}

function renderModelList() {
  const list = $("model-list");
  if (app.profiles.length === 0) {
    list.innerHTML = "<div class=\"model-empty\">还没有模型配置。用上方 URL + Key 一键导入，或手动添加一个。</div>";
    return;
  }
  list.innerHTML = app.profiles.map((profile) => {
    const options = Object.keys(PROVIDER_LABELS).map((provider) => {
      const selected = provider === profile.provider ? " selected" : "";
      return "<option value=\"" + provider + "\"" + selected + ">" + PROVIDER_LABELS[provider] + "</option>";
    }).join("");
    return [
      "<div class=\"model-item\" data-profile-id=\"" + escapeHtml(profile.id) + "\">",
      "  <div class=\"model-item-head\">",
      "    <strong>" + escapeHtml(profile.name || profile.model || "未命名模型") + "</strong>",
      "    <button class=\"remove-model\" type=\"button\" data-remove-profile>移除</button>",
      "  </div>",
      "  <div class=\"model-fields\">",
      "    <label>供应商<select data-field=\"provider\">" + options + "</select></label>",
      "    <label>显示名称<input data-field=\"name\" maxlength=\"24\" value=\"" + escapeHtml(profile.name) + "\"></label>",
      "    <label class=\"wide\">接口 URL<input data-field=\"baseUrl\" spellcheck=\"false\" value=\"" + escapeHtml(profile.baseUrl) + "\"></label>",
      "    <label>模型名称<input data-field=\"model\" spellcheck=\"false\" value=\"" + escapeHtml(profile.model) + "\" placeholder=\"gpt-4.1-mini\"></label>",
      "    <label>API Key<input data-field=\"apiKey\" type=\"password\" spellcheck=\"false\" value=\"" + escapeHtml(profile.apiKey) + "\" placeholder=\"留空可用于本地端点\"></label>",
      "  </div>",
      "</div>"
    ].join("");
  }).join("");
}

function renderAllProfiles() {
  renderAiRoster();
  renderModelSummary();
}

function openDialog(id) {
  const dialog = $(id);
  if (dialog && typeof dialog.showModal === "function") {
    if (!dialog.open) {
      dialog.showModal();
    }
  }
}

function wireDialogs() {
  $("settings-button").addEventListener("click", () => {
    renderAllProfiles();
    openDialog("settings-dialog");
  });
  $("summary-settings").addEventListener("click", () => {
    renderAllProfiles();
    openDialog("settings-dialog");
  });
  $("rules-button").addEventListener("click", () => openDialog("rules-dialog"));
  $("leaderboard-button").addEventListener("click", openLeaderboard);
  $("board-tabs").addEventListener("click", (event) => {
    const button = event.target.closest("[data-board]");
    if (!button) {
      return;
    }
    app.leaderboardTab = button.getAttribute("data-board");
    renderLeaderboard();
  });
  $("side-board-tabs").addEventListener("click", (event) => {
    const button = event.target.closest("[data-side-board]");
    if (!button) {
      return;
    }
    app.leaderboardTab = button.getAttribute("data-side-board");
    if (app.leaderboardData) {
      renderLeaderboard();
    } else {
      ensureSideLeaderboard(true);
    }
  });
  document.querySelectorAll("[data-close-dialog]").forEach((button) => {
    button.addEventListener("click", () => {
      const dialog = $(button.getAttribute("data-close-dialog"));
      if (dialog) {
        dialog.close();
      }
    });
  });
  document.querySelectorAll("dialog").forEach((dialog) => {
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) {
        if (dialog.id === "username-dialog" && app.usernameForced) {
          return;
        }
        dialog.close();
      }
    });
  });
  $("username-dialog").addEventListener("cancel", (event) => {
    if (app.usernameForced) {
      event.preventDefault();
    }
  });
  $("victory-continue").addEventListener("click", finishVictorySettlement);
  $("victory-dialog").addEventListener("close", () => finishVictorySettlement());
}

function wireModelSettings() {
  $("quick-import-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const provider = $("import-provider").value;
    const model = $("import-model").value.trim();
    if (!model) {
      showToast("请填写模型名称，例如 gpt-4.1-mini。", true);
      $("import-model").focus();
      return;
    }
    const profile = createLocalProfile({
      name: $("import-name").value.trim() || model,
      provider,
      baseUrl: $("import-url").value.trim() || PROVIDER_DEFAULTS[provider],
      model,
      apiKey: $("import-key").value.trim()
    });
    app.profiles.push(profile);
    $("import-name").value = "";
    $("import-url").value = "";
    $("import-key").value = "";
    $("import-model").value = "";
    renderAllProfiles();
    showToast("模型已导入。开桌时会分配给 AI 席位。");
  });

  $("add-model").addEventListener("click", () => {
    app.profiles.push(createLocalProfile());
    renderAllProfiles();
  });

  $("clear-models").addEventListener("click", () => {
    app.profiles = [];
    renderAllProfiles();
  });

  $("model-list").addEventListener("input", (event) => {
    const field = event.target.closest("[data-field]");
    const item = event.target.closest("[data-profile-id]");
    if (!field || !item) {
      return;
    }
    const profile = app.profiles.find((entry) => entry.id === item.getAttribute("data-profile-id"));
    if (!profile) {
      return;
    }
    const key = field.getAttribute("data-field");
    profile[key] = field.value;
    if (key === "name") {
      const heading = item.querySelector(".model-item-head strong");
      if (heading) {
        heading.textContent = profile.name || profile.model || "未命名模型";
      }
    }
    if (key === "provider" && !field.dataset.touchedUrl) {
      const urlField = item.querySelector("[data-field=\"baseUrl\"]");
      if (urlField && !urlField.value.trim()) {
        urlField.value = PROVIDER_DEFAULTS[profile.provider];
        profile.baseUrl = urlField.value;
      }
    }
    renderModelSummary();
  });

  $("model-list").addEventListener("change", (event) => {
    const select = event.target.closest("select[data-field=\"provider\"]");
    const item = event.target.closest("[data-profile-id]");
    if (!select || !item) {
      return;
    }
    const profile = app.profiles.find((entry) => entry.id === item.getAttribute("data-profile-id"));
    if (!profile) {
      return;
    }
    profile.provider = select.value;
    const urlField = item.querySelector("[data-field=\"baseUrl\"]");
    if (urlField) {
      const isDefault = !urlField.value.trim() || Object.values(PROVIDER_DEFAULTS).includes(urlField.value.trim());
      if (isDefault) {
        urlField.value = PROVIDER_DEFAULTS[profile.provider];
        profile.baseUrl = urlField.value;
      }
    }
  });

  $("model-list").addEventListener("click", (event) => {
    const remove = event.target.closest("[data-remove-profile]");
    const item = event.target.closest("[data-profile-id]");
    if (!remove || !item) {
      return;
    }
    app.profiles = app.profiles.filter((profile) => profile.id !== item.getAttribute("data-profile-id"));
    renderAllProfiles();
  });
}

function resetHome() {
  document.body.dataset.page = "home";
  app.connected = false;
  app.actionPending = false;
  app.actionRequestId += 1;
  $("connection-banner").hidden = true;
  app.room = null;
  app.roomCode = null;
  app.playerId = null;
  app.playerToken = null;
  app.viewerId = null;
  app.selected.clear();
  app.lastRevealId = null;
  app.lastLogId = null;
  app.lastChatKey = null;
  app.animationQueue = [];
  app.fxAnimating = false;
  app.fxGeneration += 1;
  cancelVoice();
  pauseBackgroundMusic();
  app.lastSpokenThoughtKey = "";
  app.lastRoundThoughtsKey = "";
  app.activeSpeechId = null;
  app.ackedSpeechIds.clear();
  clearTimeout(app.speechWatchdog);
  clearTimeout(app.mindHideTimer);
  clearTimeout(app.victoryTimer);
  clearInterval(app.victoryCountdownTimer);
  app.speechWatchdog = null;
  app.mindHideTimer = null;
  app.pendingVictoryState = null;
  app.victoryShowKey = "";
  app.victoryTimer = null;
  app.victoryCountdownTimer = null;
  app.victoryClosed = false;
  const overlay = $("table-fx");
  if (overlay) {
    overlay.className = "table-fx";
    overlay.innerHTML = "";
    overlay.setAttribute("aria-hidden", "true");
  }
  const mind = $("ai-mind-panel");
  if (mind) {
    mind.hidden = true;
    mind.className = "ai-mind-panel";
  }
  $("room-view").hidden = true;
  $("home-view").hidden = false;
  setConnectionStatus("本地牌局", false);
  document.title = "骗子酒馆 | LIARS BAR";
}

function enterRoom(data) {
  document.body.dataset.page = "room";
  app.roomCode = data.roomCode;
  app.playerId = data.playerId || null;
  app.playerToken = data.playerToken || null;
  app.viewerId = data.viewerId;
  app.selected.clear();
  app.lastRevealId = null;
  app.lastLogId = null;
  app.lastChatKey = null;
  app.animationQueue = [];
  app.fxAnimating = false;
  app.fxGeneration += 1;
  $("home-view").hidden = true;
  $("room-view").hidden = false;
  $("room-code-label").textContent = "主桌";
  window.scrollTo({ top: 0, behavior: "instant" });
  $("copy-code").hidden = true;
  if (data.account) {
    setAccount(data.account);
  }
  $("chat-input").disabled = Boolean(data.spectator);
  if (data.spectator) {
    $("chat-input").placeholder = "观战模式";
  } else {
    $("chat-input").placeholder = "说点什么...";
  }
  connectEvents();
  playBackgroundMusic();
}

async function createRoom(demo) {
  const button = demo ? $("demo-button") : $("create-form").querySelector("button");
  const original = button.innerHTML;
  button.disabled = true;
  button.innerHTML = "正在开桌...";
  try {
    const payload = await apiRequest("/api/rooms", {
      method: "POST",
      body: {
        name: getNickname(),
        demo: Boolean(demo)
      }
    });
    enterRoom(payload);
  } catch (error) {
    showToast(error.message, true);
  } finally {
    button.disabled = false;
    button.innerHTML = original;
  }
}

async function joinRoom() {
  const code = $("room-code-input").value.trim().toUpperCase();
  if (!/^[A-Z0-9]{5}$/.test(code)) {
    showToast("请输入 5 位房间码。", true);
    return;
  }
  const button = $("join-form").querySelector("button");
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "加入中...";
  try {
    const payload = await apiRequest("/api/rooms/" + encodeURIComponent(code) + "/join", {
      method: "POST",
      body: { name: getNickname() }
    });
    enterRoom(payload);
    if (payload.spectator) {
      showToast("对局已开始或真人席位已满，已进入观战模式。");
    }
  } catch (error) {
    showToast(error.message, true);
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

async function leaveRoom(silent) {
  const code = app.roomCode;
  const playerId = app.playerId;
  const token = app.playerToken;
  closeEvents();
  stopCamera();
  closePeer();
  resetHome();
  if (!silent && code && playerId) {
    try {
      await apiRequest("/api/rooms/" + encodeURIComponent(code) + "/leave", {
        method: "POST",
        body: { playerId, token }
      });
    } catch (error) {
      // Leaving is best effort.
    }
  }
}

function closeEvents() {
  clearTimeout(app.eventErrorTimer);
  app.eventErrorTimer = null;
  if (app.eventSource) {
    app.eventSource.close();
    app.eventSource = null;
  }
}

function connectEvents() {
  closeEvents();
  const params = new URLSearchParams();
  params.set("viewerId", app.viewerId || "");
  if (app.playerId) {
    params.set("playerId", app.playerId);
  }
  if (app.playerToken) {
    params.set("token", app.playerToken);
  }
  const source = new EventSource("/api/rooms/" + encodeURIComponent(app.roomCode) + "/events?" + params.toString());
  app.eventSource = source;
  source.addEventListener("open", () => {
    app.connected = true;
    $("connection-banner").hidden = true;
    clearTimeout(app.eventErrorTimer);
    app.eventErrorTimer = null;
    setConnectionStatus("实时连接", false);
    if (app.room) renderActionBar(app.room);
  });
  source.addEventListener("state", (event) => {
    try {
      handleState(JSON.parse(event.data));
    } catch (error) {
      showToast("牌桌状态解析失败。", true);
    }
  });
  source.addEventListener("ai-thought", (event) => {
    try {
      handleAiThought(JSON.parse(event.data));
    } catch (error) {
      // Ignore a malformed thought chunk and wait for the next one.
    }
  });
  source.addEventListener("signal", (event) => {
    try {
      handlePeerSignal(JSON.parse(event.data));
    } catch (error) {
      // Ignore malformed signaling packets.
    }
  });
  source.addEventListener("error", () => {
    app.connected = false;
    $("connection-banner").hidden = false;
    if (app.room) renderActionBar(app.room);
    setConnectionStatus("正在重连", true);
    clearTimeout(app.eventErrorTimer);
    app.eventErrorTimer = setTimeout(() => {
      if (app.roomCode && source.readyState !== EventSource.OPEN) {
        setConnectionStatus("连接中断 · 正在重连", true);
      }
    }, 12000);
  });
}

function handleState(state) {
  const previous = app.room;
  const isFirst = !previous;
  const previousPhase = previous ? previous.phase : null;
  if (state.phase === "gameover" && previousPhase !== "gameover") app.victoryClosed = false;
  if (previousPhase === "gameover" && state.phase !== "gameover") {
    app.victoryClosed = true;
    app.settlementFinishing = false;
    app.pendingVictoryState = null;
    app.victoryShowKey = "";
    clearTimeout(app.victoryTimer);
    clearInterval(app.victoryCountdownTimer);
    const victory = $("victory-dialog");
    if (victory && victory.open) victory.close();
  }
  if (previous && ["playing", "out_challenge"].includes(previous.phase) && state.phase === "lobby") {
    resetAfterVoid();
  }
  app.room = state;
  app.roomCode = state.code;
  app.serverOffset = (state.serverTime || Date.now()) - Date.now();
  if (previous && (state.round !== previous.round ||
    (state.phase !== previous.phase && ["lobby", "gameover", "out_challenge"].includes(state.phase)))) {
    app.selected.clear();
  }
  if (state.me) {
    app.playerId = state.me.id;
  }
  const handIds = new Set((state.me && state.me.hand ? state.me.hand : []).map((card) => card.id));
  for (const id of Array.from(app.selected)) {
    if (!handIds.has(id)) {
      app.selected.delete(id);
    }
  }
  renderRoom();
  syncPeer(state);
  handlePendingSpeech(state);
  if (isFirst) {
    app.lastLogId = state.log.length > 0 ? state.log[state.log.length - 1].id : null;
    app.lastRevealId = state.lastReveal ? state.lastReveal.id : null;
    if (state.phase === "gameover") queueVictorySettlement(state);
    return;
  }

  let revealQueued = false;
  for (const entry of newLogEntries(state)) {
    if (entry.type === "play") {
      const pending = state.pendingSpeech;
      enqueueFx({
        type: "play",
        playerId: entry.playerId || "",
        playerName: entry.playerName || "",
        count: entry.count || 1,
        claimRank: entry.claimRank || state.tableRank,
        speech: entry.speech || "",
        suppressSpeech: Boolean(pending && pending.playerId === entry.playerId && pending.text === entry.speech)
      });
    } else if (entry.type === "round") {
      enqueueFx({
        type: "round",
        round: entry.round || state.round,
        rank: entry.rank || state.tableRank,
        suit: entry.suit || "♠"
      });
    } else if ((entry.type === "challenge" || entry.type === "death") && !revealQueued &&
      state.lastReveal && state.lastReveal.id !== app.lastRevealId) {
      enqueueChallengeFx(state.lastReveal, state.pendingSpeech, state.cinematicId);
      revealQueued = true;
    } else if (entry.type === "gameover") {
      enqueueFx({
        type: "gameover",
        winnerName: entry.winnerName || state.winnerName || "无人",
        text: entry.text || state.roundResult || ""
      });
    }
  }
  if (state.lastReveal && state.lastReveal.id !== app.lastRevealId && !revealQueued) {
    enqueueChallengeFx(state.lastReveal, state.pendingSpeech, state.cinematicId);
  }
  if (state.phase === "gameover" && previousPhase !== "gameover" &&
    !newLogEntries(state).some((entry) => entry.type === "gameover")) {
    enqueueFx({
      type: "gameover",
      winnerName: state.winnerName || "无人",
      text: state.roundResult || ""
    });
  }
  app.lastRevealId = state.lastReveal ? state.lastReveal.id : app.lastRevealId;
  app.lastLogId = state.log.length > 0 ? state.log[state.log.length - 1].id : app.lastLogId;
  if (state.phase === "gameover") queueVictorySettlement(state);
  maybeShowVictorySettlement();
}

function newLogEntries(state) {
  if (!state.log || state.log.length === 0) {
    return [];
  }
  if (!app.lastLogId) {
    return state.log.slice(-1);
  }
  const index = state.log.findIndex((entry) => entry.id === app.lastLogId);
  if (index < 0) {
    return state.log.slice(-1);
  }
  return state.log.slice(index + 1);
}

function enqueueFx(event) {
  const narration = narrationForEvent(event);
  if (narration) {
    const profile = resolveTtsProfile(narration.roleName);
    prefetchVoice({
      text: narration.text,
      voice: profile.voice,
      roleId: profile.roleId,
      roleName: narration.roleName
    });
  }
  app.animationQueue.push(event);
  processFxQueue();
}

function animationsBlockedByVoice() {
  return Boolean(app.activeSpeechId || (app.room && app.room.pendingSpeech));
}

function waitForNarrationEnd() {
  if (!app.voiceEnabled || (!app.speaking && !app.currentVoiceItem && app.voiceQueue.length === 0 && app.voiceTimers.length === 0)) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const started = Date.now();
    const generation = app.fxGeneration;
    const check = () => {
      if (generation !== app.fxGeneration || Date.now() - started > 6500 ||
        (!app.speaking && !app.currentVoiceItem && app.voiceQueue.length === 0 && app.voiceTimers.length === 0)) {
        resolve();
        return;
      }
      setTimeout(check, 150);
    };
    check();
  });
}

async function acknowledgeCinematic(cinematicId) {
  if (!cinematicId) {
    return;
  }
  if (!app.playerId || !app.playerToken || !app.roomCode) {
    return;
  }
  try {
    await apiRequest("/api/rooms/" + encodeURIComponent(app.roomCode) + "/animation-done", {
      method: "POST",
      body: {
        playerId: app.playerId,
        token: app.playerToken,
        cinematicId
      }
    });
  } catch (error) {
    // The server fallback releases the table if an acknowledgement is lost.
  }
}

function enqueueChallengeFx(reveal, pending, cinematicId) {
  if (reveal.shot) {
    app.pendingDeathId = reveal.loserId;
    app.deathVisualApplied = false;
    if (app.room) {
      renderSeats(app.room);
    }
  }
  const suppressSpeech = Boolean(pending && pending.text === reveal.speech &&
    pending.playerId === reveal.challengerId);
  enqueueFx({ type: "challenge", reveal, suppressSpeech });
  enqueueFx({ type: "reveal", reveal, suppressSpeech });
  enqueueFx({ type: "execution", reveal, cinematicId, suppressSpeech: true });
}

function getTableEffectLayer() {
  const stage = $("table-stage");
  if (!stage) {
    return null;
  }
  let layer = $("table-effect-layer");
  if (!layer) {
    layer = document.createElement("div");
    layer.id = "table-effect-layer";
    layer.className = "table-effect-layer";
    stage.appendChild(layer);
  }
  return layer;
}

function tablePoint(rect, stageRect) {
  return {
    x: rect.left + rect.width / 2 - stageRect.left,
    y: rect.top + rect.height / 2 - stageRect.top
  };
}

async function runPlayTableEffect(event, layer) {
  const generation = app.fxGeneration;
  const stage = $("table-stage");
  const targetEl = $("center-panel");
  if (!stage || !targetEl) {
    return;
  }
  const stageRect = stage.getBoundingClientRect();
  const target = tablePoint(targetEl.getBoundingClientRect(), stageRect);
  const actor = app.room && app.room.players.find((player) => player.id === event.playerId);
  let sourceEl = actor ? document.querySelector(".seat[data-seat=\"" + actor.seat + "\"]") : null;
  if (actor && app.room && app.room.me && actor.id === app.room.me.id) {
    sourceEl = $("hand-row") || sourceEl;
  }
  const source = sourceEl ? tablePoint(sourceEl.getBoundingClientRect(), stageRect) : { x: target.x, y: stageRect.height + 80 };
  const count = Math.max(1, Math.min(3, Number(event.count) || 1));
  stage.classList.add("cards-in-flight");
  for (let index = 0; index < count; index += 1) {
    const card = document.createElement("i");
    card.className = "table-fly-card";
    card.style.left = target.x + "px";
    card.style.top = target.y + "px";
    card.style.setProperty("--from-x", (source.x - target.x) + "px");
    card.style.setProperty("--from-y", (source.y - target.y) + "px");
    card.style.setProperty("--delay", (index * 90) + "ms");
    layer.appendChild(card);
  }
  const stamp = document.createElement("div");
  stamp.className = "table-action-stamp";
  stamp.innerHTML = "<b>" + count + "</b><span>张 · 宣称 " + escapeHtml(event.claimRank) + "</span>";
  layer.appendChild(stamp);
  experience.accelerate(layer, 2);
  await new Promise((resolve) => setTimeout(resolve, experience.duration(950, 160)));
  if (generation !== app.fxGeneration) return;
  stage.classList.remove("cards-in-flight");
  layer.innerHTML = "";
}

async function runChallengeTableEffect(event, layer) {
  const generation = app.fxGeneration;
  const reveal = event.reveal;
  layer.innerHTML = [
    "<div class=\"table-challenge-impact\">",
    "  <div class=\"table-challenge-word\">质疑</div>",
    "  <div class=\"table-challenge-names\">" + escapeHtml(reveal.challengerName) + " → " + escapeHtml(reveal.claimantName) + "</div>",
    "</div>",
    "<div class=\"table-challenge-ring\"></div>"
  ].join("");
  if (app.room) {
    flashSeat(reveal.challengerId, "action-flash");
  }
  experience.accelerate(layer, 2);
  await new Promise((resolve) => setTimeout(resolve, experience.duration(650, 180)));
  if (generation !== app.fxGeneration) return;
  layer.innerHTML = "";
}

async function runRevealTableEffect(event, layer) {
  const generation = app.fxGeneration;
  const reveal = event.reveal;
  const cards = reveal.cards.map((card, index) => {
    return "<div class=\"fx-flip-card\" style=\"--delay:" + (index * 130) + "ms\">" +
      "<div class=\"fx-flip-inner\"><div class=\"fx-flip-back\"></div><div class=\"fx-flip-front\">" +
      cardMarkup(card.rank, card.suit, card.red, false, card.wild, card.label) +
      "</div></div></div>";
  }).join("");
  layer.innerHTML = [
    "<div class=\"table-reveal-inline\">",
    "  <div class=\"table-reveal-verdict " + (reveal.truthful ? "truth" : "lie") + "\">" +
      "<b>" + (reveal.truthful ? "质疑失败" : "质疑成功") + "</b>" +
      "<small>" + (reveal.truthful ? "亮牌属实" : "抓到谎言") + "</small></div>",
    "  <div class=\"table-reveal-cards\">" + cards + "</div>",
    "</div>"
  ].join("");
  const stage = $("table-stage");
  if (stage) {
    stage.classList.add("reveal-active");
  }
  experience.accelerate(layer, 1.5);
  await new Promise((resolve) => setTimeout(resolve, experience.duration(1800, 950)));
  if (generation !== app.fxGeneration) return null;
  return stage;
}

function clearRevealTableEffect(layer, stage) {
  if (layer) {
    layer.innerHTML = "";
  }
  if (stage) {
    stage.classList.remove("reveal-active");
  }
}

async function runTableEffect(event) {
  const layer = getTableEffectLayer();
  if (!layer) {
    await new Promise((resolve) => setTimeout(resolve, 700));
    return;
  }
  layer.innerHTML = "";
  if (event.type === "play") {
    await runPlayTableEffect(event, layer);
    if (app.room && event.playerId) {
      flashSeat(event.playerId, "action-flash");
    }
    return;
  }
  if (event.type === "challenge") {
    await runChallengeTableEffect(event, layer);
    return;
  }
  if (event.type === "reveal") {
    const stage = await runRevealTableEffect(event, layer);
    clearRevealTableEffect(layer, stage);
    return;
  }
  if (event.type === "round") {
    layer.innerHTML = "<div class=\"table-round-ripple\"></div>";
    await new Promise((resolve) => setTimeout(resolve, experience.duration(700, 150)));
    layer.innerHTML = "";
    return;
  }
  if (event.type === "gameover") {
    layer.innerHTML = "<div class=\"table-gameover-glow\"></div>";
    await new Promise((resolve) => setTimeout(resolve, experience.duration(650, 150)));
    layer.innerHTML = "";
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, 700));
}

async function processFxQueue() {
  if (app.fxAnimating) {
    return;
  }
  if (animationsBlockedByVoice()) {
    return;
  }
  const generation = app.fxGeneration;
  app.fxAnimating = true;
  const overlay = $("table-fx");
  try {
    while (app.animationQueue.length > 0 && generation === app.fxGeneration) {
      if (animationsBlockedByVoice()) {
        break;
      }
      const event = app.animationQueue.shift();
      if (event.type === "execution") {
        narrateFx(event);
        const cinematicId = event.cinematicId;
        overlay.className = "table-fx active fx-execution" +
          (event.reveal.shot ? " shot" : " empty") + (event.reveal.truthful ? " truth" : " lie");
        overlay.setAttribute("aria-hidden", "false");
        overlay.innerHTML = fxMarkup(event);
        prepareFx(event, overlay);
        playFxSound(event);
        experience.accelerate(overlay, 2);
        if (experience.preferences.narration === "key") {
          scheduleSpeech(experience.duration(2225, 200), event.reveal.shot ? "中弹。" : "空枪。", event.reveal.shot ? "surprised" : "tease", "", "high");
        }
        await new Promise((resolve) => setTimeout(resolve, experience.duration(3800, 950)));
        if (generation !== app.fxGeneration) {
          break;
        }
        overlay.classList.remove("active");
        overlay.setAttribute("aria-hidden", "true");
        await new Promise((resolve) => setTimeout(resolve, 160));
        if (generation !== app.fxGeneration) {
          break;
        }
        overlay.className = "table-fx";
        overlay.innerHTML = "";
        await waitForNarrationEnd();
        await acknowledgeCinematic(cinematicId);
      } else {
        if (event.type === "reveal") {
          const layer = getTableEffectLayer();
          playFxSound(event);
          const stage = await runRevealTableEffect(event, layer);
          narrateFx(event);
          await waitForNarrationEnd();
          clearRevealTableEffect(layer, stage);
        } else {
          narrateFx(event);
          await waitForNarrationEnd();
          playFxSound(event);
          await runTableEffect(event);
          await waitForNarrationEnd();
        }
        if (generation !== app.fxGeneration) {
          break;
        }
      }
    }
  } catch (error) {
    console.error("table effect failed", error);
    overlay.className = "table-fx";
    overlay.innerHTML = "";
    overlay.setAttribute("aria-hidden", "true");
  } finally {
    if (generation === app.fxGeneration) {
      app.fxAnimating = false;
      if (app.room) renderActionBar(app.room);
      const stage = $("table-stage");
      if (stage) stage.classList.remove("cards-in-flight", "reveal-active");
      maybeShowVictorySettlement();
    }
  }
}

function particleMarkup(count, hue) {
  return Array.from({ length: count }, () => {
    const x = Math.round((Math.random() * 2 - 1) * 290);
    const y = Math.round((Math.random() * 2 - 1) * 230);
    const size = 2 + Math.round(Math.random() * 6);
    const delay = (Math.random() * 0.55).toFixed(2);
    const duration = (0.8 + Math.random() * 0.8).toFixed(2);
    const color = "hsl(" + (hue + Math.round(Math.random() * 34 - 17)) + ", 85%, 68%)";
    return "<i style=\"--x:" + x + "px;--y:" + y + "px;--size:" + size + "px;--delay:" + delay + "s;--duration:" + duration + "s;--color:" + color + "\"></i>";
  }).join("");
}

function highlightTag() {
  return "<div class=\"fx-highlight-tag\"><i></i> HIGHLIGHT</div>";
}

function fxPlayer(playerId) {
  return app.room && Array.isArray(app.room.players)
    ? app.room.players.find((player) => player.id === playerId) || null
    : null;
}

function fxPortrait(player, fallbackName, className) {
  if (player && (player.portraitUrl || player.avatarUrl)) {
    return "<div class=\"" + className + "\"><img src=\"" + escapeHtml(player.portraitUrl || player.avatarUrl) + "\" alt=\"\"><span>" + escapeHtml(player.name || fallbackName) + "</span></div>";
  }
  return "<div class=\"" + className + " fx-portrait-fallback\">" + escapeHtml((player && player.emoji) || "🎭") + "<span>" + escapeHtml((player && player.name) || fallbackName) + "</span></div>";
}

function prepareFx(event, overlay) {
  if (event.type === "play") {
    flashSeat(event.playerId, "action-flash");
    const actor = app.room && app.room.players
      ? app.room.players.find((player) => player.id === event.playerId)
      : null;
    const target = overlay.querySelector(".fx-cards");
    if (actor && target) {
      const seat = document.querySelector(".seat[data-seat=\"" + actor.seat + "\"]");
      if (seat) {
        const start = seat.getBoundingClientRect();
        const end = target.getBoundingClientRect();
        target.style.setProperty("--start-x", Math.round(start.left + start.width / 2 - (end.left + end.width / 2)) + "px");
        target.style.setProperty("--start-y", Math.round(start.top + start.height / 2 - (end.top + end.height / 2)) + "px");
      }
    }
  }
  if (event.type === "reveal") {
    flashSeat(event.reveal.challengerId, "action-flash");
  }
  if (event.type === "execution") {
    if (event.reveal.shot) {
      const generation = app.fxGeneration;
      setTimeout(() => {
        if (generation !== app.fxGeneration) return;
        app.deathVisualApplied = true;
        if (app.room) {
          renderSeats(app.room);
        }
        flashSeat(event.reveal.loserId, "action-shot");
      }, experience.duration(2225, 200));
    }
  }
}

function flashSeat(playerId, className) {
  if (!playerId || !app.room) {
    return;
  }
  const player = app.room.players.find((item) => item.id === playerId);
  if (!player) {
    return;
  }
  const seat = document.querySelector(".seat[data-seat=\"" + player.seat + "\"]");
  if (!seat) {
    return;
  }
  seat.classList.remove(className);
  void seat.offsetWidth;
  seat.classList.add(className);
  setTimeout(() => seat.classList.remove(className), className === "action-shot" ? 1500 : 900);
}

function fxMarkup(event) {
  if (event.type === "play") {
    const cards = Array.from({ length: Math.min(3, event.count) }, () => "<div class=\"fx-card-back\"></div>").join("");
    return [
      "<div class=\"fx-panel fx-play-panel\">",
      "  <div class=\"fx-kicker\">DECLARATION</div>",
      "  <div class=\"fx-title\">" + escapeHtml(event.playerName) + " 出牌</div>",
      "  <div class=\"fx-play-stage\">",
      "    <div class=\"fx-claim-card\"><span>" + escapeHtml(event.claimRank) + "</span><small>宣称</small></div>",
      "    <div class=\"fx-cards\">" + cards + "</div>",
      "    <div class=\"fx-play-impact\"></div>",
      "  </div>",
      "  <div class=\"fx-play-count\"><b>" + event.count + "</b><span>张 · 宣称 " + escapeHtml(event.claimRank) + "</span></div>",
      "  <div class=\"fx-sub\">" + escapeHtml(event.playerName) + " 已扣牌，所有声明都指向桌面点数 " + escapeHtml(event.claimRank) + "</div>",
      "</div>",
      "<div class=\"fx-light-sweep\"></div>",
      "<div class=\"fx-particles\">" + particleMarkup(18, 42) + "</div>"
    ].join("");
  }
  if (event.type === "round") {
    const red = event.suit === "♥" || event.suit === "♦";
    return [
      "<div class=\"fx-panel\">",
      "  <div class=\"fx-kicker\">ROUND " + String(event.round).padStart(2, "0") + "</div>",
      "  <div class=\"fx-title\">新一轮开始</div>",
      cardMarkup(event.rank, event.suit, red, false),
      "  <div class=\"fx-big\">桌面点数 " + escapeHtml(event.rank) + "</div>",
      "  <div class=\"fx-sub\">J、Q、K 各六张，大小王为万能牌</div>",
      "</div>",
      "<div class=\"fx-light-sweep\"></div>",
      "<div class=\"fx-particles\">" + particleMarkup(14, 42) + "</div>"
    ].join("");
  }
  if (event.type === "gameover") {
    return [
      "<div class=\"fx-panel\">",
      "  <div class=\"fx-kicker\">LAST ONE STANDING</div>",
      "  <div class=\"fx-title\">牌局结束</div>",
      "  <div class=\"fx-big\">" + escapeHtml(event.winnerName) + "</div>",
      "  <div class=\"fx-sub\">" + escapeHtml(event.text) + "</div>",
      "</div>",
      highlightTag(),
      "<div class=\"fx-light-sweep\"></div>",
      "<div class=\"fx-particles\">" + particleMarkup(26, 42) + "</div>"
    ].join("");
  }
  if (event.type === "reveal") {
    const reveal = event.reveal;
    const cards = reveal.cards.map((card, index) => {
      return "<div class=\"fx-flip-card\" style=\"--delay:" + (index * 130) + "ms\">" +
        "<div class=\"fx-flip-inner\"><div class=\"fx-flip-back\"></div><div class=\"fx-flip-front\">" +
        cardMarkup(card.rank, card.suit, card.red, false, card.wild, card.label) +
        "</div></div></div>";
    }).join("");
    const challenger = fxPlayer(reveal.challengerId);
    const claimant = fxPlayer(reveal.claimantId);
    return [
      "<div class=\"fx-panel fx-reveal-panel\">",
      "  <div class=\"fx-kicker\">CHALLENGE · REVEAL</div>",
      "  <div class=\"fx-title\">" + escapeHtml(reveal.challengerName) + " 质疑 " + escapeHtml(reveal.claimantName) + "</div>",
      "  <div class=\"fx-duel-row\">",
      fxPortrait(challenger, reveal.challengerName, "fx-duel-person"),
      "    <span class=\"fx-duel-vs\">VS</span>",
      fxPortrait(claimant, reveal.claimantName, "fx-duel-person"),
      "  </div>",
      "  <div class=\"fx-reveal-stage\">",
      "    <div class=\"fx-reveal-banner\">亮牌</div>",
      "    <div class=\"fx-reveal-row\">" + cards + "</div>",
      "    <div class=\"fx-verdict " + (reveal.truthful ? "truth" : "lie") + "\">" +
        "<b>" + (reveal.truthful ? "质疑失败" : "质疑成功") + "</b>" +
        "<small>" + (reveal.truthful ? "亮牌属实 · 质疑者将受刑" : "抓到谎言 · 出牌者将受刑") + "</small></div>",
      "  </div>",
      "  <div class=\"fx-sub\">亮牌判定完成，随后进入处决</div>",
      "</div>",
      "<div class=\"fx-cinema-bars\"></div>",
      highlightTag(),
      "<div class=\"fx-light-sweep\"></div>",
      "<div class=\"fx-particles\">" + particleMarkup(reveal.truthful ? 14 : 22, reveal.truthful ? 42 : 4) + "</div>"
    ].join("");
  }
  if (event.type === "execution") {
    const reveal = event.reveal;
    const chambers = Array.from({ length: 3 }, (_, index) => "<i style=\"--n:" + index + "\"></i>").join("");
    const loser = fxPlayer(reveal.loserId);
    return [
      "<div class=\"fx-panel fx-execution-panel\">",
      "  <div class=\"fx-kicker\">THE CHAMBER DECIDES</div>",
      "  <div class=\"fx-execution-verdict\">" + (reveal.truthful ? "质疑失败" : "质疑成功") + " · " + escapeHtml(reveal.loserName) + " 受刑</div>",
      "  <div class=\"fx-execution-scene\">",
      fxPortrait(loser, reveal.loserName, "fx-condemned"),
      "    <div class=\"fx-gun-stage\">",
      "      <div class=\"fx-gun\">",
      "        <img class=\"fx-gun-sprite\" src=\"/assets/revolver.webp\" alt=\"轮盘左轮\" decoding=\"async\">",
      "        <div class=\"fx-gun-barrel\"></div>",
      "        <div class=\"fx-gun-cylinder\"><div class=\"fx-cylinder\">" + chambers + "</div></div>",
      "        <div class=\"fx-gun-grip\"></div>",
      "        <div class=\"fx-gun-trigger\"></div>",
      "        <div class=\"fx-gun-hammer\"></div>",
      "        <div class=\"fx-muzzle\"></div>",
      "      </div>",
      "      <div class=\"fx-shockwave\"></div>",
      "    </div>",
      "  </div>",
      "  <div class=\"fx-executor\">" + escapeHtml(reveal.loserName) + " 扣下扳机</div>",
      "  <div class=\"fx-chance\"><span class=\"fx-chance-dots\"><i></i><i></i><i></i></span>3 弹仓 · 1 发子弹 · 每次约 1/3</div>",
      "  <div class=\"fx-outcome\">" + (reveal.shot ? "中弹" : "空枪") + "</div>",
      "</div>",
      "<div class=\"fx-cinema-bars\"></div>",
      "<div class=\"fx-blood-vignette\"></div>",
      "<div class=\"fx-bullet-hole\"></div>",
      "<div class=\"fx-flash\"></div>",
      highlightTag(),
      "<div class=\"fx-light-sweep\"></div>",
      "<div class=\"fx-particles\">" + particleMarkup(reveal.shot ? 34 : 22, reveal.shot ? 4 : 42) + "</div>"
    ].join("");
  }
  return "";
}

function playFxSound(event) {
  if (event.type === "play") {
    playNoiseBurst(0.12, 0.025);
    playTone(560, 0.06, "triangle");
    setTimeout(() => playTone(360, 0.07, "triangle"), 90);
  } else if (event.type === "round") {
    playTone(330, 0.12, "sine");
    setTimeout(() => playTone(440, 0.16, "sine"), 150);
  } else if (event.type === "challenge") {
    playTone(120, 0.16, "sawtooth");
    setTimeout(() => playTone(78, 0.22, "triangle"), 80);
    playNoiseBurst(0.12, 0.045);
  } else if (event.type === "reveal") {
    const cardCount = event.reveal.cards ? event.reveal.cards.length : 0;
    for (let index = 0; index < cardCount; index += 1) {
      setTimeout(() => playNoiseBurst(0.045, 0.018), 540 + index * 130);
    }
    setTimeout(() => {
      playTone(event.reveal.truthful ? 210 : 145, 0.18, "sawtooth");
      playNoiseBurst(0.08, 0.035);
    }, 1500);
  } else if (event.type === "execution") {
    const generation = app.fxGeneration;
    const later = (delay, callback) => setTimeout(() => {
      if (generation === app.fxGeneration) callback();
    }, experience.duration(delay / 2, Math.min(200, delay / 2)));
    later(700, () => {
      playTone(92, 0.12, "sawtooth");
      playNoiseBurst(0.1, 0.04);
    });
    later(650, () => playTone(58, 0.16, "sine"));
    later(1500, () => playTone(62, 0.18, "sine"));
    later(2100, () => playTone(58, 0.2, "sine"));
    for (let index = 0; index < 9; index += 1) {
      if (experience.preferences.motion !== "reduced") later(2100 + index * 145, () => playTone(150 + index * 10, 0.035, "square"));
    }
    later(4450, () => {
      if (event.reveal.shot) {
        playNoiseBurst(0.32, 0.13);
        playTone(70, 0.3, "sawtooth");
        setTimeout(() => playTone(880, 0.7, "sine"), 160);
      } else {
        playTone(110, 0.08, "square");
      }
    });
  } else if (event.type === "gameover") {
    playTone(220, 0.4, "sine");
    setTimeout(() => playTone(277, 0.45, "sine"), 120);
    setTimeout(() => playTone(330, 0.55, "sine"), 240);
  }
}

function handleAiThought(thought) {
  if (!thought) {
    renderMindPanel(null);
    return;
  }
  if (app.room) {
    app.room.aiThought = thought;
  }
  renderMindPanel(thought);
}

function renderMindPanel(thought) {
  const panel = $("ai-mind-panel");
  if (!panel) {
    return;
  }
  clearTimeout(app.mindHideTimer);
  app.mindHideTimer = null;
  if (!thought) {
    panel.hidden = true;
    panel.className = "ai-mind-panel";
    return;
  }
  panel.hidden = false;
  let bubblePosition = "bubble-left";
  if (thought.playerId && app.room) {
    const speaker = app.room.players.find((player) => player.id === thought.playerId);
    if (speaker) {
      bubblePosition = "bubble-" + seatPosition(speaker.seat);
    }
  }
  panel.className = "ai-mind-panel status-" + (thought.status || "observing") + " " + bubblePosition;
  const avatar = $("ai-mind-avatar");
  if (avatar) {
    if (thought.portraitUrl || thought.avatarUrl) {
      avatar.innerHTML = "<img src=\"" + escapeHtml(thought.portraitUrl || thought.avatarUrl) + "\" alt=\"\">";
    } else {
      avatar.textContent = thought.avatarEmoji || "🎲";
    }
  }
  $("ai-mind-name").textContent = thought.name || "AI";
  const statusLabels = {
    observing: "正在观察牌桌",
    streaming: "公开喊话",
    decided: "喊话结束",
    speaking: "语音放话中"
  };
  $("ai-mind-status").textContent = statusLabels[thought.status] || "心理活动";
  const text = thought.text || (thought.status === "observing" ? "正在观察牌桌……" : "……");
  $("ai-mind-text").textContent = text;
  const decision = $("ai-mind-decision");
  if (thought.decisionLabel) {
    decision.hidden = false;
    decision.textContent = thought.decisionLabel;
    if (!thought.sticky) {
      app.mindHideTimer = setTimeout(() => {
        app.mindHideTimer = null;
        if (app.room && app.room.aiThought === thought) {
          app.room.aiThought = null;
        }
        panel.hidden = true;
        panel.className = "ai-mind-panel";
      }, 2200);
    }
  } else {
    decision.hidden = true;
    decision.textContent = "";
  }
}

function renderRoom() {
  const state = app.room;
  if (!state) {
    return;
  }
  const dock = document.querySelector(".action-dock");
  dock.classList.toggle("is-lobby", state.phase === "lobby");
  dock.classList.toggle("is-your-turn", Boolean(state.me && state.me.alive &&
    state.me.id === state.turnPlayerId && !state.turnGateReason));
  $("room-code-label").textContent = "主桌";
  let status = "等待入座";
  if (state.phase === "playing") {
    status = "第 " + state.round + " 轮 · 桌面点数 " + state.tableRank;
  } else if (state.phase === "out_challenge") {
    const forcedPlayer = state.players.find((player) => player.id === state.turnPlayerId);
    status = state.cardsInHands === 0
      ? "终局质疑"
      : forcedPlayer && forcedPlayer.handCount === 0 ? "空手牌 · 强制质疑" : "最后持牌者 · 强制质疑";
  } else if (state.phase === "gameover") {
    status = "牌局结束";
  } else if (state.phase === "lobby") {
    status = "等待入座 · " + state.humanCount + "/2 位真人";
  }
  $("room-status").textContent = status;
  setConnectionStatus(state.phase === "lobby" ? "房间 " + state.code : "实时牌桌", false);
  $("round-label").textContent = state.phase === "lobby"
    ? "等待开桌"
    : "第 " + state.round + " 轮 · " + (state.tableRank || "-");
  document.title = state.code + " · 骗子酒馆";
  renderSeats(state);
  renderCenter(state);
  renderLineup(state);
  if (state.pendingSpeech) {
    const speaker = state.players.find((player) => player.id === state.pendingSpeech.playerId);
    renderMindPanel({
      playerId: state.pendingSpeech.playerId,
      name: state.pendingSpeech.playerName || (speaker && speaker.name) || "AI",
      avatarEmoji: speaker ? speaker.emoji : "🎲",
      avatarUrl: speaker ? speaker.avatarUrl : "",
      portraitUrl: speaker ? speaker.portraitUrl : "",
      text: state.pendingSpeech.text,
      status: "speaking",
      done: Boolean(state.pendingSpeech.decisionLabel),
      decisionLabel: state.pendingSpeech.decisionLabel || "",
      sticky: true
    });
  } else {
    renderMindPanel(state.aiThought);
  }
  renderRoundThoughts(state);
  renderHand(state);
  renderActionBar(state);
  renderFeed(state);
  updateVoidGameButton(state);
  updateTurnClock();
  updateCameraUi();
}

function updateTurnClock() {
  const clock = $("turn-clock");
  const state = app.room;
  if (!clock) {
    return;
  }
  if (!state || (state.phase !== "playing" && state.phase !== "out_challenge")) {
    clock.hidden = true;
    clock.className = "turn-clock";
    app.gateLocked = false;
    if (state) {
      $("turn-banner").className = "turn-banner";
      $("turn-banner-title").textContent = state.phase === "gameover" ? "本局结束" : "等你入座";
      $("turn-banner-copy").textContent = state.phase === "gameover" ? "回味这一局，准备下一局。" : "准备好，就开始第一手。";
    }
    return;
  }
  const now = Date.now() + app.serverOffset;
  const myTurn = Boolean(state.me && state.me.id === state.turnPlayerId && state.me.alive);
  const banner = $("turn-banner");
  banner.classList.toggle("your-turn", myTurn && !state.turnGateReason);
  let bannerTitle = myTurn ? "轮到你了" : "等待 " + (state.turnPlayerName || "开局");
  let bannerCopy = myTurn ? "选 1–3 张牌，或质疑上一位" : "观察对手，想好下一手。";
  if (state.pendingSpeech) { bannerTitle = state.pendingSpeech.playerName + " 正在放话"; bannerCopy = "留意牌桌上的每一句话。"; }
  else if (state.turnGateReason === "cinematic") { bannerTitle = "亮牌与轮盘"; bannerCopy = "看清判定，再接着出牌。"; }
  else if (state.phase === "out_challenge" && myTurn) { bannerTitle = "这一手，必须质疑"; bannerCopy = "没有可继续出牌的回合了。"; }
  $("turn-banner-title").textContent = bannerTitle;
  $("turn-banner-copy").textContent = bannerCopy;
  clock.hidden = false;
  if (state.pendingSpeech) {
    clock.textContent = "AI 放话中";
    clock.classList.add("waiting");
    app.gateLocked = true;
    return;
  }
  if (state.turnGateReason === "cinematic") {
    clock.textContent = "处决演出中";
    clock.classList.add("waiting");
    app.gateLocked = true;
    return;
  }
  const gateRemaining = Math.max(0, (state.turnGateUntil || 0) - now);
  const turnPlayer = state.players.find((player) => player.id === state.turnPlayerId);
  const humanTurn = Boolean(turnPlayer && !turnPlayer.isAI && !turnPlayer.autopilot && state.turnDeadline);
  const deadlineRemaining = humanTurn ? Math.max(0, state.turnDeadline - now) : 0;
  $("turn-progress-fill").style.transform = "scaleX(" + Math.min(1, deadlineRemaining / 30000) + ")";
  banner.classList.toggle("urgent", myTurn && deadlineRemaining > 0 && deadlineRemaining <= 5000);
  clock.hidden = false;
  clock.classList.remove("waiting", "urgent");
  if (gateRemaining > 0) {
    clock.textContent = "等待放话 " + Math.ceil(gateRemaining / 1000) + "s";
    clock.classList.add("waiting");
    app.gateLocked = true;
  } else {
    if (app.gateLocked) {
      app.gateLocked = false;
      renderActionBar(state);
    }
    if (humanTurn) {
      clock.textContent = (state.phase === "out_challenge" ? "质疑剩余 " : "出牌剩余 ") + Math.ceil(deadlineRemaining / 1000) + "s";
      if (deadlineRemaining <= 5000) {
        clock.classList.add("urgent");
      }
    } else {
      clock.textContent = "AI 思考中";
      clock.classList.add("waiting");
    }
  }
}

function renderRoundThoughts(state) {
  const panel = $("round-thoughts");
  if (!panel) {
    return;
  }
  const thoughts = Array.isArray(state.roundThoughts) ? state.roundThoughts : [];
  if (state.phase !== "gameover" || thoughts.length === 0) {
    panel.hidden = true;
    experience.render(panel, "");
    return;
  }
  panel.hidden = false;
  experience.render(panel, [
    "<div class=\"round-thoughts-head\"><span>赛后心声</span><small>牌局结束后公开</small></div>",
    thoughts.map((thought) => {
      const avatar = thought.portraitUrl || thought.avatarUrl
        ? "<span class=\"round-thought-avatar\"><img src=\"" + escapeHtml(thought.portraitUrl || thought.avatarUrl) + "\" alt=\"\"></span>"
        : "<span class=\"round-thought-avatar\">" + escapeHtml(thought.avatarEmoji || "🎭") + "</span>";
      return "<div class=\"round-thought\">" + avatar +
        "<div class=\"round-thought-body\"><strong>" + escapeHtml(thought.name) + "</strong><p>" + escapeHtml(thought.text) + "</p></div></div>";
    }).join("")
  ].join(""));
}

function seatPosition(seat) {
  const baseSeat = app.room && app.room.me ? app.room.me.seat : 0;
  return SEAT_POSITIONS[(seat - baseSeat + SEAT_POSITIONS.length) % SEAT_POSITIONS.length];
}

function renderSeats(state) {
  const layer = $("seat-layer");
  experience.keyed(layer, state.players.map((player) => {
    const isMe = Boolean(state.me && state.me.id === player.id);
    const classes = [
      "seat",
      "position-" + seatPosition(player.seat),
      player.id && state.turnPlayerId === player.id ? "is-turn" : "",
      player.occupied && !player.alive && state.phase !== "lobby" &&
        !(app.pendingDeathId === player.id && !app.deathVisualApplied) ? "is-dead" : "",
      !player.occupied ? "is-empty" : "",
      player.thinking ? "thinking" : ""
    ].filter(Boolean).join(" ");
    const badges = [];
    if (isMe) {
      badges.push("<span class=\"seat-badge you\">你</span>");
    }
    if (player.isHost) {
      badges.push("<span class=\"seat-badge\">房主</span>");
    }
    if (player.isAI) {
      badges.push("<span class=\"seat-badge\">AI</span>");
    }
    if (state.aiHandsRevealed && player.isAI) {
      badges.push("<span class=\"seat-badge open\">明牌</span>");
    }
    if (player.autopilot) {
      badges.push("<span class=\"seat-badge\">托管</span>");
    }
    let sub = "真人玩家";
    if (!player.occupied) {
      sub = "开始后由 AI 补位";
    } else if (player.isAI) {
      sub = player.modelLabel || "本地策略";
    } else if (!player.connected) {
      sub = "已掉线";
    }
    let miniCards = "";
    if (player.occupied && player.alive && Array.isArray(player.revealedHand)) {
      miniCards = player.revealedHand.slice(0, 8).map((card) => {
        const text = card.wild ? "王" : card.rank + card.suit;
        return "<i class=\"mini-card open" + (card.red ? " red" : "") + "\">" + escapeHtml(text) + "</i>";
      }).join("");
    } else if (player.occupied && player.alive) {
      miniCards = Array.from({ length: Math.min(player.handCount, 8) }, () => "<i class=\"mini-card\"></i>").join("");
    }
    return { key: player.seat, markup: [
      "<div class=\"" + classes + "\" data-seat=\"" + player.seat + "\">",
      "  <div class=\"seat-visual\">",
      player.portraitUrl
        ? "<img class=\"seat-portrait\" src=\"" + escapeHtml(player.portraitUrl) + "\" alt=\"\">"
        : "<div class=\"seat-portrait seat-portrait-emoji\">" + escapeHtml(player.emoji || "🕵️") + "</div>",
      "    <div class=\"seat-avatar\">" + (player.avatarUrl
        ? "<img src=\"" + escapeHtml(player.avatarUrl) + "\" alt=\"\">"
        : "<span>" + escapeHtml(player.emoji || "🕵️") + "</span>") + "</div>",
      "  </div>",
      "  <div class=\"seat-info\">",
      "    <div class=\"seat-name\"><span class=\"seat-player-name\">" + escapeHtml(player.name) + "</span>" + badges.join("") + "</div>",
      "    <div class=\"seat-sub\">" + (player.occupied && state.phase !== "lobby" ? player.handCount + " 张 · " : "") + escapeHtml(sub) + "</div>",
      "    <div class=\"thinking-dots\"><i></i><i></i><i></i></div>",
      "  </div>",
      "  <div class=\"mini-hand\">" + miniCards + "</div>",
      "</div>"
    ].join("") };
  }));
}

function cardMarkup(rank, suit, red, small, wild, label) {
  return [
    "<div class=\"table-card " + (red ? "red " : "") + (small ? "small " : "") + (wild ? "joker" : "") + "\">",
    "  <b>" + escapeHtml(wild ? "🃏" : rank) + "</b>",
    "  <em>" + escapeHtml(wild ? (label || "王") : suit) + "</em>",
    "</div>"
  ].join("");
}

function renderCenter(state) {
  const panel = $("center-panel");
  const tableCard = state.tableCard || (state.tableRank ? { rank: state.tableRank, suit: "♠", red: false } : null);
  const parts = [];
  if (tableCard) {
    parts.push("<span class=\"center-caption\">本轮宣称点数</span>");
    parts.push(cardMarkup(tableCard.rank, tableCard.suit, tableCard.red, false));
  }
  if (state.lastReveal && state.lastReveal.cards) {
    parts.push("<div class=\"center-stack\">" + state.lastReveal.cards.slice(0, 3).map((card) => cardMarkup(card.rank, card.suit, card.red, true, card.wild, card.label)).join("") + "</div>");
  } else if (state.lastPlay && state.lastPlay.count > 0) {
    const backs = Array.from({ length: Math.min(state.lastPlay.count, 3) }, () => "<i class=\"center-back-card\"></i>").join("");
    parts.push("<div class=\"center-stack center-back-stack\">" + backs + "</div>");
  }
  experience.render(panel, parts.join(""));
}

function renderHand(state) {
  const row = $("hand-row");
  const hand = state.me && Array.isArray(state.me.hand) ? state.me.hand.slice() : [];
  $("hand-count").textContent = hand.length ? hand.length + " 张" : "";
  $("clear-selection").disabled = app.selected.size === 0;
  $("sort-hand").disabled = hand.length < 2;
  if (!state.me) {
    experience.forget(row);
    experience.render(row, "<div class=\"spectator-note\">观战中 · 留意每一次出牌与质疑。</div>");
    $("hand-hint").textContent = "AI 对局公开观战";
    return;
  }
  if (!state.me.alive) {
    experience.forget(row);
    experience.render(row, "<div class=\"empty-hand-note\">你已出局，继续看看谁能留到最后。<br>结算后换个名字，再来一局。</div>");
    $("hand-hint").textContent = "旁观中";
    return;
  }
  if (!state.me.hand || state.me.hand.length === 0) {
    experience.forget(row);
    experience.render(row, "<div class=\"empty-hand-note\">手牌已空，留意下一次质疑机会。</div>");
    $("hand-hint").textContent = "空手牌 · 等待强制质疑";
    return;
  }
  const canClick = state.phase === "playing" && state.me.alive;
  if (app.handSorted) {
    const order = (card) => card.wild ? 0 : card.rank === state.tableRank ? 1 : 2 + ["J", "Q", "K"].indexOf(card.rank);
    hand.sort((a, b) => order(a) - order(b));
  }
  experience.keyed(row, hand.map((card) => {
    const wild = Boolean(card.wild);
    const matching = wild || card.rank === state.tableRank;
    return { key: card.id, markup: [
      "<button type=\"button\" class=\"playing-card" + (card.red ? " red" : "") + (wild ? " joker" : "") + (matching ? " matching" : "") + "\" data-card-id=\"" + escapeHtml(card.id) + "\" aria-label=\"" + escapeHtml(wild ? (card.label || "万能牌") : card.rank + card.suit) + "\"" + (canClick ? "" : " disabled") + ">",
      "  <span class=\"card-rank\">" + escapeHtml(wild ? "JOKER" : card.rank) + "</span>",
      "  <span class=\"card-center\">" + escapeHtml(wild ? "Wild" : card.suit) + "</span>",
      "  <span class=\"card-suit\">" + escapeHtml(wild ? "万能" : card.suit) + "</span>",
      "</button>"
    ].join("") };
  }));
  row.querySelectorAll("[data-card-id]").forEach(button => {
    const selected = app.selected.has(button.dataset.cardId);
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  $("hand-hint").textContent = state.legal.play
    ? "选择 1 到 3 张牌 · Enter 出牌"
    : "可先选牌，轮到你时出牌";
}

function renderActionBar(state) {
  const bar = $("action-bar");
  if (!app.connected) {
    experience.render(bar, "<span class=\"action-hint\">正在重新连接牌桌，手牌与席位已保留。</span>");
    return;
  }
  if (app.actionPending) {
    experience.render(bar, "<button class=\"action-button play\" type=\"button\" disabled aria-busy=\"true\">正在确认…</button>");
    return;
  }
  if (state.phase === "lobby") {
    if (state.canStart) {
      experience.render(bar, "<span class=\"action-hint\">准备好了就开局，AI 会补齐空位。</span><button class=\"action-button play\" type=\"button\" data-action=\"start\">开始牌局</button>");
    } else {
      experience.render(bar, "<span class=\"action-hint\">等待房主开始主桌牌局</span>");
    }
    return;
  }
  if (state.phase === "gameover") {
    if (!app.victoryClosed || app.settlementFinishing || app.fxAnimating || app.animationQueue.length > 0) {
      experience.render(bar, "<span class=\"action-hint\">正在结算本局，稍后可开始下一局。</span>");
    } else if (app.account && app.account.pendingRename) {
      experience.render(bar, "<span class=\"action-hint\">请先更换用户名，再开始下一局。</span>");
    } else if (state.canRestart) {
      experience.render(bar, "<button class=\"action-button play\" type=\"button\" data-action=\"restart\">开始下一局</button>");
    } else {
      experience.render(bar, "<span class=\"action-hint\">牌局结束 · 等待房主开始下一局</span>");
    }
    return;
  }
  if (!state.me) {
    experience.render(bar, "<span class=\"action-hint\">观战中 · 当前轮到 <b>" + escapeHtml(state.turnPlayerName || "等待") + "</b></span>");
    return;
  }
  if (state.me.autopilot) {
    experience.render(bar, "<span class=\"action-hint\">你已掉线，AI 正在托管你的席位</span>");
    return;
  }
  if (!state.me.alive) {
    experience.render(bar, "<span class=\"action-hint\">你已出局，正在旁观</span>");
    return;
  }
  if (state.pendingSpeech) {
    experience.render(bar, "<span class=\"action-hint\"><b>" + escapeHtml(state.pendingSpeech.playerName || "AI") + "</b> 正在放话…</span>");
    return;
  }
  if (state.turnGateReason === "cinematic") {
    experience.render(bar, "<span class=\"action-hint\">亮牌与轮盘演出中，马上继续。</span>");
    return;
  }
  const isMyTurn = state.me.id === state.turnPlayerId;
  if (!isMyTurn) {
    experience.render(bar, "<span class=\"action-hint\">等待 <b>" + escapeHtml(state.turnPlayerName || "下一位玩家") + "</b> 行动 · 可以先选好手牌</span>");
    return;
  }
  if (app.fxAnimating) {
    experience.render(bar, "<span class=\"action-hint\">牌桌演出中 · 马上继续</span>");
    return;
  }
  if (state.turnGateUntil && Date.now() < state.turnGateUntil) {
    experience.render(bar, "<span class=\"action-hint\">等待上一位玩家放话结束…</span>");
    return;
  }
  if (state.phase === "out_challenge") {
    const finalChallenge = state.cardsInHands === 0;
    const emptyHand = state.me && state.me.hand && state.me.hand.length === 0;
    experience.render(bar, [
      "<span class=\"action-hint\">" + (finalChallenge
        ? "全部手牌已打完 · 最后一手必须质疑"
        : emptyHand ? "你的手牌已空 · 上一位打了牌，必须质疑" : "你是最后持牌者 · 必须质疑上一位，不能出牌") + "</span>",
      "<button class=\"action-button challenge\" type=\"button\" data-action=\"challenge\">质疑上一位</button>"
    ].join(""));
    return;
  }
  const count = app.selected.size;
  const canPlay = count >= 1 && count <= state.legal.maxCards;
  const playText = count > 0
    ? "打出 " + count + " 张 · " + state.tableRank
    : "选择手牌";
  const challenge = state.legal.challenge
    ? "<button class=\"action-button challenge\" type=\"button\" data-action=\"challenge\">质疑上一位</button>"
    : "";
  experience.render(bar, [
    "<span class=\"action-hint\">" + (count > 0 ? "即将宣称 <b>" + count + " 张 " + escapeHtml(state.tableRank) + "</b>" : "选择 1 到 3 张牌") + "</span>",
    "<button class=\"action-button play\" type=\"button\" data-action=\"play\"" + (canPlay ? "" : " disabled") + ">" + escapeHtml(playText) + "<kbd>Enter</kbd></button>",
    challenge
  ].join(""));
}

async function voidCurrentGame() {
  if (app.voidingGame || !app.room || !app.playerToken) {
    return;
  }
  if (!window.confirm("提前结束本局？本局将作废，不计入任何人的胜负、击杀、连胜或死亡记录。")) {
    return;
  }
  app.voidingGame = true;
  updateVoidGameButton(app.room);
  try {
    await apiRequest("/api/rooms/" + encodeURIComponent(app.roomCode) + "/void", {
      method: "POST",
      body: {
        playerId: app.playerId,
        token: app.playerToken
      }
    });
    resetAfterVoid();
    showToast("本局已作废，不计入战绩。");
  } catch (error) {
    showToast(error.message, true);
  } finally {
    app.voidingGame = false;
    if (app.room) {
      updateVoidGameButton(app.room);
    }
  }
}

function renderLineup(state) {
  const panel = $("lineup-panel");
  if (state.phase !== "lobby") {
    panel.hidden = true;
    experience.render(panel, "");
    return;
  }
  panel.hidden = false;
  const lineup = Array.isArray(state.aiLineup) ? state.aiLineup : [];
  const roles = app.aiRoles.length > 0 ? app.aiRoles : lineup;
  if (roles.length === 0) {
    experience.render(panel, "<div class=\"lineup-head\"><strong>AI 阵容</strong><small>管理员尚未启用角色</small></div>");
    return;
  }
  const isHost = Boolean(state.me && state.me.id === state.hostId);
  if (!isHost) {
    experience.render(panel, [
      "<div class=\"lineup-head\"><strong>本局 AI 阵容</strong><small>由房主选择</small></div>",
      "<div class=\"lineup-readonly\">" + lineup.map((role) => {
        return "<span class=\"lineup-chip\">" + escapeHtml(role.avatarEmoji || "🎲") + " " + escapeHtml(role.name) + "</span>";
      }).join("") + "</div>"
    ].join(""));
    return;
  }
  const slots = [];
  for (let index = 0; index < 3; index += 1) {
    const current = lineup[index] || null;
    const options = ["<option value=\"\">未选择</option>"].concat(roles.map((role) => {
      const selected = current && current.id === role.id ? " selected" : "";
      return "<option value=\"" + escapeHtml(role.id) + "\"" + selected + ">" + escapeHtml(role.name) + "</option>";
    })).join("");
    slots.push([
      "<div class=\"lineup-slot\" data-lineup-slot=\"" + index + "\">",
      avatarMarkup(current || roles[index % roles.length], "lineup-avatar"),
      "  <select data-lineup-select=\"" + index + "\" aria-label=\"AI " + (index + 1) + "\">" + options + "</select>",
      "</div>"
    ].join(""));
  }
  experience.render(panel, [
    "<div class=\"lineup-head\"><strong>AI 阵容</strong><small>按空位顺序启用，只能选择管理员已配置的角色</small></div>",
    "<div class=\"lineup-grid\">" + slots.join("") + "</div>"
  ].join(""));
}

function renderFeed(state) {
  const gameover = state.log.slice().reverse().find((entry) => entry.type === "gameover");
  const gameoverKey = gameover ? gameover.id : "";
  if (gameoverKey && gameoverKey !== app.leaderboardGameoverKey) {
    app.leaderboardGameoverKey = gameoverKey;
    ensureSideLeaderboard(true);
  } else {
    ensureSideLeaderboard(false);
  }
  const ticker = $("chat-ticker");
  if (ticker) {
    const recent = state.chat.slice(-2);
    ticker.hidden = recent.length === 0;
    ticker.innerHTML = recent.map((entry) => {
      return "<span><b>" + escapeHtml(entry.name) + "</b> " + escapeHtml(entry.text) + "</span>";
    }).join("");
  }
  const lastChat = state.chat.length > 0 ? state.chat[state.chat.length - 1] : null;
  if (lastChat && lastChat.id !== app.lastChatKey) {
    app.lastChatKey = lastChat.id;
    if (lastChat.playerId !== app.playerId) {
      playTone(460, 0.05, "sine");
    }
  }
}

async function sendAction(action) {
  if (app.actionPending) return;
  if (!app.connected) {
    showToast("正在重新连接牌桌，请稍等。", true);
    return;
  }
  if (!app.playerId) {
    showToast("观战模式不能操作牌局。", true);
    return;
  }
  if (app.room && app.room.pendingSpeech) {
    showToast("等待 AI 放话结束后再行动。", true);
    return;
  }
  if (app.room && app.room.turnGateUntil && Date.now() < app.room.turnGateUntil) {
    showToast(app.room.turnGateReason === "cinematic" ? "处决演出尚未结束。" : "等待上一位玩家放话结束。", true);
    return;
  }
  app.actionPending = true;
  const requestId = ++app.actionRequestId;
  renderActionBar(app.room);
  try {
    await apiRequest("/api/rooms/" + encodeURIComponent(app.roomCode) + "/action", {
      method: "POST",
      body: { playerId: app.playerId, token: app.playerToken, action }
    });
    playTone(280, 0.05, "triangle");
    app.selected.clear();
    if (app.room) renderHand(app.room);
  } catch (error) {
    showToast(error.message, true);
  } finally {
    if (requestId === app.actionRequestId) {
      app.actionPending = false;
      if (app.room) renderActionBar(app.room);
    }
  }
}

async function startRoom() {
  if (app.actionPending) return;
  app.actionPending = true;
  const requestId = ++app.actionRequestId;
  if (app.room) renderActionBar(app.room);
  try {
    await apiRequest("/api/table/start", {
      method: "POST",
      body: { sessionToken: app.sessionToken }
    });
  } catch (error) {
    showToast(error.message, true);
  } finally {
    if (requestId === app.actionRequestId) {
      app.actionPending = false;
      if (app.room) renderActionBar(app.room);
    }
  }
}

async function setAiLineup(roleIds) {
  try {
    await apiRequest("/api/rooms/" + encodeURIComponent(app.roomCode) + "/ai-lineup", {
      method: "POST",
      body: { playerId: app.playerId, token: app.playerToken, roleIds }
    });
  } catch (error) {
    showToast(error.message, true);
  }
}

async function restartRoom() {
  if (app.actionPending) return;
  app.actionPending = true;
  const requestId = ++app.actionRequestId;
  if (app.room) renderActionBar(app.room);
  try {
    await apiRequest("/api/table/next", {
      method: "POST",
      body: { sessionToken: app.sessionToken }
    });
  } catch (error) {
    showToast(error.message, true);
  } finally {
    if (requestId === app.actionRequestId) {
      app.actionPending = false;
      if (app.room) renderActionBar(app.room);
    }
  }
}

function wireRoomEvents() {
  $("action-bar").addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button || button.disabled) {
      return;
    }
    const action = button.getAttribute("data-action");
    if (action === "start") {
      startRoom();
    } else if (action === "restart") {
      restartRoom();
    } else if (action === "play") {
      sendAction({ type: "play", cardIds: Array.from(app.selected) });
    } else if (action === "challenge") {
      sendAction({ type: "challenge" });
    }
  });

  $("lineup-panel").addEventListener("change", (event) => {
    const select = event.target.closest("[data-lineup-select]");
    if (!select) {
      return;
    }
    const selects = Array.from(document.querySelectorAll("[data-lineup-select]"));
    const roleIds = selects.map((item) => item.value).filter(Boolean);
    setAiLineup(Array.from(new Set(roleIds)));
  });

  $("hand-row").addEventListener("click", (event) => {
    const button = event.target.closest("[data-card-id]");
    if (!button || button.disabled) {
      return;
    }
    const id = button.getAttribute("data-card-id");
    if (app.selected.has(id)) {
      app.selected.delete(id);
    } else {
      const limit = app.room && app.room.legal ? app.room.legal.maxCards : 3;
      if (app.selected.size >= limit) {
        showToast("每次最多打出 3 张牌。", true);
        return;
      }
      app.selected.add(id);
    }
    renderHand(app.room);
    renderActionBar(app.room);
  });

  $("chat-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = $("chat-input");
    const text = input.value.trim();
    if (!text || !app.playerId) {
      return;
    }
    input.value = "";
    try {
      await apiRequest("/api/rooms/" + encodeURIComponent(app.roomCode) + "/chat", {
        method: "POST",
        body: { playerId: app.playerId, token: app.playerToken, text }
      });
    } catch (error) {
      showToast(error.message, true);
      input.value = text;
    }
  });

  $("void-game-button").addEventListener("click", voidCurrentGame);

  $("leave-button").addEventListener("click", () => {
    leaveRoom(false);
  });

  $("home-link").addEventListener("click", () => {
    if (app.roomCode) {
      if (window.confirm("离开当前牌局并回到首页？")) {
        leaveRoom(false);
      }
    }
  });

  $("copy-code").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(app.roomCode);
      showToast("房间码已复制：" + app.roomCode);
    } catch (error) {
      showToast("房间码：" + app.roomCode);
    }
  });

  $("camera-toggle").addEventListener("click", () => {
    if (app.cameraOn) {
      stopCamera();
    } else {
      startCamera();
    }
  });

  $("voice-toggle").addEventListener("click", () => {
    app.voiceEnabled = !app.voiceEnabled;
    experience.save({ narration: app.voiceEnabled ? "key" : "off" });
    $("narration-select").value = experience.preferences.narration;
    if (!app.voiceEnabled) {
      const pendingSpeechId = app.activeSpeechId;
      cancelVoice();
      if (pendingSpeechId) {
        acknowledgeSpeech(pendingSpeechId);
      }
    } else {
      loadVoices();
      speak("语音播报已开启。", "calm", "");
    }
    updateVoiceToggle();
  });

  $("music-toggle").addEventListener("click", () => {
    const audio = $("bgm-audio");
    if (!audio || !app.musicConfig) {
      return;
    }
    if (audio.paused) {
      app.musicUserEnabled = true;
      try { localStorage.setItem("liars-bgm-enabled", "on"); } catch (error) { /* optional */ }
      playBackgroundMusic();
    } else {
      app.musicUserEnabled = false;
      try { localStorage.setItem("liars-bgm-enabled", "off"); } catch (error) { /* optional */ }
      pauseBackgroundMusic();
    }
  });
}

function playTone(frequency, duration, type) {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      return;
    }
    if (!app.audioContext) {
      app.audioContext = new AudioContextClass();
    }
    const context = app.audioContext;
    if (context.state === "suspended") {
      context.resume();
    }
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type || "sine";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.06, context.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + duration + 0.03);
  } catch (error) {
    // Audio is a progressive enhancement.
  }
}

function playNoiseBurst(duration, volume) {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      return;
    }
    if (!app.audioContext) {
      app.audioContext = new AudioContextClass();
    }
    const context = app.audioContext;
    if (context.state === "suspended") {
      context.resume();
    }
    const length = Math.max(1, Math.floor(context.sampleRate * duration));
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < length; index += 1) {
      const decay = 1 - index / length;
      data[index] = (Math.random() * 2 - 1) * decay * decay;
    }
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    filter.type = "lowpass";
    filter.frequency.value = 900;
    gain.gain.value = volume || 0.12;
    source.buffer = buffer;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(context.destination);
    source.start();
  } catch (error) {
    // Audio is a progressive enhancement.
  }
}

function loadVoices() {
  if (!window.speechSynthesis) {
    return;
  }
  const all = window.speechSynthesis.getVoices() || [];
  const chinese = all.filter((voice) => /^zh/i.test(voice.lang));
  app.voices = chinese.length > 0 ? chinese : all;
}

function loadMusicPreference() {
  try {
    app.musicUserEnabled = localStorage.getItem("liars-bgm-enabled") !== "off";
  } catch (error) {
    app.musicUserEnabled = true;
  }
}

function configureTts(tts) {
  app.ttsConfig = tts && typeof tts === "object" ? tts : null;
}

function configureBackgroundMusic(music) {
  app.musicConfig = music && music.enabled && music.url ? music : null;
  const audio = $("bgm-audio");
  const button = $("music-toggle");
  if (!audio || !button) {
    return;
  }
  button.hidden = !app.musicConfig;
  if (!app.musicConfig) {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    updateMusicToggle();
    return;
  }
  if (audio.dataset.musicUrl !== app.musicConfig.url) {
    audio.dataset.musicUrl = app.musicConfig.url;
    audio.src = app.musicConfig.url;
    audio.load();
  }
  audio.loop = true;
  setBackgroundMusicDucked(false);
  updateMusicToggle();
}

function setBackgroundMusicDucked(ducked) {
  const audio = $("bgm-audio");
  if (!audio || !app.musicConfig) {
    return;
  }
  const base = Math.max(0, Math.min(0.8, Number(app.musicConfig.volume) || 0.35));
  audio.volume = Math.max(0, Math.min(1, base * (ducked ? 0.24 : 1)));
}

function updateMusicToggle() {
  const audio = $("bgm-audio");
  const button = $("music-toggle");
  if (!audio || !button) {
    return;
  }
  button.hidden = !app.musicConfig;
  if (!app.musicConfig) {
    return;
  }
  button.classList.toggle("active", !audio.paused && !audio.ended);
  button.innerHTML = !audio.paused && !audio.ended ? "<span>♫</span> 音乐开" : "<span>♪</span> 音乐关";
}

function playBackgroundMusic() {
  const audio = $("bgm-audio");
  if (!audio || !app.musicConfig || !app.musicUserEnabled) {
    updateMusicToggle();
    return;
  }
  setBackgroundMusicDucked(Boolean(app.speaking));
  audio.play().then(updateMusicToggle).catch(() => updateMusicToggle());
}

function pauseBackgroundMusic() {
  const audio = $("bgm-audio");
  if (!audio) {
    return;
  }
  audio.pause();
  setBackgroundMusicDucked(false);
  updateMusicToggle();
}

function updateVoiceToggle() {
  const button = $("voice-toggle");
  if (!button) {
    return;
  }
  button.classList.toggle("active", app.voiceEnabled);
  button.innerHTML = experience.icon(app.voiceEnabled ? "volume-2" : "volume-x") + (app.voiceEnabled ? " 语音开" : " 语音关");
  button.setAttribute("aria-pressed", String(app.voiceEnabled));
}

function resetVoiceRuntime() {
  app.voiceEpoch += 1;
  app.voiceGeneration += 1;
  if (app.cancelCurrentVoice) app.cancelCurrentVoice();
  app.cancelCurrentVoice = null;
  for (const controller of app.voiceRequests) controller.abort();
  app.voiceRequests.clear();
  for (const timer of app.voiceTimers) {
    clearTimeout(timer);
  }
  app.voiceTimers = [];
  app.voiceQueue = [];
  app.speaking = false;
  app.currentVoiceItem = null;
  releaseCurrentVoiceAudio();
  clearVoicePrefetch();
  setBackgroundMusicDucked(false);
  if (window.speechSynthesis) {
    try {
      window.speechSynthesis.cancel();
    } catch (error) {
      // Speech synthesis can be unavailable in restricted browsers.
    }
  }
}

function cancelVoice() {
  resetVoiceRuntime();
}

function interruptVoice() {
  resetVoiceRuntime();
}

function selectVoice(roleName) {
  const voices = app.voices.length > 0 ? app.voices : (window.speechSynthesis ? window.speechSynthesis.getVoices() : []);
  if (!voices || voices.length === 0) {
    return null;
  }
  let hash = 0;
  const text = String(roleName || "narrator");
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }
  return voices[hash % voices.length];
}

function roleEmotion(roleName) {
  const map = {
    DeepSeek: "calm",
    GPT: "calm",
    Claude: "tease",
    Kimi: "calm",
    "豆包": "excited",
    "千问": "calm"
  };
  return map[roleName] || "calm";
}

function voicePreset(emotion, roleName) {
  const presets = {
    calm: { rate: 0.93, pitch: 0.94 },
    tease: { rate: 1.05, pitch: 1.16 },
    excited: { rate: 1.18, pitch: 1.08 },
    surprised: { rate: 1.12, pitch: 1.28 },
    dramatic: { rate: 0.82, pitch: 0.8 }
  };
  const rolePitch = {
    DeepSeek: -0.06,
    GPT: -0.02,
    Claude: 0.07,
    Kimi: 0.02,
    "豆包": 0.12,
    "千问": -0.01
  };
  const base = presets[emotion] || presets.calm;
  return {
    rate: Math.max(0.7, Math.min(1.4, base.rate)),
    pitch: Math.max(0.6, Math.min(1.6, base.pitch + (rolePitch[roleName] || 0))),
    volume: 1
  };
}

function canUseRemoteTts() {
  return Boolean(app.voiceEnabled && app.ttsConfig && app.ttsConfig.enabled &&
    app.roomCode && app.playerId && app.playerToken);
}

function resolveTtsProfile(roleName) {
  const config = app.ttsConfig || {};
  const narratorVoice = config.narratorVoice || config.defaultVoice || "Ethan";
  if (!roleName) {
    return { voice: narratorVoice, roleId: "" };
  }
  const players = app.room && Array.isArray(app.room.players) ? app.room.players : [];
  const speaker = players.find((player) => player && player.name === roleName && (player.isAI || player.voice));
  return {
    voice: (speaker && speaker.voice) || config.defaultVoice || narratorVoice,
    roleId: (speaker && speaker.aiRoleId) || ""
  };
}

function releaseCurrentVoiceAudio() {
  const audio = app.currentVoiceAudio;
  if (audio) {
    audio.onended = null;
    audio.onerror = null;
    audio.onplaying = null;
    try {
      audio.pause();
    } catch (error) {
      // Ignore media teardown failures.
    }
  }
  if (app.currentVoiceUrl) {
    try {
      URL.revokeObjectURL(app.currentVoiceUrl);
    } catch (error) {
      // Ignore URL cleanup failures.
    }
  }
  app.currentVoiceAudio = null;
  app.currentVoiceUrl = "";
}

function voicePrefetchKey(item) {
  return String(item.roleId || "") + "\n" + String(item.voice || "") + "\n" + String(item.text || "");
}

function prefetchVoice(item) {
  if (!canUseRemoteTts() || !item || !item.text) {
    return;
  }
  const key = voicePrefetchKey(item);
  if (app.voicePrefetch.has(key)) {
    return;
  }
  const epoch = app.voiceEpoch;
  const entry = { url: "", promise: null, epoch };
  entry.promise = fetchRemoteVoiceUrl(item).then((url) => {
    if (epoch !== app.voiceEpoch || (!entry.taken && app.voicePrefetch.get(key) !== entry)) {
      URL.revokeObjectURL(url);
      return null;
    }
    entry.url = url;
    return url;
  }).catch(() => {
    if (app.voicePrefetch.get(key) === entry) app.voicePrefetch.delete(key);
    return null;
  });
  app.voicePrefetch.set(key, entry);
  while (app.voicePrefetch.size > 6) {
    const oldestKey = app.voicePrefetch.keys().next().value;
    const oldest = app.voicePrefetch.get(oldestKey);
    app.voicePrefetch.delete(oldestKey);
    if (oldest && oldest.url) {
      URL.revokeObjectURL(oldest.url);
    }
  }
}

function takePrefetchedVoice(item) {
  const key = voicePrefetchKey(item);
  const entry = app.voicePrefetch.get(key);
  if (!entry) {
    return null;
  }
  entry.taken = true;
  app.voicePrefetch.delete(key);
  return entry.promise || entry.url || null;
}

function clearVoicePrefetch() {
  for (const entry of app.voicePrefetch.values()) {
    if (entry.url) {
      URL.revokeObjectURL(entry.url);
    }
  }
  app.voicePrefetch.clear();
}

async function fetchRemoteVoiceUrl(item) {
  const controller = new AbortController();
  app.voiceRequests.add(controller);
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch("/api/tts", {
      signal: controller.signal,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        roomCode: app.roomCode,
        playerId: app.playerId,
        token: app.playerToken,
        text: item.text,
        voice: item.voice,
        roleId: item.roleId || ""
      })
    });
    if (!response.ok) {
      let detail = "";
      try {
        const payload = await response.json();
        detail = payload.error || "";
      } catch (error) {
        detail = "";
      }
      throw new Error(detail || "大模型语音合成失败。");
    }
    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    if (!contentType.startsWith("audio/") && !contentType.includes("application/octet-stream")) {
      throw new Error("大模型语音返回了无效格式。");
    }
    const blob = await response.blob();
    if (!blob.size) {
      throw new Error("大模型语音返回了空音频。");
    }
    return URL.createObjectURL(blob);
  } finally {
    clearTimeout(timeout);
    app.voiceRequests.delete(controller);
  }
}

function playBrowserVoice(item, finish) {
  if (!window.speechSynthesis || typeof SpeechSynthesisUtterance === "undefined") {
    setTimeout(finish, 0);
    return;
  }
  const utterance = new SpeechSynthesisUtterance(item.text);
  const profile = voicePreset(item.emotion, item.roleName);
  const voice = selectVoice(item.roleName);
  utterance.lang = "zh-CN";
  utterance.rate = profile.rate;
  utterance.pitch = profile.pitch;
  utterance.volume = profile.volume;
  if (voice) {
    utterance.voice = voice;
  }
  utterance.onend = finish;
  utterance.onerror = finish;
  try {
    window.speechSynthesis.resume();
    window.speechSynthesis.speak(utterance);
  } catch (error) {
    finish();
  }
}

function handlePendingSpeech(state) {
  const pending = state && state.pendingSpeech;
  if (!pending || !pending.id) {
    app.activeSpeechId = null;
    clearTimeout(app.speechWatchdog);
    app.speechWatchdog = null;
    processFxQueue();
    return;
  }
  if (app.ackedSpeechIds.has(pending.id) || app.activeSpeechId === pending.id) {
    return;
  }
  app.activeSpeechId = pending.id;
  const done = () => acknowledgeSpeech(pending.id);
  if (!app.voiceEnabled || (!canUseRemoteTts() && !window.speechSynthesis)) {
    setTimeout(done, 0);
    return;
  }
  clearTimeout(app.speechWatchdog);
  const maxMs = Math.max(25000, Math.min(60000, Array.from(pending.text || "").length * 250 + 20000));
  app.speechWatchdog = setTimeout(() => {
    app.speechWatchdog = null;
    if (app.activeSpeechId !== pending.id) return;
    resetVoiceRuntime();
    acknowledgeSpeech(pending.id);
  }, maxMs);
  app.activeSpeechId = pending.id;
  speak(pending.text, roleEmotion(pending.playerName), pending.playerName, "high", done);
}

async function acknowledgeSpeech(speechId) {
  if (!speechId || app.ackedSpeechIds.has(speechId)) {
    return;
  }
  app.ackedSpeechIds.add(speechId);
  clearTimeout(app.speechWatchdog);
  app.speechWatchdog = null;
  if (app.activeSpeechId === speechId) {
    app.activeSpeechId = null;
  }
  setTimeout(processFxQueue, 0);
  setTimeout(maybeShowVictorySettlement, 0);
  if (!app.playerId || !app.playerToken || !app.roomCode) {
    return;
  }
  try {
    await apiRequest("/api/rooms/" + encodeURIComponent(app.roomCode) + "/speech-done", {
      method: "POST",
      body: {
        playerId: app.playerId,
        token: app.playerToken,
        speechId
      }
    });
  } catch (error) {
    // The server fallback releases the table if an acknowledgement is lost.
  }
}

function speak(text, emotion, roleName, priority, onEnd) {
  if (!app.voiceEnabled || (!canUseRemoteTts() && !window.speechSynthesis)) {
    if (typeof onEnd === "function") {
      setTimeout(onEnd, 0);
    }
    return;
  }
  const clean = String(text || "").replace(/\s+/g, " ").trim().slice(0, 220);
  if (!clean) {
    if (typeof onEnd === "function") {
      setTimeout(onEnd, 0);
    }
    return;
  }
  const profile = resolveTtsProfile(roleName || "");
  const item = {
    text: clean,
    emotion: emotion || "calm",
    roleName: roleName || "",
    voice: profile.voice,
    roleId: profile.roleId,
    onEnd
  };
  if (priority === "high") app.voiceQueue.unshift(item);
  else app.voiceQueue.push(item);
  drainVoiceQueue();
}

function drainVoiceQueue() {
  if (app.speaking || app.voiceQueue.length === 0) {
    return;
  }
  app.speaking = true;
  setBackgroundMusicDucked(true);
  const epoch = app.voiceEpoch;
  const item = app.voiceQueue.shift();
  app.currentVoiceItem = item;
  app.voiceMetrics.started += 1;
  let settled = false;
  let fallbackStarted = false;
  let watchdog = null;
  let startTimer = null;
  app.cancelCurrentVoice = () => {
    settled = true;
    clearTimeout(watchdog);
    clearTimeout(startTimer);
  };
  const finish = () => {
    if (settled) {
      return;
    }
    settled = true;
    clearTimeout(watchdog);
    clearTimeout(startTimer);
    if (epoch !== app.voiceEpoch) return;
    app.cancelCurrentVoice = null;
    app.voiceMetrics.completed += 1;
    releaseCurrentVoiceAudio();
    if (app.currentVoiceItem === item) {
      app.currentVoiceItem = null;
    }
    app.speaking = false;
    setBackgroundMusicDucked(false);
    if (typeof item.onEnd === "function") {
      item.onEnd();
    }
    setTimeout(() => {
      drainVoiceQueue();
      if (!app.speaking && app.voiceQueue.length === 0 && app.voiceTimers.length === 0) {
        maybeShowVictorySettlement();
      }
    }, 70);
  };
  const fallback = () => {
    if (settled || fallbackStarted || epoch !== app.voiceEpoch) {
      return;
    }
    fallbackStarted = true;
    clearTimeout(startTimer);
    app.voiceMetrics.fallbacks += 1;
    releaseCurrentVoiceAudio();
    playBrowserVoice(item, finish);
  };
  const maxMs = Math.max(18000, Math.min(45000, Array.from(item.text).length * 250 + 15000));
  watchdog = setTimeout(() => {
    releaseCurrentVoiceAudio();
    try {
      window.speechSynthesis.cancel();
    } catch (error) {
      // Ignore restricted speech engines.
    }
    finish();
  }, maxMs);
  if (!canUseRemoteTts()) {
    fallback();
    return;
  }
  const prefetched = takePrefetchedVoice(item);
  const requestUrl = prefetched
    ? Promise.resolve(prefetched).then((url) => url || (!settled && epoch === app.voiceEpoch ? fetchRemoteVoiceUrl(item) : null))
    : fetchRemoteVoiceUrl(item);
  requestUrl.then((url) => {
    if (!url) return;
    if (settled || fallbackStarted || epoch !== app.voiceEpoch) {
      URL.revokeObjectURL(url);
      return;
    }
    app.currentVoiceUrl = url;
    const audio = new Audio(url);
    app.currentVoiceAudio = audio;
    audio.preload = "auto";
    audio.onended = finish;
    audio.onerror = fallback;
    startTimer = setTimeout(fallback, 2500);
    audio.onplaying = () => clearTimeout(startTimer);
    const playback = audio.play();
    if (playback && typeof playback.catch === "function") {
      playback.catch(fallback);
    }
  }).catch(fallback);
}

function scheduleSpeech(delay, text, emotion, roleName, priority) {
  const timer = setTimeout(() => {
    app.voiceTimers = app.voiceTimers.filter((item) => item !== timer);
    speak(text, emotion, roleName, priority);
  }, delay);
  app.voiceTimers.push(timer);
}

function narrationForEvent(event) {
  if (!app.voiceEnabled || experience.preferences.narration !== "key") {
    return null;
  }
  if (event.type === "play") {
    return null;
  } else if (event.type === "round") {
    return { text: "第 " + event.round + " 轮，桌面点数 " + event.rank + "。", emotion: "calm", roleName: "" };
  } else if (event.type === "reveal") {
    const reveal = event.reveal;
    return {
      text: reveal.truthful ? "亮牌属实，质疑失败。" : "抓到谎言，质疑成功。",
      emotion: reveal.truthful ? "surprised" : "excited",
      roleName: ""
    };
  } else if (event.type === "execution") {
    return null;
  } else if (event.type === "gameover") {
    return { text: "牌局结束，" + event.winnerName + " 获胜。", emotion: "excited", roleName: "" };
  }
  return null;
}

function narrateFx(event) {
  const narration = narrationForEvent(event);
  if (narration) {
    speak(narration.text, narration.emotion, narration.roleName);
  }
}

function updateVoidGameButton(state) {
  const button = $("void-game-button");
  if (!button) {
    return;
  }
  const active = Boolean(state && ["playing", "out_challenge"].includes(state.phase) &&
    state.hostId && state.hostId === app.playerId);
  button.hidden = !active;
  button.disabled = app.voidingGame;
}

function resetAfterVoid() {
  app.fxGeneration += 1;
  app.animationQueue = [];
  app.fxAnimating = false;
  app.selected.clear();
  resetVoiceRuntime();
  const overlay = $("table-fx");
  if (overlay) {
    overlay.className = "table-fx";
    overlay.innerHTML = "";
    overlay.setAttribute("aria-hidden", "true");
  }
  const layer = $("table-effect-layer");
  if (layer) {
    layer.innerHTML = "";
  }
  const stage = $("table-stage");
  if (stage) {
    stage.classList.remove("cards-in-flight", "reveal-active");
  }
  document.querySelectorAll(".action-flash, .action-shot").forEach((element) => {
    element.classList.remove("action-flash", "action-shot");
  });
}

function buildRecap() {
  if (!app.room || !Array.isArray(app.room.log)) {
    return "";
  }
  const events = app.room.log
    .filter((entry) => ["round", "play", "challenge", "death", "roundend", "gameover"].includes(entry.type))
    .slice(-6)
    .map((entry) => entry.text);
  return ("复盘：" + events.join(" ")).slice(0, 240);
}

function getRemoteHuman(state) {
  if (!state || !state.me) {
    return null;
  }
  return state.players.find((player) => {
    return player.occupied && !player.isAI && player.id && player.id !== state.me.id;
  }) || null;
}

function updateCameraUi() {
  const dock = $("camera-dock");
  const localTile = dock.querySelector(".camera-local");
  const remoteTile = dock.querySelector(".camera-remote");
  const toggle = $("camera-toggle");
  localTile.classList.toggle("has-video", Boolean(app.localStream));
  remoteTile.classList.toggle("has-video", Boolean(app.remoteStream));
  toggle.classList.toggle("active", app.cameraOn);
  toggle.innerHTML = experience.icon(app.cameraOn ? "camera-off" : "camera") + (app.cameraOn ? " 关闭摄像头" : " 开启摄像头");
  toggle.setAttribute("aria-pressed", String(app.cameraOn));
  const remote = app.room ? getRemoteHuman(app.room) : null;
  $("remote-label").textContent = remote ? remote.name : "对家";
  dock.hidden = !(app.cameraOn || app.remoteStream || (app.pc && app.remoteCameraOn));
}

async function startCamera() {
  if (app.cameraOn || app.cameraStarting) {
    return;
  }
  if (!app.room || !app.room.me) {
    showToast("观战模式不能开启摄像头。", true);
    return;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showToast("当前浏览器或访问方式不支持摄像头，请使用 HTTPS 或 localhost。", true);
    return;
  }
  const requestId = app.cameraRequestId + 1;
  app.cameraRequestId = requestId;
  app.cameraStarting = true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 360 }, facingMode: "user" },
      audio: false
    });
    if (requestId !== app.cameraRequestId || !app.room) {
      for (const track of stream.getTracks()) {
        track.stop();
      }
      return;
    }
    app.localStream = stream;
    app.cameraOn = true;
    $("local-video").srcObject = stream;
    updateCameraUi();
    const remote = getRemoteHuman(app.room);
    if (remote) {
      if (app.pc) {
        attachLocalTracks(app.pc);
        schedulePeerOffer(app.pc, app.polite && !app.pc.remoteDescription ? 1400 : 80);
      } else {
        ensurePeer(remote);
      }
      sendSignal({ kind: "camera", enabled: true });
    }
    showToast("摄像头已开启。视频仅在真人浏览器之间点对点传输。");
  } catch (error) {
    if (requestId === app.cameraRequestId) {
      showToast("无法开启摄像头：" + (error.message || "请检查浏览器权限"), true);
    }
  } finally {
    if (requestId === app.cameraRequestId) {
      app.cameraStarting = false;
    }
  }
}

function stopCamera() {
  if (app.cameraOn && app.remoteId) sendSignal({ kind: "camera", enabled: false });
  app.cameraRequestId += 1;
  app.cameraStarting = false;
  if (app.localStream) {
    for (const track of app.localStream.getTracks()) {
      track.stop();
    }
  }
  app.localStream = null;
  app.cameraOn = false;
  $("local-video").srcObject = null;
  if (app.pc) {
    for (const sender of app.pc.getSenders()) {
      if (sender.track) {
        try {
          app.pc.removeTrack(sender);
        } catch (error) {
          // The peer can be closed concurrently.
        }
      }
    }
  }
  if (!app.remoteStream) {
    closePeer();
  }
  updateCameraUi();
}

function closePeer() {
  clearTimeout(app.peerRetryTimer);
  app.peerRetryTimer = null;
  clearTimeout(app.offerTimer);
  app.offerTimer = null;
  app.peerRetryCount = 0;
  app.pendingIce = [];
  app.makingOffer = false;
  app.ignoreOffer = false;
  app.isSettingRemoteAnswerPending = false;
  if (app.pc) {
    try {
      app.pc.close();
    } catch (error) {
      // Closing twice is harmless.
    }
  }
  app.pc = null;
  app.remoteId = null;
  app.remoteSeat = null;
  app.remoteStream = null;
  app.remoteCameraOn = false;
  const video = $("remote-video");
  if (video) {
    video.srcObject = null;
  }
  updateCameraUi();
}

function ensurePeer(remote) {
  if (!remote || !remote.id || !app.room || !app.room.me) {
    return null;
  }
  if (app.pc && app.remoteId === remote.id) {
    return app.pc;
  }
  if (app.pc) {
    closePeer();
  }
  app.remoteId = remote.id;
  app.remoteSeat = remote.seat;
  const mySeat = app.room.me.seat;
  app.polite = mySeat > remote.seat;
  const pc = new RTCPeerConnection({ iceServers: app.iceServers });
  app.pc = pc;

  pc.onicecandidate = (event) => {
    if (app.pc !== pc) {
      return;
    }
    if (event.candidate && app.remoteId) {
      sendSignal({ kind: "ice", candidate: event.candidate });
    }
  };
  pc.ontrack = (event) => {
    if (app.pc !== pc) {
      return;
    }
    app.remoteCameraOn = true;
    if (event.streams && event.streams[0]) {
      app.remoteStream = event.streams[0];
    } else {
      if (!app.remoteStream) {
        app.remoteStream = new MediaStream();
      }
      app.remoteStream.addTrack(event.track);
    }
    event.track.addEventListener("ended", () => {
      if (app.pc !== pc) {
        return;
      }
      app.remoteStream = null;
      app.remoteCameraOn = false;
      $("remote-video").srcObject = null;
      updateCameraUi();
    });
    $("remote-video").srcObject = app.remoteStream;
    updateCameraUi();
  };
  pc.onconnectionstatechange = () => {
    if (app.pc !== pc) {
      return;
    }
    if (pc.connectionState === "connected") {
      clearTimeout(app.peerRetryTimer);
      app.peerRetryTimer = null;
    } else if (pc.connectionState === "failed") {
      retryPeerConnection(pc);
    }
  };
  pc.oniceconnectionstatechange = () => {
    if (app.pc !== pc) {
      return;
    }
    if (pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed") {
      clearTimeout(app.peerRetryTimer);
      app.peerRetryTimer = null;
    }
  };
  pc.onnegotiationneeded = async () => {
    if (app.pc !== pc) {
      return;
    }
    schedulePeerOffer(pc);
  };
  if (app.localStream) {
    attachLocalTracks(pc);
    schedulePeerOffer(pc, app.polite ? 1400 : 60);
  }
  schedulePeerRetry(pc);
  updateCameraUi();
  return pc;
}

function schedulePeerOffer(pc, delay) {
  if (!pc || app.pc !== pc) {
    return;
  }
  const wait = typeof delay === "number"
    ? delay
    : (app.polite && !pc.remoteDescription ? 1400 : 80);
  clearTimeout(app.offerTimer);
  app.offerTimer = setTimeout(() => {
    if (app.pc === pc) {
      makePeerOffer(pc);
    }
  }, wait);
}

function schedulePeerRetry(pc) {
  clearTimeout(app.peerRetryTimer);
  app.peerRetryTimer = setTimeout(() => {
    if (app.pc !== pc) {
      return;
    }
    if (pc.connectionState === "connected" || pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed") {
      return;
    }
    retryPeerConnection(pc);
  }, 4000);
}

function retryPeerConnection(pc) {
  if (!pc || app.pc !== pc) {
    return;
  }
  if (app.peerRetryCount >= 2) {
    showToast("视频连接未能建立，请双方关闭后重新开启摄像头。", true);
    return;
  }
  app.peerRetryCount += 1;
  try {
    pc.restartIce();
  } catch (error) {
    // Older browsers can still renegotiate without an explicit restart.
  }
  makePeerOffer(pc);
  schedulePeerRetry(pc);
}

function attachLocalTracks(pc) {
  if (!pc || !app.localStream) {
    return;
  }
  const senders = pc.getSenders();
  for (const track of app.localStream.getTracks()) {
    const alreadyAttached = senders.some((sender) => sender.track === track);
    if (!alreadyAttached) {
      pc.addTrack(track, app.localStream);
    }
  }
}

async function makePeerOffer(pc) {
  if (!app.pc || app.pc !== pc || app.makingOffer || pc.signalingState !== "stable") {
    return;
  }
  try {
    app.makingOffer = true;
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await sendSignal({ kind: "description", description: pc.localDescription });
  } catch (error) {
    // A later state change will retry.
  } finally {
    app.makingOffer = false;
  }
}

async function sendSignal(signal) {
  if (!app.roomCode || !app.playerId || !app.remoteId) {
    return;
  }
  try {
    await apiRequest("/api/rooms/" + encodeURIComponent(app.roomCode) + "/signal", {
      method: "POST",
      body: {
        playerId: app.playerId,
        token: app.playerToken,
        targetPlayerId: app.remoteId,
        signal
      }
    });
  } catch (error) {
    // Signaling retries are handled by connection state changes.
  }
}

async function flushPendingIce() {
  if (!app.pc || !app.pc.remoteDescription) {
    return;
  }
  const queued = app.pendingIce.slice();
  app.pendingIce = [];
  for (const candidate of queued) {
    try {
      await app.pc.addIceCandidate(candidate);
    } catch (error) {
      // Ignore stale candidates.
    }
  }
}

async function handlePeerDescription(description) {
  const pc = app.pc;
  if (!pc) {
    return;
  }
  const readyForOffer = !app.makingOffer && (pc.signalingState === "stable" || app.isSettingRemoteAnswerPending);
  const offerCollision = description.type === "offer" && !readyForOffer;
  app.ignoreOffer = !app.polite && offerCollision;
  if (app.ignoreOffer) {
    return;
  }
  try {
    if (offerCollision && app.polite) {
      await pc.setLocalDescription({ type: "rollback" });
    }
    if (description.type === "offer") {
      clearTimeout(app.offerTimer);
      app.offerTimer = null;
    }
    app.isSettingRemoteAnswerPending = description.type === "answer";
    await pc.setRemoteDescription(description);
    app.isSettingRemoteAnswerPending = false;
    if (description.type === "offer") {
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await sendSignal({ kind: "description", description: pc.localDescription });
    }
    await flushPendingIce();
  } catch (error) {
    app.isSettingRemoteAnswerPending = false;
  }
}

async function handlePeerIce(candidate) {
  if (!app.pc) {
    return;
  }
  if (!app.pc.remoteDescription) {
    app.pendingIce.push(candidate);
    return;
  }
  try {
    await app.pc.addIceCandidate(candidate);
  } catch (error) {
    // Ignore candidates from an old negotiation.
  }
}

async function handlePeerSignal(payload) {
  if (!payload || !payload.signal || !payload.from) {
    return;
  }
  if (payload.signal.kind === "camera") {
    app.remoteCameraOn = Boolean(payload.signal.enabled);
    if (!app.remoteCameraOn) {
      app.remoteStream = null;
      $("remote-video").srcObject = null;
      if (!app.cameraOn) closePeer();
    }
    updateCameraUi();
    return;
  }
  let remote = app.room ? app.room.players.find((player) => player.id === payload.from) : null;
  if (!remote) {
    remote = { id: payload.from, seat: 99, name: payload.fromName || "对家", isAI: false, occupied: true };
  }
  if (app.remoteId && app.remoteId !== remote.id) {
    closePeer();
  }
  app.remoteId = remote.id;
  app.remoteSeat = remote.seat;
  ensurePeer(remote);
  updateCameraUi();
  if (payload.signal.kind === "description") {
    await handlePeerDescription(payload.signal.description);
  } else if (payload.signal.kind === "ice") {
    await handlePeerIce(payload.signal.candidate);
  }
}

function syncPeer(state) {
  if (!state || !state.me) {
    if (app.pc) {
      closePeer();
    }
    return;
  }
  const remote = getRemoteHuman(state);
  if (!remote) {
    if (app.pc) {
      closePeer();
    }
    return;
  }
  app.remoteSeat = remote.seat;
  if (app.localStream) {
    ensurePeer(remote);
  }
  updateCameraUi();
}

function wireHomeEvents() {
  $("login-form").addEventListener("submit", loginAccount);
  $("enter-table").addEventListener("click", enterTable);
  $("change-name").addEventListener("click", () => openUsernameDialog(false));
  $("account-leaderboard").addEventListener("click", openLeaderboard);
  $("logout-account").addEventListener("click", logoutAccount);
  $("username-form").addEventListener("submit", submitUsername);
}

async function restoreSession() {
  const token = loadSessionToken();
  if (!token) {
    setAccount(null);
    return;
  }
  app.sessionToken = token;
  const account = await refreshAccount();
  if (!account) {
    setAccount(null);
    return;
  }
  setAccount(account);
  if (account.needsUsername) {
    app.pendingEnterAfterName = true;
    openUsernameDialog(Boolean(account.pendingRename));
    return;
  }
  await enterTable();
}

function wireExperience() {
  $("motion-select").value = experience.preferences.motion;
  $("narration-select").value = experience.preferences.narration;
  $("experience-button").addEventListener("click", () => openDialog("experience-dialog"));
  $("camera-size-toggle").addEventListener("click", () => {
    const expanded = $("camera-dock").classList.toggle("expanded");
    $("camera-size-toggle").setAttribute("aria-expanded", String(expanded));
    $("camera-size-toggle").setAttribute("aria-label", expanded ? "缩小视频" : "放大视频");
    $("camera-size-toggle").innerHTML = experience.icon(expanded ? "minimize" : "expand");
  });
  $("motion-select").addEventListener("change", event => {
    experience.save({ motion: event.target.value });
  });
  $("narration-select").addEventListener("change", event => {
    experience.save({ narration: event.target.value });
    app.voiceEnabled = event.target.value !== "off";
    if (!app.voiceEnabled) {
      const pendingId = app.activeSpeechId;
      cancelVoice();
      if (pendingId) acknowledgeSpeech(pendingId);
    }
    updateVoiceToggle();
  });
  $("sort-hand").addEventListener("click", () => {
    app.handSorted = !app.handSorted;
    $("sort-hand").textContent = app.handSorted ? "恢复顺序" : "理牌";
    if (app.room) renderHand(app.room);
  });
  $("clear-selection").addEventListener("click", () => {
    app.selected.clear();
    if (app.room) { renderHand(app.room); renderActionBar(app.room); }
  });
  $("reconnect-button").addEventListener("click", () => {
    if (app.roomCode) connectEvents();
  });
  window.addEventListener("online", () => {
    if (app.roomCode && !app.connected) connectEvents();
  });
  window.addEventListener("offline", () => {
    if (!app.roomCode) return;
    app.connected = false;
    closeEvents();
    $("connection-banner").hidden = false;
    setConnectionStatus("网络已断开", true);
    if (app.room) renderActionBar(app.room);
  });
  document.addEventListener("keydown", event => {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey ||
      !app.room || document.querySelector("dialog[open]") ||
      event.target.closest("input, textarea, select, [contenteditable=true]")) return;
    if (/^[1-5]$/.test(event.key)) {
      const card = $("hand-row").querySelectorAll("[data-card-id]")[Number(event.key) - 1];
      if (card && !card.disabled) { event.preventDefault(); card.click(); }
    } else if (event.key === "Enter") {
      const play = $("action-bar").querySelector("[data-action=play]");
      if (play && !play.disabled && !app.actionPending) { event.preventDefault(); play.click(); }
    } else if (event.key === "Escape" && app.selected.size) {
      event.preventDefault();
      $("clear-selection").click();
    }
  });
}

async function initialize() {
  document.body.dataset.page = "home";
  wireExperience();
  loadMusicPreference();
  wireDialogs();
  wireHomeEvents();
  wireRoomEvents();
  loadVoices();
  updateVoiceToggle();
  if (window.speechSynthesis) {
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }
  setInterval(updateTurnClock, 500);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && app.activeSpeechId) {
      const speechId = app.activeSpeechId;
      resetVoiceRuntime();
      acknowledgeSpeech(speechId);
    }
    if (document.hidden && app.room && app.room.cinematicId) {
      acknowledgeCinematic(app.room.cinematicId);
    }
  });
  window.addEventListener("pagehide", () => {
    if (app.activeSpeechId) {
      acknowledgeSpeech(app.activeSpeechId);
    }
  });
  renderAllProfiles();
  try {
    const results = await Promise.all([
      apiRequest("/api/config"),
      apiRequest("/api/ai-roles")
    ]);
    const config = results[0];
    const roles = results[1];
    if (Array.isArray(config.iceServers) && config.iceServers.length > 0) {
      app.iceServers = config.iceServers;
    }
    configureBackgroundMusic(config.music);
    configureTts(config.tts);
    app.aiRoles = Array.isArray(roles.roles) ? roles.roles : [];
    renderAllProfiles();
  } catch (error) {
    showToast("无法读取 AI 阵容，请确认服务端配置。", true);
  }
  await restoreSession();
}

initialize();
