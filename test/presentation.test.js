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
