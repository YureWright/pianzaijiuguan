"use strict";

const crypto = require("node:crypto");
const game = require("./game");
const ai = require("./ai");

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_TTL_MS = 3 * 60 * 60 * 1000;
const AUTOPILOT_DELAY_MS = 9000;
const LOBBY_DISCONNECT_TTL_MS = 20000;
const HUMAN_TURN_MS = 30000;
const AI_THINK_MIN_MS = 1200;
const AI_THINK_MAX_MS = 2400;
const MAIN_TABLE_CODE = "MAIN";

function estimateSpeechDuration(text) {
  const characters = Array.from(String(text || "")).length;
  return Math.max(1800, Math.min(9000, 800 + characters * 180));
}

function randomCode() {
  let code = "";
  for (let i = 0; i < 5; i += 1) {
    code += CODE_ALPHABET[crypto.randomInt(0, CODE_ALPHABET.length)];
  }
  return code;
}

function sanitizeProfiles(input) {
  if (!Array.isArray(input)) {
    return [];
  }
  const allowed = new Set(["openai", "anthropic", "gemini"]);
  return input.slice(0, 6).map((item, index) => {
    const source = item || {};
    const provider = allowed.has(source.provider) ? source.provider : "openai";
    const model = String(source.model || "").trim().slice(0, 160);
    if (!model) {
      return null;
    }
    const baseUrl = String(source.baseUrl || ai.DEFAULT_BASE_URLS[provider]).trim().slice(0, 500);
    return {
      id: "model-" + crypto.randomUUID(),
      name: String(source.name || model || "模型 " + (index + 1)).trim().slice(0, 24),
      provider,
      baseUrl,
      model,
      apiKey: String(source.apiKey || "").trim().slice(0, 2000)
    };
  }).filter(Boolean);
}

