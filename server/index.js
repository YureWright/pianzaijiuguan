"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");
const { RoomStore } = require("./rooms");
const { AdminStore } = require("./admin");
const { AccountStore } = require("./accounts");
const ai = require("./ai");
const ttsService = require("./tts");
const doubaoTtsService = require("./doubaoTts");

function loadDotEnv() {
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) {
    return;
  }
  const content = fs.readFileSync(envPath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const index = line.indexOf("=");
    if (index < 1) {
      continue;
    }
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!Object.prototype.hasOwnProperty.call(process.env, key)) {
      process.env[key] = value;
    }
  }
}

loadDotEnv();

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";
const PUBLIC_DIR = path.join(__dirname, "..", "public");

function parseIceServers() {
  const raw = process.env.ICE_SERVERS;
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch (error) {
      const urls = raw.split(",").map((item) => item.trim()).filter(Boolean);
      if (urls.length > 0) {
        return urls.map((url) => ({ urls: url }));
      }
    }
  }
  return [{ urls: "stun:stun.l.google.com:19302" }];
}

function serverModelProfiles() {
  const profiles = [];
  if (process.env.AI_MODEL_PROFILES) {
    try {
      const parsed = JSON.parse(process.env.AI_MODEL_PROFILES);
      if (Array.isArray(parsed)) {
        profiles.push.apply(profiles, parsed);
      }
    } catch (error) {
      console.warn("AI_MODEL_PROFILES is not valid JSON");
    }
  }
  if (process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL) {
    profiles.push({
      name: process.env.OPENAI_PROFILE_NAME || "OpenAI " + process.env.OPENAI_MODEL,
      provider: "openai",
      baseUrl: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
      model: process.env.OPENAI_MODEL,
      apiKey: process.env.OPENAI_API_KEY
    });
  }
  if (process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_MODEL) {
    profiles.push({
      name: process.env.ANTHROPIC_PROFILE_NAME || "Claude " + process.env.ANTHROPIC_MODEL,
      provider: "anthropic",
      baseUrl: process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com/v1",
      model: process.env.ANTHROPIC_MODEL,
      apiKey: process.env.ANTHROPIC_API_KEY
    });
  }
  if (process.env.GEMINI_API_KEY && process.env.GEMINI_MODEL) {
    profiles.push({
      name: process.env.GEMINI_PROFILE_NAME || "Gemini " + process.env.GEMINI_MODEL,
      provider: "gemini",
      baseUrl: process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta",
      model: process.env.GEMINI_MODEL,
      apiKey: process.env.GEMINI_API_KEY
    });
  }
  return profiles;
}

const ICE_SERVERS = parseIceServers();
const adminStore = new AdminStore();
const accountStore = new AccountStore();
const store = new RoomStore({ adminStore, accountStore });
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8"
};

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body)
  });
  response.end(body);
}

function sendAudio(response, status, audio, cacheControl) {
  response.writeHead(status, {
    "Content-Type": audio.contentType || "audio/mpeg",
    "Cache-Control": cacheControl || "private, max-age=3600",
    "Content-Length": audio.buffer.length
  });
  response.end(audio.buffer);
}

function sendText(response, status, text) {
  response.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(text);
}

