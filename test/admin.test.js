"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { AdminStore } = require("../server/admin");
const { RoomStore } = require("../server/rooms");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "liars-admin-"));
}

test("admin store seeds six roles and never exposes full keys", () => {
  const directory = tempDir();
  const previous = process.env.ADMIN_PASSWORD;
  process.env.ADMIN_PASSWORD = "temporary-admin-pass";
  try {
    const store = new AdminStore({ dataDir: directory });
    const roles = store.listRoles();
    assert.equal(roles.length, 6);
    assert.deepEqual(roles.map((role) => role.name), ["DeepSeek", "GPT", "Claude", "Kimi", "豆包", "千问"]);
    assert.equal(roles.every((role) => Boolean(role.systemPrompt)), true);
    assert.equal(roles.every((role) => role.portraitUrl.startsWith("/portraits/")), true);
    assert.equal(new Set(roles.map((role) => role.voice)).size, roles.length);
    assert.equal(store.publicTts().narratorVoice, "Sunny");
    const doubaoRole = roles.find((role) => role.name === "豆包");
    assert.equal(doubaoRole.ttsProvider, "doubao");
    assert.equal(doubaoRole.voice, "BV001_streaming");
    const token = store.login("temporary-admin-pass");
    assert.ok(token);
    assert.equal(store.authenticate(token), true);
    const role = store.adminView(store.updateRole(roles[0].id, {
      name: "DeepSeek 深海",
      provider: "openai",
      baseUrl: "https://api.deepseek.com/v1",
      model: "deepseek-chat",
      apiKey: "secret-key-1234",
      avatarEmoji: "🐋",
      portraitUrl: "/portraits/deepseek.svg",
      systemPrompt: "只相信概率，不轻易质疑。",
      enabled: true
    }));
    assert.equal(role.hasKey, true);
    assert.equal(role.systemPrompt, "只相信概率，不轻易质疑。");
    assert.equal(role.apiKeyMasked.endsWith("1234"), true);
    const publicView = store.publicView(store.getRole(roles[0].id));
    assert.equal(JSON.stringify(publicView).includes("secret-key"), false);
    assert.equal(JSON.stringify(publicView).includes("apiKey"), false);
    assert.equal(publicView.portraitUrl, "/portraits/deepseek.svg");
    assert.equal(JSON.stringify(publicView).includes("systemPrompt"), false);
  } finally {
    process.env.ADMIN_PASSWORD = previous;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("admin can disable a role and change the password", () => {
  const directory = tempDir();
  const previous = process.env.ADMIN_PASSWORD;
  process.env.ADMIN_PASSWORD = "old-admin-pass";
  try {
    const store = new AdminStore({ dataDir: directory });
    const role = store.listRoles()[0];
    store.updateRole(role.id, { enabled: false });
    assert.equal(store.enabledRoles().some((item) => item.id === role.id), false);
    const result = store.changePassword("old-admin-pass", "new-admin-pass");
    assert.equal(result.ok, true);
    assert.equal(store.login("old-admin-pass"), null);
    assert.ok(store.login("new-admin-pass"));
  } finally {
    process.env.ADMIN_PASSWORD = previous;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("admin can configure background music", () => {
  const directory = tempDir();
  const previous = process.env.ADMIN_PASSWORD;
  process.env.ADMIN_PASSWORD = "music-admin-pass";
  try {
    const store = new AdminStore({ dataDir: directory });
    const music = store.updateMusic({
      url: "https://example.com/theme.mp3",
      volume: 0.5,
      enabled: true
    });
    assert.equal(music.url, "https://example.com/theme.mp3");
    assert.equal(music.volume, 0.5);
    assert.equal(music.enabled, true);
    assert.throws(() => store.updateMusic({ url: "javascript:alert(1)" }));
    const cleared = store.updateMusic({ clear: true });
    assert.equal(cleared.url, "");
    assert.equal(cleared.enabled, false);
  } finally {
    process.env.ADMIN_PASSWORD = previous;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("admin configures qwen tts, hides its key, and propagates role voices", () => {
  const directory = tempDir();
  const previous = process.env.ADMIN_PASSWORD;
  process.env.ADMIN_PASSWORD = "tts-admin-pass";
  let roomStore = null;
  try {
    const store = new AdminStore({ dataDir: directory });
    const tts = store.updateTts({
      enabled: true,
      baseUrl: "https://dashscope.aliyuncs.com/api/v1",
      model: "qwen3-tts-flash",
      apiKey: "sk-qwen-secret-9876",
      narratorVoice: "Ethan",
      defaultVoice: "Cherry",
      speed: 1.1,
      format: "mp3"
    });
    assert.equal(tts.enabled, true);
    assert.equal(tts.hasKey, true);
    assert.equal(tts.apiKeyMasked.endsWith("9876"), true);
    assert.equal(JSON.stringify(store.publicTts()).includes("sk-qwen-secret"), false);
    assert.equal(JSON.stringify(store.publicTts()).includes("apiKey"), false);

    const role = store.listRoles()[0];
    store.updateRole(role.id, { voice: "Nofish" });
    assert.equal(store.adminView(store.getRole(role.id, true)).voice, "Nofish");
    assert.equal(store.publicView(store.getRole(role.id, true)).voice, "Nofish");

    roomStore = new RoomStore({ adminStore: store });
    const created = roomStore.createRoom({ name: "VoicePlayer" });
    const roles = roomStore.lineupRoles(created.room);
    assert.equal(roles[0].voice, "Nofish");
    const result = require("../server/game").startGame(created.room, { aiRoles: roles });
    assert.equal(Boolean(result.error), false);
    const state = require("../server/game").publicState(created.room, created.playerId);
    const ai = state.players.find((player) => player.isAI);
    assert.equal(ai.voice, "Nofish");
  } finally {
    if (roomStore) {
      roomStore.closeAll();
    }
    process.env.ADMIN_PASSWORD = previous;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("admin configures doubao classic tts and masks its access token", () => {
  const directory = tempDir();
  const previous = process.env.ADMIN_PASSWORD;
  process.env.ADMIN_PASSWORD = "doubao-admin-pass";
  try {
    const store = new AdminStore({ dataDir: directory });
    const doubao = store.updateDoubao({
      enabled: true,
      endpoint: "https://openspeech.bytedance.com/api/v1/tts",
      appId: "volc-app-id",
      accessToken: "volc-token-5678",
      cluster: "volcano_tts",
      voiceType: "BV001_streaming",
      speed: 1,
      format: "mp3"
    });
    assert.equal(doubao.enabled, true);
    assert.equal(doubao.hasToken, true);
    assert.equal(doubao.tokenMasked.endsWith("5678"), true);
    const publicConfig = store.publicDoubao();
    assert.equal(JSON.stringify(publicConfig).includes("volc-token"), false);
    assert.equal(JSON.stringify(publicConfig).includes("accessToken"), false);
    const role = store.listRoles().find((item) => item.name === "豆包");
    assert.equal(role.ttsProvider, "doubao");
    assert.equal(role.voice, "BV001_streaming");
  } finally {
    process.env.ADMIN_PASSWORD = previous;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("admin configures doubao api-key mode without exposing the key", () => {
  const directory = tempDir();
  const previous = process.env.ADMIN_PASSWORD;
  process.env.ADMIN_PASSWORD = "doubao-api-admin-pass";
  try {
    const store = new AdminStore({ dataDir: directory });
    const doubao = store.updateDoubao({
      enabled: true,
      authMode: "apikey",
      endpoint: "https://openspeech.bytedance.com/api/v3/tts/unidirectional",
      apiKey: "volc-api-key-4321",
      resourceId: "seed-tts-2.0",
      voiceType: "zh_female_vv_uranus_bigtts",
      speed: 1,
      format: "mp3"
    });
    assert.equal(doubao.authMode, "apikey");
    assert.equal(doubao.hasApiKey, true);
    assert.equal(doubao.apiKeyMasked.endsWith("4321"), true);
    assert.equal(doubao.resourceId, "seed-tts-2.0");
    assert.equal(store.publicDoubao().enabled, true);
    assert.equal(JSON.stringify(store.publicDoubao()).includes("volc-api-key"), false);
    assert.throws(() => store.updateDoubao({
      authMode: "apikey",
      apiKey: "试听失败：...related resource",
      resourceId: "seed-tts-2.0"
    }), /API Key.*中文或空格/);
  } finally {
    process.env.ADMIN_PASSWORD = previous;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("legacy qwen endpoints and duplicate voices migrate automatically", () => {
  const directory = tempDir();
  const previous = process.env.ADMIN_PASSWORD;
  process.env.ADMIN_PASSWORD = "legacy-tts-pass";
  try {
    const store = new AdminStore({ dataDir: directory });
    store.config.tts.baseUrl = "https://dashscope.aliyuncs.com/compatible-mode/v1";
    store.config.tts.model = "qwen-tts";
    store.config.tts.narratorVoice = "Ethan";
    store.config.voiceConfigVersion = 1;
    store.config.doubao = {
      enabled: true,
      endpoint: "https://openspeech.bytedance.com/api/v1/tts",
      appId: "seed-audio-1.0",
      accessToken: "legacy-api-key-9999",
      cluster: "volcano_tts",
      voiceType: "BV001_streaming",
      speed: 1,
      format: "mp3"
    };
    store.config.roles[4].voice = "Cherry";
    store.config.roles[5].voice = "Serena";
    store.saveConfig();

    const reloaded = new AdminStore({ dataDir: directory });
    assert.equal(reloaded.getTts().baseUrl, "https://dashscope.aliyuncs.com/api/v1");
    assert.equal(reloaded.getTts().model, "qwen3-tts-flash");
    assert.equal(reloaded.getTts().narratorVoice, "Sunny");
    assert.equal(reloaded.config.voiceConfigVersion, 4);
    const voices = reloaded.listRoles().map((role) => role.voice);
    assert.equal(new Set(voices).size, voices.length);
    const doubaoRole = reloaded.listRoles().find((role) => role.name === "豆包");
    assert.equal(doubaoRole.voice, "zh_female_vv_uranus_bigtts");
    assert.equal(doubaoRole.ttsProvider, "doubao");
    assert.equal(reloaded.getDoubao().authMode, "apikey");
    assert.equal(reloaded.getDoubao().apiKey, "legacy-api-key-9999");
    assert.equal(reloaded.getDoubao().resourceId, "seed-audio-1.0");
    assert.equal(reloaded.getDoubao().endpoint, "https://openspeech.bytedance.com/api/v3/tts/unidirectional");
    assert.equal(reloaded.listRoles().find((role) => role.name === "千问").voice, "Jada");
  } finally {
    process.env.ADMIN_PASSWORD = previous;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("room player tokens are required and never exposed", () => {
  const directory = tempDir();
  const previous = process.env.ADMIN_PASSWORD;
  process.env.ADMIN_PASSWORD = "room-token-pass";
  let store = null;
  try {
    const adminStore = new AdminStore({ dataDir: directory });
    store = new RoomStore({ adminStore });
    const created = store.createRoom({ name: "TokenPlayer" });
    assert.equal(Boolean(created.playerToken), true);
    assert.equal(Boolean(store.authenticatePlayer(created.room.code, created.playerId, created.playerToken)), true);
    assert.equal(store.authenticatePlayer(created.room.code, created.playerId, "wrong"), null);
    const state = require("../server/game").publicState(created.room, created.playerId);
    assert.equal(JSON.stringify(state).includes("secret"), false);
  } finally {
    if (store) {
      store.closeAll();
    }
    process.env.ADMIN_PASSWORD = previous;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