class RoomStore {
  constructor(options) {
    const opts = options || {};
    this.adminStore = opts.adminStore || null;
    this.accountStore = opts.accountStore || null;
    this.rooms = new Map();
    this.clients = new Map();
    this.disconnectTimers = new Map();
    this.modelErrors = new Map();
    this.cleanupTimer = setInterval(() => this.cleanup(), 10 * 60 * 1000);
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  ensureMainRoom() {
    const existing = this.rooms.get(MAIN_TABLE_CODE);
    if (existing) {
      return existing;
    }
    const roles = this.enabledRoles();
    if (roles.length === 0) {
      throw new Error("管理员尚未启用可用的 AI 角色。");
    }
    const room = game.createRoom(MAIN_TABLE_CODE);
    room.aiLineup = roles.slice(0, 3).map((role) => role.id);
    this.refreshLineupCache(room);
    this.rooms.set(room.code, room);
    return room;
  }

  enterMainTable(account) {
    const room = this.ensureMainRoom();
    const displayName = account.location + " · " + account.username;
    let player = room.players.find((item) => item.occupied && item.accountId === account.id);
    if (player) {
      player.name = displayName;
      player.location = account.location;
      player.connected = true;
      player.autopilot = false;
    } else if (room.phase === "lobby") {
      const reservedSeat = account.id === "shanghai" ? 0 : account.id === "hangzhou" ? 1 : undefined;
      const result = game.addHuman(room, game.makeId(), displayName, {
        seat: reservedSeat,
        accountId: account.id,
        location: account.location
      });
      if (result.error) {
        return { error: result.error };
      }
      player = result.player;
    }
    this.afterChange(room);
    return {
      room,
      roomCode: room.code,
      player: player || null,
      playerId: player ? player.id : null,
      playerToken: player ? player.secret : null,
      viewerId: player ? player.id : "viewer-" + crypto.randomUUID(),
      spectator: !player
    };
  }

  accountRenameBlocked(accountId) {
    const room = this.rooms.get(MAIN_TABLE_CODE);
    if (!room || (room.phase !== "playing" && room.phase !== "out_challenge")) {
      return false;
    }
    return room.players.some((player) => player.occupied && player.accountId === accountId);
  }

  syncAccountProfile(account) {
    const room = this.rooms.get(MAIN_TABLE_CODE);
    if (!room) {
      return;
    }
    const player = room.players.find((item) => item.occupied && item.accountId === account.id);
    if (!player) {
      return;
    }
    player.name = account.location + " · " + account.username;
    player.location = account.location;
    this.afterChange(room);
  }

  resetLeaderboard() {
    if (!this.accountStore) {
      return { error: "账户数据尚未加载。" };
    }
    const room = this.rooms.get(MAIN_TABLE_CODE);
    if (room && (room.phase === "playing" || room.phase === "out_challenge")) {
      return { error: "牌局进行中，不能重置排行榜和用户。" };
    }
    this.clearSpeechGate(room || {});
    this.accountStore.resetAll();
    if (room) {
      game.prepareRematch(room, { keepPlayerIds: [] });
      room.phase = "lobby";
      room.hostId = null;
      game.addLog(room, "admin", "管理员已重置排行榜与全部用户数据。");
      this.afterChange(room);
    }
    return { ok: true };
  }

  startNextGame(code, playerId, token) {
    const room = this.getRoom(code);
    if (!room) {
      return { error: "主桌不存在。" };
    }
    if (!this.authenticatePlayer(code, playerId, token)) {
      return { error: "玩家身份已失效，请重新登录。" };
    }
    if (room.phase !== "gameover") {
      return { error: "当前牌局还没有结束。" };
    }
    const aiRoles = this.lineupRoles(room);
    if (aiRoles.length === 0) {
      return { error: "管理员尚未启用可用的 AI 角色。" };
    }
    this.clearSpeechGate(room);
    const keepPlayerIds = [];
    for (const player of room.players) {
      if (!player.occupied || player.isAI || !player.accountId) {
        continue;
      }
      const account = this.accountStore ? this.accountStore.byId(player.accountId) : null;
      if (!account || account.pendingRename || !account.username) {
        continue;
      }
      player.name = account.location + " · " + account.username;
      player.location = account.location;
      keepPlayerIds.push(player.id);
    }
    game.prepareRematch(room, { keepPlayerIds });
    const result = game.startGame(room, { aiRoles });
    if (result.error) {
      return result;
    }
    this.afterChange(room);
    return { ok: true };
  }

  createRoom(options) {
    const opts = options || {};
    const roles = this.enabledRoles();
    if (roles.length === 0) {
      throw new Error("管理员尚未启用可用的 AI 角色。");
    }
    let code = randomCode();
    while (this.rooms.has(code)) {
      code = randomCode();
    }
    const room = game.createRoom(code);
    room.demo = Boolean(opts.demo);
    room.aiLineup = roles.slice(0, room.demo ? 4 : 3).map((role) => role.id);
    this.refreshLineupCache(room);
    this.rooms.set(code, room);
    if (room.demo) {
      game.startGame(room, { aiRoles: this.lineupRoles(room) });
      const viewerId = "viewer-" + crypto.randomUUID();
      this.afterChange(room);
      return { room, player: null, viewerId, playerId: null };
    }
    const player = game.addHuman(room, game.makeId(), opts.name);
    if (player.error) {
      this.rooms.delete(code);
      throw new Error(player.error);
    }
    this.afterChange(room);
    return { room, player: player.player, viewerId: player.player.id, playerId: player.player.id, playerToken: player.player.secret };
  }

  joinRoom(code, name) {
    const room = this.getRoom(code);
    if (!room) {
      return { error: "房间不存在或已经打烊。" };
    }
    if (room.phase !== "lobby" || game.humanCount(room) >= 2) {
      return {
        room,
        player: null,
        playerId: null,
        viewerId: "viewer-" + crypto.randomUUID(),
        spectator: true
      };
    }
    const result = game.addHuman(room, game.makeId(), name);
    if (result.error) {
      return { error: result.error };
    }
    this.afterChange(room);
    return {
      room,
      player: result.player,
      playerId: result.player.id,
      viewerId: result.player.id,
      playerToken: result.player.secret,
      spectator: false
    };
  }

  getRoom(code) {
    return this.rooms.get(String(code || "").trim().toUpperCase()) || null;
  }

  authenticatePlayer(code, playerId, token) {
    const room = this.getRoom(code);
    const player = room ? game.findPlayer(room, playerId) : null;
    if (!player || player.isAI || !player.secret || player.secret !== String(token || "")) {
      return null;
    }
    return player;
  }

  enabledRoles() {
    return this.adminStore ? this.adminStore.enabledRoles() : [];
  }

  refreshLineupCache(room) {
    room.aiRoleCache = {};
    room.aiLineup = Array.from(new Set(room.aiLineup || []));
    for (const id of room.aiLineup) {
      const role = this.adminStore ? this.adminStore.getRole(id) : null;
      if (role) {
        room.aiRoleCache[id] = this.adminStore.publicView(role);
      }
    }
  }

  lineupRoles(room) {
    const roles = [];
    for (const id of room.aiLineup || []) {
      const role = this.adminStore ? this.adminStore.getRole(id) : null;
      if (role) {
        roles.push({
          id: role.id,
          name: role.name,
          avatarEmoji: role.avatarEmoji,
          avatarUrl: role.avatarUrl,
          portraitUrl: role.portraitUrl,
          voice: role.voice || ""
        });
      }
    }
    if (roles.length === 0) {
      return this.enabledRoles().slice(0, 3).map((role) => ({
        id: role.id,
        name: role.name,
        avatarEmoji: role.avatarEmoji,
        avatarUrl: role.avatarUrl,
        portraitUrl: role.portraitUrl,
        voice: role.voice || ""
      }));
    }
    return roles;
  }

  setLineup(code, playerId, token, roleIds) {
    const room = this.getRoom(code);
    if (!room) {
      return { error: "房间不存在。" };
    }
    const host = this.authenticatePlayer(code, playerId, token);
    if (!host || room.hostId !== playerId) {
      return { error: "只有房主可以调整 AI 阵容。" };
    }
    if (room.phase !== "lobby") {
      return { error: "牌局开始后不能调整 AI 阵容。" };
    }
    const requested = Array.isArray(roleIds) ? Array.from(new Set(roleIds.map(String))) : [];
    const roles = requested.map((id) => this.adminStore ? this.adminStore.getRole(id) : null).filter(Boolean);
    if (roles.length === 0) {
      return { error: "至少选择一位管理员已启用的 AI 角色。" };
    }
    room.aiLineup = roles.slice(0, 3).map((role) => role.id);
    this.refreshLineupCache(room);
    game.addLog(room, "lineup", "AI 阵容调整为：" + roles.slice(0, 3).map((role) => role.name).join(" / "));
    this.afterChange(room);
    return { ok: true, aiLineup: room.aiLineup };
  }

  startRoom(code, playerId, token) {
    const room = this.getRoom(code);
    if (!room) {
      return { error: "房间不存在。" };
    }
    if (!this.authenticatePlayer(code, playerId, token) || room.hostId !== playerId) {
      return { error: "只有房主可以开始游戏。" };
    }
    if (room.phase !== "lobby") {
      return { error: "游戏已经开始。" };
    }
    const aiRoles = this.lineupRoles(room);
    if (aiRoles.length === 0) {
      return { error: "管理员尚未启用可用的 AI 角色。" };
    }
    const result = game.startGame(room, { aiRoles });
    if (result.error) {
      return result;
    }
    this.afterChange(room);
    return { ok: true };
  }

  performAction(code, playerId, token, action) {
    const room = this.getRoom(code);
    if (!room) {
      return { error: "房间不存在。" };
    }
    if (!this.authenticatePlayer(code, playerId, token)) {
      return { error: "玩家身份已失效，请刷新页面重新加入。" };
    }
    const result = game.performAction(room, playerId, action, Math.random);
    if (!result.error) {
      if (result.reveal) {
        this.setCinematicGate(room);
      }
      this.afterChange(room);
    }
    return result;
  }

  sendChat(code, playerId, token, text) {
    const room = this.getRoom(code);
    if (!room) {
      return { error: "房间不存在。" };
    }
    const player = this.authenticatePlayer(code, playerId, token);
    if (!player) {
      return { error: "只有牌桌上的玩家可以发言。" };
    }
    const entry = game.addChat(room, player.id, player.name, text, "chat");
    if (!entry) {
      return { error: "消息不能为空。" };
    }
    this.afterChange(room);
    return { ok: true, chat: entry };
  }

  restartRoom(code, playerId, token) {
    const room = this.getRoom(code);
    if (!room) {
      return { error: "房间不存在。" };
    }
    const player = this.authenticatePlayer(code, playerId, token);
    if (!player || room.hostId !== playerId) {
      return { error: "只有房主可以重开。" };
    }
    if (room.phase !== "gameover") {
      return { error: "当前不能重开。" };
    }
    const aiRoles = this.lineupRoles(room);
    if (aiRoles.length === 0) {
      return { error: "管理员尚未启用可用的 AI 角色。" };
    }
    const result = game.restartGame(room, { aiRoles });
    if (result.error) {
      return result;
    }
    this.afterChange(room);
    return { ok: true };
  }

  voidGame(code, playerId, token) {
    const room = this.getRoom(code);
    if (!room) {
      return { error: "房间不存在。" };
    }
    const player = this.authenticatePlayer(code, playerId, token);
    if (!player || room.hostId !== playerId) {
      return { error: "只有房主可以提前结束牌局。" };
    }
    if (room.phase !== "playing" && room.phase !== "out_challenge") {
      return { error: "当前没有进行中的牌局。" };
    }
    if (room.aiTimer) {
      clearTimeout(room.aiTimer);
      room.aiTimer = null;
    }
    if (room.turnTimer) {
      clearTimeout(room.turnTimer);
      room.turnTimer = null;
    }
    if (room.demoRestartTimer) {
      clearTimeout(room.demoRestartTimer);
      room.demoRestartTimer = null;
    }
    this.clearSpeechGate(room);
    this.clearCinematicGate(room);
    const keepPlayerIds = room.players
      .filter((item) => item.occupied && !item.isAI)
      .map((item) => item.id);
    game.prepareRematch(room, { keepPlayerIds });
    game.addLog(room, "admin", player.name + " 提前结束本局，本局作废且不计入战绩。");
    this.afterChange(room);
    return { ok: true };
  }

  leaveRoom(code, playerId, token) {
    const room = this.getRoom(code);
    if (!room) {
      return { ok: true };
    }
    if (!this.authenticatePlayer(code, playerId, token)) {
      return { error: "玩家身份已失效。" };
    }
    const player = game.removeHuman(room, playerId);
    if (player) {
      this.afterChange(room);
    }
    return { ok: true };
  }

  signal(code, fromPlayerId, token, targetPlayerId, signal) {
    const room = this.getRoom(code);
    if (!room) {
      return { error: "房间不存在。" };
    }
    const from = this.authenticatePlayer(code, fromPlayerId, token);
    const target = game.findPlayer(room, targetPlayerId);
    if (!from || !target || from.isAI || target.isAI || from.id === target.id) {
      return { error: "无效的联机目标。" };
    }
    this.sendToPlayer(code, target.id, "signal", {
      from: from.id,
      fromName: from.name,
      signal
    });
    return { ok: true };
  }

  subscribe(code, viewerId, playerId, token, response) {
    const room = this.getRoom(code);
    if (!room) {
      return false;
    }
    const connectionId = crypto.randomUUID();
    if (!this.clients.has(code)) {
      this.clients.set(code, new Map());
    }
    const viewer = playerId ? this.authenticatePlayer(code, playerId, token) : null;
    if (playerId && !viewer) {
      return false;
    }
    if (viewer) {
      viewer.connected = true;
      viewer.autopilot = false;
      viewer.aiRoleId = null;
      viewer.modelLabel = null;
      this.clearDisconnectTimer(viewer.id);
      if (room.aiTimer && room.turnPlayerId === viewer.id) {
        clearTimeout(room.aiTimer);
        room.aiTimer = null;
        room.aiThinkingId = null;
        room.aiThought = null;
      }
      if (room.aiThought && room.aiThought.playerId === viewer.id && room.turnPlayerId === viewer.id) {
        room.aiThought = null;
      }
    }
    this.clients.get(code).set(connectionId, {
      response,
      // Only an authenticated player may select a private point of view.
      viewerId: viewer ? viewer.id : null,
      playerId: viewer ? viewer.id : null
    });
    response.write("retry: 1500\n\n");
    this.sendState(room, response, viewer ? viewer.id : null);
    this.broadcast(room);
    this.afterChange(room);
    response.on("close", () => {
      const group = this.clients.get(code);
      if (!group) {
        return;
      }
      group.delete(connectionId);
      if (group.size === 0) {
        this.clients.delete(code);
      }
      if (!viewer) {
        return;
      }
      const stillOnline = Array.from(group.values()).some((item) => item.playerId === viewer.id);
      if (stillOnline) {
        return;
      }
      viewer.connected = false;
      this.broadcast(room);
      if (room.pendingSpeech && Array.isArray(room.pendingSpeech.requiredAcks)) {
        room.pendingSpeech.requiredAcks = room.pendingSpeech.requiredAcks.filter((id) => id !== viewer.id);
        if (room.pendingSpeech.requiredAcks.length === 0) {
          this.releaseSpeech(room, room.pendingSpeech.id);
        }
      }
      if (room.pendingCinematic && Array.isArray(room.pendingCinematic.requiredAcks)) {
        room.pendingCinematic.requiredAcks = room.pendingCinematic.requiredAcks.filter((id) => id !== viewer.id);
        if (room.pendingCinematic.requiredAcks.length === 0) {
          this.releaseCinematic(room, room.pendingCinematic.id);
        }
      }
      if (room.phase === "lobby") {
        this.scheduleLobbyDisconnect(room, viewer);
      } else if (room.phase === "playing" || room.phase === "out_challenge") {
        this.scheduleAutopilot(room, viewer);
      }
    });
    return true;
  }

  sendToPlayer(code, playerId, eventName, payload) {
    const group = this.clients.get(code);
    if (!group) {
      return;
    }
    for (const client of group.values()) {
      if (client.playerId === playerId) {
        this.writeEvent(client.response, eventName, payload);
      }
    }
  }

  sendState(room, response, viewerId) {
    this.writeEvent(response, "state", game.publicState(room, viewerId));
  }

  writeEvent(response, eventName, payload) {
    try {
      response.write("event: " + eventName + "\n");
      response.write("data: " + JSON.stringify(payload) + "\n\n");
    } catch (error) {
      // The connection is cleaned up by its close handler.
    }
  }

  broadcast(room) {
    const group = this.clients.get(room.code);
    if (!group) {
      return;
    }
    for (const client of group.values()) {
      this.sendState(room, client.response, client.viewerId);
    }
  }

  broadcastEvent(room, eventName, payload) {
    const group = this.clients.get(room.code);
    if (!group) {
      return;
    }
    for (const client of group.values()) {
      this.writeEvent(client.response, eventName, payload);
    }
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  setAiThought(room, player, status) {
    room.aiThought = {
      playerId: player.id,
      name: player.name,
      avatarEmoji: player.emoji,
      avatarUrl: player.avatarUrl || "",
      portraitUrl: player.portraitUrl || "",
      text: "",
      status: status || "observing",
      done: false,
      decisionLabel: "",
      startedAt: Date.now()
    };
  }

  clearAiThought(room) {
    room.aiThought = null;
    room.aiThinkingId = null;
  }

  clearSpeechGate(room) {
    if (room.speechTimer) {
      clearTimeout(room.speechTimer);
      room.speechTimer = null;
    }
    room.pendingSpeech = null;
    room.turnGateUntil = null;
    room.turnGateReason = null;
    room.deferredAction = null;
  }

  clearCinematicGate(room) {
    if (room.cinematicTimer) {
      clearTimeout(room.cinematicTimer);
      room.cinematicTimer = null;
    }
    if (room.turnGateReason === "cinematic") {
      room.turnGateUntil = null;
      room.turnGateReason = null;
    }
    room.pendingCinematic = null;
  }

  setCinematicGate(room) {
    if (room.phase !== "playing" && room.phase !== "out_challenge") {
      return;
    }
    this.clearCinematicGate(room);
    const cinematicId = crypto.randomUUID();
    room.pendingCinematic = {
      id: cinematicId,
      startedAt: Date.now(),
      fallbackAt: Date.now() + 15000,
      requiredAcks: room.players.filter((player) => player.occupied && !player.isAI && player.connected).map((player) => player.id)
    };
    room.turnGateUntil = room.pendingCinematic.fallbackAt;
    room.turnGateReason = "cinematic";
    room.cinematicTimer = setTimeout(() => {
      room.cinematicTimer = null;
      this.releaseCinematic(room, cinematicId);
    }, 15000);
    if (room.cinematicTimer.unref) {
      room.cinematicTimer.unref();
    }
  }

  releaseCinematic(room, cinematicId) {
    if (!room.pendingCinematic) {
      return false;
    }
    if (cinematicId && room.pendingCinematic.id !== cinematicId) {
      return false;
    }
    this.clearCinematicGate(room);
    this.afterChange(room);
    return true;
  }

  acknowledgeCinematic(code, playerId, token, cinematicId) {
    const room = this.getRoom(code);
    if (!room) {
      return { error: "主桌不存在。" };
    }
    if (!this.authenticatePlayer(code, playerId, token)) {
      return { error: "玩家身份已失效。" };
    }
    if (!room.pendingCinematic) {
      return { ok: true, alreadyReleased: true };
    }
    if (room.pendingCinematic.id !== String(cinematicId || "")) {
      return { error: "处决动画状态已经变化。" };
    }
    room.pendingCinematic.requiredAcks = room.pendingCinematic.requiredAcks.filter((id) => id !== playerId);
    if (room.pendingCinematic.requiredAcks.length === 0) {
      this.releaseCinematic(room, room.pendingCinematic.id);
    }
    return { ok: true };
  }

  setSpeechGate(room, player, text, decisionLabel) {
    this.clearSpeechGate(room);
    const clean = String(text || "").trim();
    if (!clean) {
      return false;
    }
    const requiredAcks = room.players
      .filter((item) => item.occupied && !item.isAI && item.connected)
      .map((item) => item.id);
    if (requiredAcks.length === 0) {
      return false;
    }
    const fallbackMs = Math.max(90000, estimateSpeechDuration(clean) + 45000);
    const speechId = crypto.randomUUID();
    room.pendingSpeech = {
      id: speechId,
      playerId: player.id,
      playerName: player.name,
      text: clean,
      decisionLabel: String(decisionLabel || "").slice(0, 80),
      createdAt: Date.now(),
      fallbackAt: Date.now() + fallbackMs,
      requiredAcks
    };
    room.turnGateUntil = room.pendingSpeech.fallbackAt;
    room.turnGateReason = "speech";
    room.speechTimer = setTimeout(() => {
      room.speechTimer = null;
      this.releaseSpeech(room, speechId);
    }, fallbackMs);
    if (room.speechTimer.unref) {
      room.speechTimer.unref();
    }
    return true;
  }

  releaseSpeech(room, speechId) {
    if (!room.pendingSpeech) {
      return false;
    }
    if (speechId && room.pendingSpeech.id !== speechId) {
      return false;
    }
    const deferred = room.deferredAction;
    this.clearSpeechGate(room);
    if (room.aiTimer) {
      clearTimeout(room.aiTimer);
      room.aiTimer = null;
    }
    room.aiThinkingId = null;
    room.aiThought = null;
    if (deferred) {
      const result = game.performAction(room, deferred.playerId, deferred.action, Math.random);
      if (result.error) {
        game.addLog(room, "error", "AI 放话后的行动失败：" + result.error);
        this.broadcast(room);
      } else {
        if (result.reveal) {
          this.setCinematicGate(room);
        }
        this.afterChange(room);
      }
      return true;
    }
    this.afterChange(room);
    return true;
  }

  acknowledgeSpeech(code, playerId, token, speechId) {
    const room = this.getRoom(code);
    if (!room) {
      return { error: "主桌不存在。" };
    }
    if (!this.authenticatePlayer(code, playerId, token)) {
      return { error: "玩家身份已失效。" };
    }
    if (!room.pendingSpeech) {
      return { ok: true, alreadyReleased: true };
    }
    if (room.pendingSpeech.id !== String(speechId || "")) {
      return { error: "放话状态已经变化。" };
    }
    if (Array.isArray(room.pendingSpeech.requiredAcks) && room.pendingSpeech.requiredAcks.length > 0) {
      room.pendingSpeech.requiredAcks = room.pendingSpeech.requiredAcks.filter((id) => id !== playerId);
      if (room.pendingSpeech.requiredAcks.length > 0) {
        return { ok: true, waitingFor: room.pendingSpeech.requiredAcks.length };
      }
    }
    this.releaseSpeech(room, room.pendingSpeech.id);
    return { ok: true };
  }

  isAiStillActing(room, playerId) {
    if (room.phase !== "playing" && room.phase !== "out_challenge") {
      return false;
    }
    if (room.turnPlayerId !== playerId) {
      return false;
    }
    const player = game.findPlayer(room, playerId);
    return Boolean(player && player.alive && (player.isAI || player.autopilot));
  }

  decisionLabel(room, decision) {
    if (decision.action === "play") {
      const count = Array.isArray(decision.cardIds) ? decision.cardIds.length : 0;
      return "打出 " + count + " 张 · 宣称 " + room.tableRank;
    }
    if (decision.action === "challenge") {
      return "质疑 " + (room.lastPlay ? room.lastPlay.playerName : "上一位玩家");
    }
    return "做出决定";
  }

  async streamAiThought(room, player, text, decision) {
    const clean = String(text || "").replace(/\s+/g, " ").trim().slice(0, 160) || "……";
    room.aiThought = {
      playerId: player.id,
      name: player.name,
      avatarEmoji: player.emoji,
      avatarUrl: player.avatarUrl || "",
      portraitUrl: player.portraitUrl || "",
      text: "",
      status: "streaming",
      done: false,
      decisionLabel: "",
      startedAt: Date.now()
    };
    this.broadcast(room);
    await this.sleep(500);
    const characters = Array.from(clean);
    for (let index = 0; index < characters.length; index += 2) {
      if (!this.isAiStillActing(room, player.id)) {
        return false;
      }
      room.aiThought.text += characters.slice(index, index + 2).join("");
      this.broadcastEvent(room, "ai-thought", room.aiThought);
      await this.sleep(48 + Math.floor(Math.random() * 28));
    }
    await this.sleep(280);
    if (!this.isAiStillActing(room, player.id)) {
      return false;
    }
    room.aiThought.status = "decided";
    room.aiThought.done = true;
    room.aiThought.decisionLabel = this.decisionLabel(room, decision);
    this.broadcastEvent(room, "ai-thought", room.aiThought);
    this.broadcast(room);
    await this.sleep(1500);
    return this.isAiStillActing(room, player.id);
  }

  afterChange(room) {
    room.updatedAt = Date.now();
    if (room.phase !== "playing" && room.phase !== "out_challenge" && room.pendingSpeech) {
      this.clearSpeechGate(room);
    }
    if (room.phase !== "playing" && room.phase !== "out_challenge") {
      this.clearCinematicGate(room);
    }
    if (room.phase === "gameover" && !room.gameOverRecorded && this.accountStore) {
      this.accountStore.recordGame(room);
    }
    this.scheduleTurnTimeout(room);
    this.broadcast(room);
    if (room.phase === "playing" || room.phase === "out_challenge") {
      this.scheduleAI(room);
    }
    if (room.phase === "gameover" && room.demo) {
      this.scheduleDemoRestart(room);
    }
  }

  scheduleTurnTimeout(room) {
    if (room.turnTimer) {
      clearTimeout(room.turnTimer);
      room.turnTimer = null;
    }
    if (room.phase !== "playing" && room.phase !== "out_challenge") {
      room.turnDeadline = null;
      room.turnClockKey = null;
      return;
    }
    const player = game.findPlayer(room, room.turnPlayerId);
    if (!player) {
      room.turnDeadline = null;
      return;
    }
    const key = room.round + ":" + room.phase + ":" + player.id + ":" + Math.floor((room.turnGateUntil || 0) / 1000);
    if (room.turnClockKey === key && (room.turnTimer || player.isAI || player.autopilot)) {
      return;
    }
    room.turnClockKey = key;
    if (player.isAI || player.autopilot) {
      room.turnDeadline = null;
      return;
    }
    const startAt = Math.max(Date.now(), room.turnGateUntil || 0);
    room.turnDeadline = startAt + HUMAN_TURN_MS;
    const delay = Math.max(0, room.turnDeadline - Date.now());
    room.turnTimer = setTimeout(() => {
      room.turnTimer = null;
      this.autoAct(room, player.id, key);
    }, delay + 50);
    if (room.turnTimer.unref) {
      room.turnTimer.unref();
    }
  }

  autoAct(room, playerId, key) {
    if (room.turnClockKey !== key) {
      return;
    }
    if (room.phase !== "playing" && room.phase !== "out_challenge") {
      return;
    }
    const player = game.findPlayer(room, playerId);
    if (!player || room.turnPlayerId !== playerId || player.isAI || player.autopilot) {
      return;
    }
    let action;
    if (room.phase === "out_challenge") {
      action = { type: "challenge", speech: "" };
    } else {
      const card = player.hand.find((item) => item.wild || item.rank === room.tableRank) || player.hand[0];
      if (!card) {
        return;
      }
      action = { type: "play", cardIds: [card.id], speech: "" };
    }
    game.addLog(room, "timeout", player.name + " 出牌超时，系统已自动行动。");
    const result = game.performAction(room, playerId, action, Math.random);
    if (result.error) {
      game.addLog(room, "error", "自动行动失败：" + result.error);
      this.broadcast(room);
      return;
    }
    this.afterChange(room);
  }

  scheduleAI(room) {
    if (room.aiTimer || room.pendingSpeech || room.turnGateReason === "cinematic") {
      return;
    }
    if (room.phase !== "playing" && room.phase !== "out_challenge") {
      return;
    }
    const player = game.findPlayer(room, room.turnPlayerId);
    if (!player || (!player.isAI && !player.autopilot)) {
      return;
    }
    room.aiThinkingId = player.id;
    this.setAiThought(room, player, "observing");
    this.broadcast(room);
    const expectedRound = room.round;
    const expectedPhase = room.phase;
    const expectedPlayerId = player.id;
    const delay = AI_THINK_MIN_MS + Math.floor(Math.random() * (AI_THINK_MAX_MS - AI_THINK_MIN_MS));
    room.aiTimer = setTimeout(async () => {
      room.aiTimer = null;
      if (room.round !== expectedRound || room.phase !== expectedPhase || room.turnPlayerId !== expectedPlayerId) {
        if (room.aiThinkingId === expectedPlayerId) {
          this.clearAiThought(room);
          this.broadcast(room);
        }
        return;
      }
      const current = game.findPlayer(room, expectedPlayerId);
      if (!current || !current.alive) {
        this.clearAiThought(room);
        this.broadcast(room);
        return;
      }
      let decision = null;
      const role = current.aiRoleId && this.adminStore ? this.adminStore.getRole(current.aiRoleId) : null;
      const configuredForRemote = role && (role.apiKey || /^(https?:\/\/)?(127\.0\.0\.1|localhost)/i.test(role.baseUrl));
      const context = game.aiContext(room, current);
      context.systemPrompt = role ? (role.systemPrompt || "") : "";
      if (role && configuredForRemote) {
        try {
          decision = await ai.decideWithModel(role, context, { timeoutMs: 18000 });
        } catch (error) {
          const key = current.id + ":" + role.id;
          if (!this.modelErrors.has(key)) {
            this.modelErrors.set(key, true);
            console.warn("[ai] " + role.name + " model fallback:", error.message);
            game.addLog(room, "model", role.name + " 暂时没有回应，" + current.name + " 改用本地策略。");
          }
        }
      }
      if (!decision) {
        decision = ai.localDecision(context, Math.random);
      }
      if (!decision.monologue) {
        decision.monologue = ai.buildLocalMonologue(context, decision);
      }
      if (room.round !== expectedRound || room.phase !== expectedPhase || room.turnPlayerId !== expectedPlayerId) {
        this.clearAiThought(room);
        this.broadcast(room);
        return;
      }
      if (!current.isAI && !current.autopilot) {
        this.clearAiThought(room);
        this.broadcast(room);
        return;
      }
      const thoughtFinished = await this.streamAiThought(room, current, decision.speech, decision);
      if (!thoughtFinished) {
        this.clearAiThought(room);
        this.broadcast(room);
        return;
      }
      if (decision.speech) {
        game.addChat(room, current.id, current.name, decision.speech, "speech");
      }
      const memory = game.ensureAIMemory(room, current);
      memory.lastThought = decision.reasoning || "";
      memory.lastMonologue = decision.monologue || "";
      memory.lastMonologueRound = room.round;
      room.turnGateUntil = null;
      this.clearAiThought(room);
      if (decision.action === "challenge" && decision.speech && (room.phase === "playing" || room.phase === "out_challenge")) {
        const activeHuman = room.players.some((player) => player.occupied && !player.isAI && player.connected);
        if (activeHuman && this.setSpeechGate(room, current, decision.speech, this.decisionLabel(room, decision))) {
          room.deferredAction = {
            playerId: current.id,
            action: { type: "challenge", speech: "" }
          };
          this.afterChange(room);
          return;
        }
      }
      const toAction = (choice) => ({
        type: choice.action,
        cardIds: Array.isArray(choice.cardIds) ? choice.cardIds : [],
        speech: choice.speech || ""
      });
      let result = game.performAction(room, current.id, toAction(decision), Math.random);
      if (result.error) {
        const fallback = ai.localDecision(game.aiContext(room, current), Math.random);
        decision = fallback;
        result = game.performAction(room, current.id, toAction(fallback), Math.random);
      }
      if (!result.error) {
        const spoken = decision.speech || "";
        const activeHuman = room.players.some((player) => player.occupied && !player.isAI && player.connected);
        if (result.reveal) {
          this.setCinematicGate(room);
        } else if (spoken && activeHuman && (room.phase === "playing" || room.phase === "out_challenge")) {
          this.setSpeechGate(room, current, spoken, this.decisionLabel(room, decision));
        } else {
          this.clearSpeechGate(room);
        }
        this.afterChange(room);
      } else {
        game.addLog(room, "error", "AI 行动失败：" + result.error);
        this.broadcast(room);
      }
    }, delay);
  }

  scheduleDemoRestart(room) {
    if (room.demoRestartTimer) {
      return;
    }
    room.demoRestartTimer = setTimeout(() => {
      room.demoRestartTimer = null;
      if (room.phase !== "gameover" || !room.demo) {
        return;
      }
      game.restartGame(room, { aiRoles: this.lineupRoles(room) });
      this.afterChange(room);
    }, 12000);
  }

  scheduleAutopilot(room, player) {
    if (this.disconnectTimers.has(player.id)) {
      return;
    }
    const timer = setTimeout(() => {
      this.disconnectTimers.delete(player.id);
      if (player.connected || room.phase === "lobby" || room.phase === "gameover") {
        return;
      }
      player.autopilot = true;
      const role = this.lineupRoles(room)[0] || this.enabledRoles()[0] || null;
      player.aiRoleId = role ? role.id : null;
      player.avatarUrl = role ? (role.avatarUrl || null) : player.avatarUrl;
      player.portraitUrl = role ? (role.portraitUrl || null) : player.portraitUrl;
      player.modelLabel = role ? role.name : "本地策略";
      if (room.hostId === player.id) {
        const nextHost = room.players.find((item) => item.connected && !item.isAI && item.id !== player.id);
        if (nextHost) {
          room.hostId = nextHost.id;
          game.addLog(room, "host", nextHost.name + " 接管了房主。");
        }
      }
      game.addLog(room, "leave", player.name + " 掉线，已由 AI 托管。");
      this.afterChange(room);
    }, AUTOPILOT_DELAY_MS);
    if (timer.unref) {
      timer.unref();
    }
    this.disconnectTimers.set(player.id, timer);
  }

  scheduleLobbyDisconnect(room, player) {
    const key = room.code + ":" + player.id;
    if (this.disconnectTimers.has(key)) {
      return;
    }
    const timer = setTimeout(() => {
      this.disconnectTimers.delete(key);
      if (player.connected || room.phase !== "lobby") {
        return;
      }
      game.removeHuman(room, player.id);
      this.broadcast(room);
    }, LOBBY_DISCONNECT_TTL_MS);
    if (timer.unref) {
      timer.unref();
    }
    this.disconnectTimers.set(key, timer);
  }

  clearDisconnectTimer(playerId) {
    const timer = this.disconnectTimers.get(playerId);
    if (timer) {
      clearTimeout(timer);
      this.disconnectTimers.delete(playerId);
    }
  }

  cleanup() {
    const now = Date.now();
    for (const entry of this.rooms.entries()) {
      const code = entry[0];
      const room = entry[1];
      if (now - room.updatedAt < ROOM_TTL_MS) {
        continue;
      }
      if (room.aiTimer) {
        clearTimeout(room.aiTimer);
      }
      if (room.speechTimer) {
        clearTimeout(room.speechTimer);
      }
      if (room.cinematicTimer) {
        clearTimeout(room.cinematicTimer);
      }
      if (room.demoRestartTimer) {
        clearTimeout(room.demoRestartTimer);
      }
      this.rooms.delete(code);
      this.clients.delete(code);
    }
  }

  closeAll() {
    for (const group of this.clients.values()) {
      for (const client of group.values()) {
        try {
          client.response.end();
        } catch (error) {
          // The stream may already be closed.
        }
      }
    }
    this.clients.clear();
    for (const timer of this.disconnectTimers.values()) {
      clearTimeout(timer);
    }
    this.disconnectTimers.clear();
    for (const room of this.rooms.values()) {
      if (room.aiTimer) {
        clearTimeout(room.aiTimer);
      }
      if (room.speechTimer) {
        clearTimeout(room.speechTimer);
      }
      if (room.cinematicTimer) {
        clearTimeout(room.cinematicTimer);
      }
      if (room.demoRestartTimer) {
        clearTimeout(room.demoRestartTimer);
      }
    }
    clearInterval(this.cleanupTimer);
  }
}

module.exports = { RoomStore, sanitizeProfiles };