async function readJson(request, maxBytes) {
  const chunks = [];
  let size = 0;
  const limit = Number(maxBytes) || 1024 * 1024;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) {
      throw new Error("Request body is too large");
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) {
    return {};
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function serveStatic(response, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  let decoded;
  try {
    decoded = decodeURIComponent(requested);
  } catch (error) {
    sendText(response, 400, "Bad request");
    return;
  }
  const fullPath = path.resolve(PUBLIC_DIR, "." + decoded);
  if (!fullPath.startsWith(PUBLIC_DIR + path.sep)) {
    sendText(response, 403, "Forbidden");
    return;
  }
  fs.readFile(fullPath, (error, data) => {
    if (error) {
      sendText(response, 404, "Not found");
      return;
    }
    const ext = path.extname(fullPath).toLowerCase();
    response.writeHead(200, {
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
      "Cache-Control": "no-cache",
      "Content-Length": data.length
    });
    response.end(data);
  });
}

function roomCodeFromPath(pathname, suffix) {
  const pattern = new RegExp("^/api/rooms/([A-Za-z0-9]+)/" + suffix + "$");
  const match = pathname.match(pattern);
  return match ? match[1].toUpperCase() : null;
}

function adminRoleIdFromPath(pathname) {
  const match = pathname.match(/^\/api\/admin\/roles\/([A-Za-z0-9-]+)$/);
  return match ? match[1] : null;
}

function bearerToken(request) {
  const header = String(request.headers.authorization || "");
  if (!header.startsWith("Bearer ")) {
    return "";
  }
  return header.slice(7).trim();
}

function requireAdmin(request, response) {
  const token = bearerToken(request);
  if (!adminStore.authenticate(token)) {
    sendJson(response, 401, { error: "管理员登录已失效。" });
    return null;
  }
  return token;
}

async function handleApi(request, response, url) {
  if (request.method === "GET" && url.pathname === "/api/health") {
    sendJson(response, 200, { ok: true, time: Date.now() });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/config") {
    const publicTts = adminStore.publicTts();
    const publicDoubao = adminStore.publicDoubao();
    sendJson(response, 200, {
      appName: "骗子酒馆",
      maxHumans: 2,
      maxPlayers: 4,
      iceServers: ICE_SERVERS,
      providers: {
        openai: "https://api.openai.com/v1",
        anthropic: "https://api.anthropic.com/v1",
        gemini: "https://generativelanguage.googleapis.com/v1beta"
      },
      aiRoleCount: adminStore.enabledRoles().length,
      music: adminStore.publicMusic(),
      tts: Object.assign(publicTts, { enabled: Boolean(publicTts.enabled || publicDoubao.enabled) }),
      adminEnabled: true
    });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/ai-roles") {
    sendJson(response, 200, {
      roles: adminStore.enabledRoles().map((role) => adminStore.publicView(role))
    });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/tts") {
    const body = await readJson(request);
    const roomCode = String(body.roomCode || "").trim().toUpperCase();
    if (!roomCode || !store.authenticatePlayer(roomCode, body.playerId, body.token)) {
      sendJson(response, 401, { error: "语音请求未通过牌桌身份验证。" });
      return true;
    }
    const startedAt = Date.now();
    try {
      const role = body.roleId ? adminStore.getRole(String(body.roleId), true) : null;
      const useDoubao = Boolean(role && role.ttsProvider === "doubao");
      let audio;
      let providerUsed = "qwen";
      if (useDoubao) {
        const doubaoSettings = adminStore.getDoubao();
        const doubaoReady = doubaoSettings.authMode === "apikey"
          ? Boolean(doubaoSettings.apiKey && doubaoSettings.resourceId)
          : Boolean(doubaoSettings.appId && doubaoSettings.accessToken);
        if (doubaoSettings.enabled && doubaoReady) {
          try {
            audio = await doubaoTtsService.synthesize(doubaoSettings, {
              text: body.text,
              voice: role.voice || doubaoSettings.voiceType,
              timeoutMs: 30000
            });
            providerUsed = "doubao";
          } catch (doubaoError) {
            console.warn("[tts] doubao failed, falling back to qwen:", doubaoError.message);
          }
        }
        if (!audio) {
          const qwenSettings = adminStore.getTts();
          if (!qwenSettings.enabled) {
            sendJson(response, 503, { error: "豆包语音调用失败，千问备用语音也未启用。" });
            return true;
          }
          audio = await ttsService.synthesize(qwenSettings, {
            text: body.text,
            voice: qwenSettings.defaultVoice,
            timeoutMs: 30000
          });
          providerUsed = "qwen-fallback";
        }
      } else {
        const settings = adminStore.getTts();
        if (!settings.enabled) {
          sendJson(response, 503, { error: "大模型语音尚未启用。" });
          return true;
        }
        audio = await ttsService.synthesize(settings, {
          text: body.text,
          voice: (role && role.voice) || body.voice || settings.narratorVoice,
          timeoutMs: 30000
        });
      }
      console.log("[tts] " + providerUsed + " " + (Date.now() - startedAt) + "ms, " +
        Array.from(String(body.text || "")).length + " chars");
      sendAudio(response, 200, audio);
    } catch (error) {
      console.warn("[tts] synthesis failed:", error.message);
      sendJson(response, 502, { error: error.message });
    }
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/account/login") {
    const body = await readJson(request);
    const result = accountStore.login(body.location, body.key);
    if (result.error) {
      sendJson(response, 401, { error: result.error });
      return true;
    }
    sendJson(response, 200, { sessionToken: result.token, account: result.account });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/account/session") {
    const body = await readJson(request);
    const account = accountStore.authenticate(body.sessionToken);
    if (!account) {
      sendJson(response, 401, { error: "登录已失效，请重新登录。" });
      return true;
    }
    sendJson(response, 200, { account: accountStore.publicAccount(account) });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/account/username") {
    const body = await readJson(request);
    const account = accountStore.authenticate(body.sessionToken);
    if (!account) {
      sendJson(response, 401, { error: "登录已失效，请重新登录。" });
      return true;
    }
    const result = accountStore.setUsername(body.sessionToken, body.username, {
      blocked: store.accountRenameBlocked(account.id)
    });
    if (result.error) {
      sendJson(response, 400, { error: result.error });
      return true;
    }
    store.syncAccountProfile(account);
    sendJson(response, 200, result);
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/account/logout") {
    const body = await readJson(request);
    accountStore.logout(body.sessionToken);
    sendJson(response, 200, { ok: true });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/leaderboard") {
    sendJson(response, 200, accountStore.leaderboard(adminStore.enabledRoles()));
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/table/enter") {
    const body = await readJson(request);
    const account = accountStore.authenticate(body.sessionToken);
    if (!account) {
      sendJson(response, 401, { error: "登录已失效，请重新登录。" });
      return true;
    }
    const mainRoom = store.rooms.get("MAIN");
    const existingSeat = mainRoom && mainRoom.players.some((player) =>
      player.occupied && player.accountId === account.id);
    const canWatchCurrentGame = existingSeat &&
      (mainRoom.phase === "playing" || mainRoom.phase === "out_challenge");
    if (!account.username || (account.pendingRename && !canWatchCurrentGame)) {
      sendJson(response, 409, {
        error: account.pendingRename ? "你已被淘汰，请先更换用户名。" : "请先设置用户名。",
        code: "USERNAME_REQUIRED",
        account: accountStore.publicAccount(account)
      });
      return true;
    }
    const result = store.enterMainTable(account);
    if (result.error) {
      sendJson(response, 400, { error: result.error });
      return true;
    }
    sendJson(response, 200, {
      roomCode: result.roomCode,
      playerId: result.playerId,
      playerToken: result.playerToken,
      viewerId: result.viewerId,
      spectator: result.spectator,
      account: accountStore.publicAccount(account)
    });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/table/start") {
    const body = await readJson(request);
    const account = accountStore.authenticate(body.sessionToken);
    if (!account) {
      sendJson(response, 401, { error: "登录已失效，请重新登录。" });
      return true;
    }
    const entry = store.enterMainTable(account);
    if (entry.error) {
      sendJson(response, 400, { error: entry.error });
      return true;
    }
    if (!entry.player) {
      sendJson(response, 400, { error: "牌局进行中，暂时无法入座。" });
      return true;
    }
    const result = store.startRoom(entry.roomCode, entry.player.id, entry.player.secret);
    sendJson(response, result.error ? 400 : 200, result);
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/table/next") {
    const body = await readJson(request);
    const account = accountStore.authenticate(body.sessionToken);
    if (!account) {
      sendJson(response, 401, { error: "登录已失效，请重新登录。" });
      return true;
    }
    if (account.pendingRename) {
      sendJson(response, 400, { error: "你已被淘汰，请先更换用户名。" });
      return true;
    }
    const entry = store.enterMainTable(account);
    if (entry.error || !entry.player) {
      sendJson(response, 400, { error: entry.error || "你当前不在主桌席位中。" });
      return true;
    }
    const result = store.startNextGame(entry.roomCode, entry.player.id, entry.player.secret);
    sendJson(response, result.error ? 400 : 200, result);
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/admin/login") {
    const body = await readJson(request);
    const token = adminStore.login(String(body.password || ""));
    if (!token) {
      sendJson(response, 401, { error: "管理员密码不正确。" });
      return true;
    }
    sendJson(response, 200, { token });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/admin/roles") {
    if (!requireAdmin(request, response)) {
      return true;
    }
    sendJson(response, 200, {
      roles: adminStore.listRoles().map((role) => adminStore.adminView(role))
    });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/admin/roles/test") {
    if (!requireAdmin(request, response)) {
      return true;
    }
    const body = await readJson(request);
    const storedRole = body.roleId ? adminStore.getRole(String(body.roleId), true) : null;
    const provider = ["openai", "anthropic", "gemini"].includes(body.provider)
      ? body.provider
      : (storedRole ? storedRole.provider : "openai");
    const model = String(body.model || (storedRole ? storedRole.model : "")).trim().slice(0, 160);
    if (!model) {
      sendJson(response, 400, { error: "模型名称不能为空。" });
      return true;
    }
    let apiKey = storedRole ? (storedRole.apiKey || "") : "";
    if (body.clearApiKey === true) {
      apiKey = "";
    } else if (typeof body.apiKey === "string" && body.apiKey.trim()) {
      apiKey = body.apiKey.trim().slice(0, 4000);
    }
    const baseUrl = String(body.baseUrl || (storedRole ? storedRole.baseUrl : ai.DEFAULT_BASE_URLS[provider]))
      .trim()
      .slice(0, 500);
    try {
      const result = await ai.testConnection({ provider, baseUrl, model, apiKey }, { timeoutMs: 20000 });
      sendJson(response, 200, result);
    } catch (error) {
      sendJson(response, 502, { error: error.message || "模型接口测试失败。" });
    }
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/admin/music") {
    if (!requireAdmin(request, response)) {
      return true;
    }
    sendJson(response, 200, { music: adminStore.publicMusic() });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/admin/tts") {
    if (!requireAdmin(request, response)) {
      return true;
    }
    sendJson(response, 200, { tts: adminStore.adminTts() });
    return true;
  }

  if (request.method === "PUT" && url.pathname === "/api/admin/tts") {
    if (!requireAdmin(request, response)) {
      return true;
    }
    const body = await readJson(request);
    const tts = adminStore.updateTts(body);
    ttsService.clearCache();
    sendJson(response, 200, { tts });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/admin/tts/test") {
    if (!requireAdmin(request, response)) {
      return true;
    }
    const body = await readJson(request);
    try {
      let audio;
      if (body.provider === "doubao") {
        const settings = adminStore.getDoubao();
        audio = await doubaoTtsService.synthesize(settings, {
          text: body.text || "豆包经典语音，今晚由我来坐庄。",
          voice: body.voice || settings.voiceType,
          timeoutMs: 30000
        });
      } else {
        const settings = adminStore.getTts();
        audio = await ttsService.synthesize(settings, {
          text: body.text || "欢迎来到骗子酒馆，今晚没人值得相信。",
          voice: body.voice || settings.narratorVoice,
          timeoutMs: 30000
        });
      }
      sendAudio(response, 200, audio, "no-store");
    } catch (error) {
      sendJson(response, 502, { error: error.message });
    }
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/admin/doubao") {
    if (!requireAdmin(request, response)) {
      return true;
    }
    sendJson(response, 200, { doubao: adminStore.adminDoubao() });
    return true;
  }

  if (request.method === "PUT" && url.pathname === "/api/admin/doubao") {
    if (!requireAdmin(request, response)) {
      return true;
    }
    const body = await readJson(request);
    try {
      const doubao = adminStore.updateDoubao(body);
      doubaoTtsService.clearCache();
      sendJson(response, 200, { doubao });
    } catch (error) {
      sendJson(response, 400, { error: error.message });
    }
    return true;
  }

  if (request.method === "PUT" && url.pathname === "/api/admin/music") {
    if (!requireAdmin(request, response)) {
      return true;
    }
    const body = await readJson(request, 14 * 1024 * 1024);
    try {
      const music = adminStore.updateMusic(body);
      sendJson(response, 200, { music });
    } catch (error) {
      sendJson(response, 400, { error: error.message });
    }
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/admin/roles") {
    if (!requireAdmin(request, response)) {
      return true;
    }
    const body = await readJson(request);
    const role = adminStore.createRole(body);
    sendJson(response, 201, { role: adminStore.adminView(role) });
    return true;
  }

  const adminRoleId = adminRoleIdFromPath(url.pathname);
  if (adminRoleId && request.method === "PUT") {
    if (!requireAdmin(request, response)) {
      return true;
    }
    const body = await readJson(request);
    const role = adminStore.updateRole(adminRoleId, body);
    if (!role) {
      sendJson(response, 404, { error: "AI 角色不存在。" });
      return true;
    }
    sendJson(response, 200, { role: adminStore.adminView(role) });
    return true;
  }

  if (adminRoleId && request.method === "DELETE") {
    if (!requireAdmin(request, response)) {
      return true;
    }
    const removed = adminStore.deleteRole(adminRoleId);
    sendJson(response, removed ? 200 : 404, removed ? { ok: true } : { error: "AI 角色不存在。" });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/admin/password") {
    if (!requireAdmin(request, response)) {
      return true;
    }
    const body = await readJson(request);
    const result = adminStore.changePassword(String(body.currentPassword || ""), String(body.newPassword || ""));
    sendJson(response, result.error ? 400 : 200, result);
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/admin/leaderboard/reset") {
    if (!requireAdmin(request, response)) {
      return true;
    }
    const result = store.resetLeaderboard();
    sendJson(response, result.error ? 409 : 200, result);
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/admin/logout") {
    const token = bearerToken(request);
    if (token) {
      adminStore.logout(token);
    }
    sendJson(response, 200, { ok: true });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/rooms") {
    sendJson(response, 410, { error: "请登录地点账户后进入主桌。" });
    return true;
  }

  const joinCode = roomCodeFromPath(url.pathname, "join");
  if (request.method === "POST" && joinCode) {
    sendJson(response, 410, { error: "请登录地点账户后进入主桌。" });
    return true;
  }

  const startCode = roomCodeFromPath(url.pathname, "start");
  if (request.method === "POST" && startCode) {
    const body = await readJson(request);
    const result = store.startRoom(startCode, body.playerId, body.token);
    sendJson(response, result.error ? 400 : 200, result);
    return true;
  }

  const lineupCode = roomCodeFromPath(url.pathname, "ai-lineup");
  if (request.method === "POST" && lineupCode) {
    const body = await readJson(request);
    const result = store.setLineup(lineupCode, body.playerId, body.token, body.roleIds);
    sendJson(response, result.error ? 400 : 200, result);
    return true;
  }

  const actionCode = roomCodeFromPath(url.pathname, "action");
  if (request.method === "POST" && actionCode) {
    const body = await readJson(request);
    const result = store.performAction(actionCode, body.playerId, body.token, body.action || {});
    sendJson(response, result.error ? 400 : 200, result);
    return true;
  }

  const speechCode = roomCodeFromPath(url.pathname, "speech-done");
  if (request.method === "POST" && speechCode) {
    const body = await readJson(request);
    const result = store.acknowledgeSpeech(speechCode, body.playerId, body.token, body.speechId);
    sendJson(response, result.error ? 409 : 200, result);
    return true;
  }

  const animationCode = roomCodeFromPath(url.pathname, "animation-done");
  if (request.method === "POST" && animationCode) {
    const body = await readJson(request);
    const result = store.acknowledgeCinematic(animationCode, body.playerId, body.token, body.cinematicId);
    sendJson(response, result.error ? 409 : 200, result);
    return true;
  }

  const chatCode = roomCodeFromPath(url.pathname, "chat");
  if (request.method === "POST" && chatCode) {
    const body = await readJson(request);
    const result = store.sendChat(chatCode, body.playerId, body.token, body.text);
    sendJson(response, result.error ? 400 : 200, result);
    return true;
  }

  const restartCode = roomCodeFromPath(url.pathname, "restart");
  if (request.method === "POST" && restartCode) {
    const body = await readJson(request);
    const result = store.restartRoom(restartCode, body.playerId, body.token);
    sendJson(response, result.error ? 400 : 200, result);
    return true;
  }

  const leaveCode = roomCodeFromPath(url.pathname, "leave");
  if (request.method === "POST" && leaveCode) {
    const body = await readJson(request);
    const result = store.leaveRoom(leaveCode, body.playerId, body.token);
    sendJson(response, 200, result);
    return true;
  }

  const signalCode = roomCodeFromPath(url.pathname, "signal");
  if (request.method === "POST" && signalCode) {
    const body = await readJson(request);
    const result = store.signal(signalCode, body.playerId, body.token, body.targetPlayerId, body.signal);
    sendJson(response, result.error ? 400 : 200, result);
    return true;
  }

  const eventsCode = roomCodeFromPath(url.pathname, "events");
  if (request.method === "GET" && eventsCode) {
    const viewerId = url.searchParams.get("viewerId") || "";
    const playerId = url.searchParams.get("playerId") || "";
    const token = url.searchParams.get("token") || "";
    if (playerId && !store.authenticatePlayer(eventsCode, playerId, token)) {
      sendJson(response, 401, { error: "玩家身份已失效，请刷新页面重新加入。" });
      return true;
    }
    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no"
    });
    response.flushHeaders();
    const heartbeat = setInterval(() => {
      try {
        response.write(": ping\n\n");
      } catch (error) {
        // The close handler will clean up.
      }
    }, 20000);
    if (heartbeat.unref) {
      heartbeat.unref();
    }
    response.on("close", () => clearInterval(heartbeat));
    const ok = store.subscribe(eventsCode, viewerId, playerId, token, response);
    if (!ok) {
      response.write("event: error\n");
      response.write("data: " + JSON.stringify({ error: "房间不存在" }) + "\n\n");
      response.end();
    }
    return true;
  }

  return false;
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || "/", "http://" + (request.headers.host || "localhost"));
  try {
    if (url.pathname.startsWith("/api/")) {
      const handled = await handleApi(request, response, url);
      if (!handled) {
        sendJson(response, 404, { error: "接口不存在" });
      }
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      sendText(response, 405, "Method not allowed");
      return;
    }
    serveStatic(response, url.pathname);
  } catch (error) {
    console.error(error);
    if (!response.headersSent) {
      sendJson(response, 500, { error: "服务器开小差了：" + error.message });
    } else {
      response.end();
    }
  }
});

server.listen(PORT, HOST, () => {
  console.log("骗子酒馆 MVP running at http://" + HOST + ":" + server.address().port);
  console.log("Enabled AI roles:", adminStore.enabledRoles().length);
  if (adminStore.generatedPassword) {
    console.log("Generated initial admin password:", adminStore.generatedPassword);
  }
  if (accountStore.generatedKeys.shanghai) {
    console.log("Generated Shanghai login key:", accountStore.generatedKeys.shanghai);
  }
  if (accountStore.generatedKeys.hangzhou) {
    console.log("Generated Hangzhou login key:", accountStore.generatedKeys.hangzhou);
  }
});

function shutdown() {
  if (store) {
    store.closeAll();
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
