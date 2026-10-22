"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { startServer, post, sseState } = require("../scripts/qa-server.cjs");

test("HTTP observers cannot choose a private hand and retired room routes cannot bypass accounts", async t => {
  const server = await startServer();
  t.after(() => server.stop());
  const { base, keys } = server;
  assert.equal((await post(base, "/api/rooms", { name: "guest" })).status, 410);
  const login = await post(base, "/api/account/login", { location: "shanghai", key: keys.shanghai });
  const sessionToken = login.body.sessionToken;
  assert.equal((await post(base, "/api/account/username", { sessionToken, username: "测试玩家" })).status, 200);
  const entry = (await post(base, "/api/table/enter", { sessionToken })).body;
  assert.equal((await post(base, "/api/rooms/MAIN/join", { name: "guest" })).status, 410);
  assert.equal((await post(base, "/api/table/start", { sessionToken })).status, 200);
  const publicView = await sseState(base, { viewerId: "observer" });
  assert.equal(publicView.body.me, null);
  const forgedView = await sseState(base, { viewerId: entry.playerId });
  assert.equal(forgedView.body.me, null);
  assert.equal(forgedView.body.legal.play, false);
  const ownView = await sseState(base, { playerId: entry.playerId, token: entry.playerToken });
  assert.equal(ownView.body.me.hand.length, 5);
  assert.equal((await sseState(base, { playerId: entry.playerId, token: "invalid" })).status, 401);
  assert.equal((await fetch(base + "/assets/tavern.webp")).headers.get("content-type"), "image/webp");
  assert.equal((await fetch(base + "/assets/textures/walnut.jpg")).headers.get("content-type"), "image/jpeg");
});
