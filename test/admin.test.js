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
