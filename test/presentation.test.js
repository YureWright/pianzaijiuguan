"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { RoomStore } = require("../server/rooms");
const game = require("../server/game");
const { AdminStore } = require("../server/admin");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
function makeStore() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "liars-presentation-"));
  return new RoomStore({ adminStore: new AdminStore({ dataDir }) });
}

test("cinematic completion waits for both connected human players", t => {
  const store = makeStore();
  t.after(() => store.closeAll());
  const created = store.createRoom({ name: "first" });
  const joined = store.joinRoom(created.room.code, "second");
  const room = created.room;
  room.phase = "playing";
  store.setCinematicGate(room);
  const id = room.pendingCinematic.id;
  store.acknowledgeCinematic(room.code, created.playerId, created.playerToken, id);
  assert.equal(room.pendingCinematic.id, id);
  assert.deepEqual(room.pendingCinematic.requiredAcks, [joined.playerId]);
  store.acknowledgeCinematic(room.code, joined.playerId, joined.playerToken, id);
  assert.equal(room.pendingCinematic, null);
  assert.equal(room.turnGateReason, null);
});

test("an unauthenticated SSE viewer never receives a player perspective", t => {
  const store = makeStore();
  t.after(() => store.closeAll());
  const created = store.createRoom({ name: "private player" });
  game.startGame(created.room, { starterSeat: 0 });
  const ai = created.room.players.find(player => player.isAI);
  const memory = game.ensureAIMemory(created.room, ai);
  memory.lastMonologue = "PRIVATE_THOUGHT_SENTINEL";
  memory.lastMonologueRound = created.room.round;
  game.captureRoundThoughts(created.room);
  const frames = [];
  const response = { write: value => frames.push(value), on: () => {} };
  store.subscribe(created.room.code, created.playerId, "", "", response);
  const states = frames.filter(value => value.startsWith("data: ")).map(value => JSON.parse(value.slice(6)));
  assert.ok(states.length > 0);
  assert.ok(states.every(state => state.me === null && state.isSpectator));
  assert.ok(states.every(state => !JSON.stringify(state).includes("PRIVATE_THOUGHT_SENTINEL")));

  created.room.phase = "gameover";
  store.broadcast(created.room);
  const finalFrame = frames.filter(value => value.startsWith("data: ")).at(-1);
  assert.ok(finalFrame.includes("PRIVATE_THOUGHT_SENTINEL"));
});

test("host can void an active game without recording a result", t => {
  const store = makeStore();
  t.after(() => store.closeAll());
  const created = store.createRoom({ name: "host" });
  const joined = store.joinRoom(created.room.code, "guest");
  const started = game.startGame(created.room, { aiRoles: store.lineupRoles(created.room) });
  assert.equal(Boolean(started.error), false);
  assert.equal(created.room.phase, "playing");

  const denied = store.voidGame(created.room.code, joined.playerId, joined.playerToken);
  assert.match(denied.error, /房主/);
  assert.equal(created.room.phase, "playing");

  const result = store.voidGame(created.room.code, created.playerId, created.playerToken);
  assert.equal(result.ok, true);
  assert.equal(created.room.phase, "lobby");
  assert.equal(created.room.gameOverRecorded, false);
  assert.equal(created.room.winnerId, null);
  assert.equal(created.room.lastReveal, null);
  assert.equal(created.room.pendingSpeech, null);
  assert.equal(created.room.pendingCinematic, null);
  assert.equal(created.room.log.some(entry => entry.text.includes("本局作废")), true);
});

test("chat and reconnect preserve a human deadline while a new turn gets a fresh clock", t => {
  const store = makeStore();
  t.after(() => store.closeAll());
  const first = store.createRoom({ name: "first" });
  const second = store.joinRoom(first.room.code, "second");
  const room = first.room;
  game.startGame(room, { starterSeat: 0, rng: () => 0.42 });
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  store.afterChange(room);
  const deadline = room.turnDeadline;
  const timer = room.turnTimer;
  now += 5000;
  store.sendChat(room.code, second.playerId, second.playerToken, "Still thinking");
  assert.equal(room.turnDeadline, deadline);
  assert.equal(room.turnTimer, timer);
  store.subscribe(room.code, first.playerId, first.playerId, first.playerToken, { write() {}, on() {} });
  assert.equal(room.turnDeadline, deadline);
  assert.equal(room.turnTimer, timer);
  const player = game.findPlayer(room, first.playerId);
  assert.equal(store.performAction(room.code, first.playerId, first.playerToken,
    { type: "play", cardIds: [player.hand[0].id] }).ok, true);
  assert.equal(room.turnPlayerId, second.playerId);
  assert.equal(room.turnDeadline, now + 30000);
  store.closeAll();
  assert.equal(room.turnTimer, null);
});

test("an automatic forced challenge waits for the same cinematic acknowledgements as a click", t => {
  const store = makeStore();
  t.after(() => store.closeAll());
  const first = store.createRoom({ name: "first" });
  const second = store.joinRoom(first.room.code, "second");
  const room = first.room;
  game.startGame(room, { starterSeat: 0, rng: () => 0.42 });
  const player = game.findPlayer(room, first.playerId);
  const challenger = game.findPlayer(room, second.playerId);
  for (const ai of room.players.filter(seat => seat.isAI)) { ai.alive = false; ai.hand = []; }
  challenger.hand = [];
  challenger.gun = { chamber: 0, bullet: 2 };
  player.hand = [{ id: "truth", rank: "J" }, { id: "keep", rank: "Q" }];
  room.tableRank = "J";
  game.performAction(room, player.id, { type: "play", cardIds: ["truth"] });
  assert.equal(room.phase, "out_challenge");
  store.afterChange(room);
  store.autoAct(room, challenger.id, room.turnClockKey);
  assert.equal(room.lastReveal.truthful, true);
  assert.equal(room.turnGateReason, "cinematic");
  assert.ok(room.pendingCinematic);
});

