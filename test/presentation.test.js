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
  game.startGame(created.room);
  const frames = [];
  const response = { write: value => frames.push(value), on: () => {} };
  store.subscribe(created.room.code, created.playerId, "", "", response);
  const states = frames.filter(value => value.startsWith("data: ")).map(value => JSON.parse(value.slice(6)));
  assert.ok(states.length > 0);
  assert.ok(states.every(state => state.me === null && state.isSpectator));
});