function pendingAiTurn(t) {
  const ai = require("../server/ai");
  const store = makeStore();
  t.after(() => store.closeAll());
  const first = store.createRoom({ name: "host" });
  const room = first.room;
  game.startGame(room, { starterSeat: 2, aiRoles: store.lineupRoles(room) });
  const player = game.findPlayer(room, room.turnPlayerId);
  assert.ok(player.isAI);
  const calls = [];
  t.mock.method(store.adminStore, "getRole", () => ({ id: "test", name: "test", apiKey: "test" }));
  t.mock.method(ai, "decideWithModel", (_role, _context, options) => new Promise(resolve => {
    calls.push({ resolve, signal: options.signal });
  }));
  t.mock.method(store, "sleep", async () => {});
  t.mock.method(global, "setTimeout", (fn, delay) => ({ fn, delay, unref() {} }));
  t.mock.method(global, "clearTimeout", () => {});
  store.scheduleAI(room);
  const run = room.aiTimer.fn();
  return { store, first, room, player, calls, run };
}

test("chat and subscriptions cannot duplicate an in-flight AI model or thought stream", async t => {
  const { store, first, room, player, calls, run } = pendingAiTurn(t);
  store.sendChat(room.code, first.playerId, first.playerToken, "still waiting");
  store.subscribe(room.code, "", "", "", { write() {}, on() {} });
  assert.equal(room.aiTimer, null, "the active model owns the turn without scheduling another timer");
  assert.equal(calls.length, 1);
  let finishStream;
  t.mock.method(store, "streamAiThought", () => new Promise(resolve => { finishStream = resolve; }));
  calls[0].resolve({ action: "play", cardIds: [player.hand[0].id], speech: "" });
  await Promise.resolve();
  store.afterChange(room);
  assert.equal(room.aiTimer, null, "the same lock covers presentation after the model responds");
  finishStream(true);
  await run;
  assert.equal(room.log.filter(entry => entry.type === "play").length, 1);
  assert.notEqual(room.turnPlayerId, player.id);
});

test("voiding cancels a model request and its late result cannot clear the new turn", async t => {
  const { store, first, room, calls, run } = pendingAiTurn(t);
  assert.equal(store.voidGame(room.code, first.playerId, first.playerToken).ok, true);
  assert.equal(calls[0].signal.aborted, true);
  game.startGame(room, { starterSeat: 2, aiRoles: store.lineupRoles(room) });
  store.afterChange(room);
  const newThought = room.aiThought;
  const newTimer = room.aiTimer;
  calls[0].resolve({ action: "challenge", speech: "stale" });
  await run;
  assert.equal(room.aiThought, newThought);
  assert.equal(room.aiTimer, newTimer);
  assert.equal(room.log.some(entry => entry.type === "play" || entry.type === "challenge"), false);
});

test("reconnecting a human cancels their autopilot request before it can act", async t => {
  const { store, first, room, player, calls, run } = pendingAiTurn(t);
  player.isAI = false;
  player.autopilot = true;
  player.secret = first.playerToken;
  // Use the actual seat token, as subscribe authenticates the seat rather than its display name.
  store.subscribe(room.code, player.id, player.id, player.secret, { write() {}, on() {} });
  assert.equal(player.autopilot, false);
  assert.equal(calls[0].signal.aborted, true);
  calls[0].resolve({ action: "play", cardIds: [player.hand[0].id], speech: "" });
  await run;
  assert.equal(room.turnPlayerId, player.id);
  assert.equal(room.log.some(entry => entry.type === "play"), false);
});

test("an interrupted thought presentation falls back once and releases the AI turn", async t => {
  const { store, room, player, calls, run } = pendingAiTurn(t);
  t.mock.method(console, "warn", () => {});
  t.mock.method(store, "streamAiThought", async () => { throw new Error("presentation interrupted"); });
  calls[0].resolve({ action: "play", cardIds: [player.hand[0].id], speech: "" });
  await run;
  assert.equal(room.log.filter(entry => entry.type === "play").length, 1);
  assert.notEqual(room.turnPlayerId, player.id);
  assert.notEqual(room.aiTask && room.aiTask.playerId, player.id);
});

test("cancelling during streamed speech cannot mutate a replacement thought", async t => {
  const { store, first, room, player, calls, run } = pendingAiTurn(t);
  let resume;
  t.mock.method(store, "sleep", () => new Promise(resolve => { resume = resolve; }));
  calls[0].resolve({ action: "play", cardIds: [player.hand[0].id], speech: "a streamed sentence" });
  await Promise.resolve();
  assert.equal(room.aiThought.status, "streaming");
  store.voidGame(room.code, first.playerId, first.playerToken);
  game.startGame(room, { starterSeat: 2, aiRoles: store.lineupRoles(room) });
  store.afterChange(room);
  const newThought = room.aiThought;
  resume();
  await run;
  assert.equal(room.aiThought, newThought);
  assert.equal(room.aiThought.text, "");
  assert.equal(room.log.some(entry => entry.type === "play"), false);
});
