"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const game = require("../server/game");
const ai = require("../server/ai");
const rooms = require("../server/rooms");

function makeRoom() {
  const room = game.createRoom("TEST1", []);
  const first = game.addHuman(room, "human-1", "阿青").player;
  const second = game.addHuman(room, "human-2", "小满").player;
  game.startGame(room, { starterSeat: first.seat, rng: () => 0.42 });
  assert.equal(second.occupied, true);
  return room;
}

function setCard(player, id, rank) {
  const suit = id.slice(-1);
  player.hand = [{
    id,
    rank,
    suit,
    red: suit === "H" || suit === "D"
  }];
}

test("a room fills to four seats and hides other hands", () => {
  const room = makeRoom();
  assert.equal(room.players.filter((player) => player.occupied).length, 4);
  assert.equal(room.players.filter((player) => player.isAI).length, 2);
  assert.equal(room.players.filter((player) => player.occupied && player.hand.length === game.HAND_SIZE).length, 4);
  const state = game.publicState(room, "human-1");
  assert.equal(state.me.hand.length, game.HAND_SIZE);
  assert.equal(Boolean(room.players[0].secret), true);
  assert.equal(JSON.stringify(state).includes("secret"), false);
  const other = state.players.find((player) => player.seat === 1);
  assert.equal(Object.hasOwn(other, "hand"), false);
  assert.equal(JSON.stringify(state).includes("apiKey"), false);
  const spectator = game.publicState(room, "viewer-x");
  assert.equal(spectator.me, null);
  assert.equal(spectator.isSpectator, true);
});

test("the deck is exactly 20 cards with JQK six copies and two jokers", () => {
  const deck = game.createDeck();
  assert.equal(deck.length, 20);
  for (const rank of ["J", "Q", "K"]) {
    assert.equal(deck.filter((card) => card.rank === rank).length, 6);
  }
  assert.equal(deck.filter((card) => card.wild).length, 2);
  const room = makeRoom();
  const dealt = room.players.reduce((total, player) => total + player.hand.length, 0);
  assert.equal(dealt, 20);
  assert.ok(["J", "Q", "K"].includes(room.tableRank));
});

test("the revolver uses three chambers with one third execution pressure", () => {
  assert.equal(game.CHAMBER_COUNT, 3);
});

test("a joker counts as a wildcard during a challenge", () => {
  const room = makeRoom();
  const player = room.players[0];
  const challenger = room.players[1];
  room.phase = "playing";
  room.tableRank = "J";
  player.alive = true;
  challenger.alive = true;
  player.hand = [
    { id: "JOKER-0", rank: "JOKER", label: "大王", suit: "🃏", red: true, wild: true },
    { id: "K-0", rank: "K", suit: "♠", red: false, wild: false }
  ];
  room.turnPlayerId = player.id;
  game.performAction(room, player.id, { type: "play", cardIds: ["JOKER-0"] }, () => 0.5);
  const result = game.performAction(room, challenger.id, { type: "challenge" }, () => 0.5);
  assert.equal(result.reveal.truthful, true);
  assert.equal(result.reveal.loserId, challenger.id);
});

test("AI memory records revealed claims and opponent tendencies", () => {
  const room = makeRoom();
  const ai = room.players.find((player) => player.isAI);
  const player = room.players[0];
  const challenger = room.players[1];
  room.phase = "playing";
  room.tableRank = "Q";
  player.alive = true;
  challenger.alive = true;
  player.hand = [
    { id: "K-1", rank: "K", suit: "♥", red: true, wild: false },
    { id: "J-1", rank: "J", suit: "♥", red: true, wild: false }
  ];
  room.turnPlayerId = player.id;
  game.performAction(room, player.id, { type: "play", cardIds: ["K-1"] }, () => 0.5);
  game.performAction(room, challenger.id, { type: "challenge" }, () => 0.5);
  const context = game.aiContext(room, ai);
  assert.ok(context.memory.episodes.length > 0);
  const belief = context.memory.beliefs.find((item) => item.name === player.name);
  assert.equal(belief.claims, 1);
  assert.equal(belief.lies, 1);
});

test("private AI thoughts are captured for the post-round panel", () => {
  const room = makeRoom();
  const ai = room.players.find((player) => player.isAI);
  const memory = game.ensureAIMemory(room, ai);
  memory.lastMonologue = "这轮我故意扣了一张假牌，看看谁会先坐不住。";
  memory.lastMonologueRound = room.round;
  const thoughts = game.captureRoundThoughts(room);
  assert.equal(thoughts.length > 0, true);
  assert.equal(thoughts[0].text.includes("故意扣了一张假牌"), true);
  const state = game.publicState(room, "human-1");
  assert.equal(state.roundThoughts.length > 0, true);
});

test("a truthful play punishes the challenger", () => {
  const room = makeRoom();
  const player = room.players[0];
  const challenger = room.players[1];
  room.phase = "playing";
  room.tableRank = "A";
  player.alive = true;
  challenger.alive = true;
  player.hand = [
    { id: "A-S", rank: "A", suit: "♠", red: false },
    { id: "K-S", rank: "K", suit: "♠", red: false }
  ];
  room.turnPlayerId = player.id;
  let result = game.performAction(room, player.id, { type: "play", cardIds: ["A-S"] }, () => 0.5);
  assert.equal(result.error, undefined);
  assert.equal(room.lastPlay.count, 1);
  assert.equal(room.turnPlayerId, challenger.id);
  result = game.performAction(room, challenger.id, { type: "challenge" }, () => 0.5);
  assert.equal(result.error, undefined);
  assert.equal(result.reveal.truthful, true);
  assert.equal(result.reveal.loserId, challenger.id);
});

test("turn gate blocks early actions and public speech is attached to the play", () => {
  const room = makeRoom();
  const player = room.players[0];
  room.phase = "playing";
  room.turnPlayerId = player.id;
  room.turnGateUntil = Date.now() + 3000;
  const blocked = game.performAction(room, player.id, { type: "play", cardIds: [player.hand[0].id] }, () => 0.5);
  assert.match(blocked.error, /放话/);
  room.turnGateUntil = Date.now() - 1;
  const played = game.performAction(room, player.id, {
    type: "play",
    cardIds: [player.hand[0].id],
    speech: "诸位，这一手值得你们相信。"
  }, () => 0.5);
  assert.equal(played.error, undefined);
  const playLog = room.log.filter((entry) => entry.type === "play").pop();
  assert.match(playLog.speech, /值得你们相信/);
  const state = game.publicState(room, "human-1");
  assert.equal(typeof state.turnGateUntil, "number");

  room.turnPlayerId = player.id;
  room.pendingSpeech = { id: "speech-test", playerId: "some-ai", playerName: "AI", text: "看着我。" };
  const pendingBlocked = game.performAction(room, player.id, { type: "challenge" }, () => 0.5);
  assert.match(pendingBlocked.error, /放话/);
  room.pendingSpeech = null;
});

test("a lie punishes the claimant and reveals only the last play", () => {
  const room = makeRoom();
  const player = room.players[0];
  const challenger = room.players[1];
  room.phase = "playing";
  room.tableRank = "A";
  player.alive = true;
  challenger.alive = true;
  player.hand = [
    { id: "K-H", rank: "K", suit: "♥", red: true },
    { id: "Q-H", rank: "Q", suit: "♥", red: true }
  ];
  room.turnPlayerId = player.id;
  game.performAction(room, player.id, { type: "play", cardIds: ["K-H"] }, () => 0.5);
  const result = game.performAction(room, challenger.id, { type: "challenge" }, () => 0.5);
  assert.equal(result.reveal.truthful, false);
  assert.equal(result.reveal.loserId, player.id);
  assert.equal(result.reveal.cards.length, 1);
});

test("when every hand is empty only challenge remains and the final challenge ends the game", () => {
  const room = makeRoom();
  const player = room.players[0];
  const next = room.players[1];
  room.phase = "playing";
  room.tableRank = "J";
  for (const seat of room.players) {
    seat.alive = true;
    seat.hand = [];
    seat.gun = { chamber: 0, bullet: 1 };
  }
  player.hand = [{ id: "J-C", rank: "J", suit: "♣", red: false }];
  room.turnPlayerId = player.id;
  game.performAction(room, player.id, { type: "play", cardIds: ["J-C"] }, () => 0.5);
  assert.equal(room.phase, "out_challenge");
  assert.equal(room.turnPlayerId, next.id);
  const state = game.publicState(room, next.id);
  assert.equal(state.legal.challenge, true);
  assert.equal(state.legal.play, false);
  assert.equal(state.legal.pass, false);
  assert.equal(state.cardsInHands, 0);
  const illegalPlay = game.performAction(room, next.id, { type: "play", cardIds: [] }, () => 0.5);
  assert.match(illegalPlay.error, /出牌阶段/);
  const illegalPass = game.performAction(room, next.id, { type: "pass" }, () => 0.5);
  assert.match(illegalPass.error, /只能质疑/);
  const result = game.performAction(room, next.id, { type: "challenge" }, () => 0.5);
  assert.equal(result.error, undefined);
  assert.equal(result.reveal.truthful, true);
  assert.equal(room.phase, "gameover");
  assert.equal(room.winnerId, player.id);
});

test("a shot does not redeal the table and the surviving hands continue", () => {
  const room = makeRoom();
  const player = room.players[0];
  const challenger = room.players[1];
  const round = room.round;
  room.phase = "playing";
  room.tableRank = "A";
  player.hand = [
    { id: "A-S", rank: "A", suit: "♠", red: false },
    { id: "K-S", rank: "K", suit: "♠", red: false }
  ];
  challenger.hand = [
    { id: "Q-H", rank: "Q", suit: "♥", red: true },
    { id: "J-H", rank: "J", suit: "♥", red: true }
  ];
  challenger.gun = { chamber: 0, bullet: 0 };
  room.turnPlayerId = player.id;
  game.performAction(room, player.id, { type: "play", cardIds: ["A-S"] }, () => 0.5);
  const result = game.performAction(room, challenger.id, { type: "challenge" }, () => 0.5);
  assert.equal(result.reveal.truthful, true);
  assert.equal(result.reveal.shot, true);
  assert.equal(challenger.alive, false);
  assert.equal(room.phase, "playing");
  assert.equal(room.round, round);
  assert.equal(room.lastPlay, null);
  assert.equal(player.hand.length, 1);
  assert.equal(player.hand[0].id, "K-S");
});

test("empty hands are skipped and the last cardholder must challenge", () => {
  const room = makeRoom();
  const first = room.players[0];
  const skipped = room.players[1];
  const second = room.players[2];
  const alsoSkipped = room.players[3];
  room.phase = "playing";
  room.lastPlay = null;
  room.tableRank = "K";
  for (const player of room.players) {
    player.alive = true;
  }
  first.hand = [
    { id: "K-S", rank: "K", suit: "♠", red: false },
    { id: "Q-S", rank: "Q", suit: "♠", red: false }
  ];
  skipped.hand = [];
  second.hand = [{ id: "J-H", rank: "J", suit: "♥", red: true }];
  alsoSkipped.hand = [];
  room.turnPlayerId = first.id;

  game.performAction(room, first.id, { type: "play", cardIds: ["K-S"] }, () => 0.5);
  assert.equal(room.turnPlayerId, second.id);
  assert.equal(room.phase, "playing");

  game.performAction(room, second.id, { type: "play", cardIds: ["J-H"] }, () => 0.5);
  assert.equal(room.turnPlayerId, first.id);
  assert.equal(room.phase, "out_challenge");
  const state = game.publicState(room, first.id);
  assert.equal(state.legal.play, false);
  assert.equal(state.legal.challenge, true);
  assert.equal(state.legal.pass, false);
  const blocked = game.performAction(room, first.id, { type: "play", cardIds: ["Q-S"] }, () => 0.5);
  assert.match(blocked.error, /出牌阶段|最后一名持牌者/);
});

test("with two players left an empty hand can challenge and is not eliminated", () => {
  const room = makeRoom();
  const holder = room.players[0];
  const empty = room.players[1];
  room.players[2].alive = false;
  room.players[3].alive = false;
  room.phase = "playing";
  room.lastPlay = null;
  room.tableRank = "K";
  holder.alive = true;
  empty.alive = true;
  holder.hand = [
    { id: "K-S", rank: "K", suit: "♠", red: false },
    { id: "Q-S", rank: "Q", suit: "♠", red: false }
  ];
  empty.hand = [];
  empty.gun = { chamber: 0, bullet: 1 };
  room.turnPlayerId = holder.id;

  game.performAction(room, holder.id, { type: "play", cardIds: ["K-S"] }, () => 0.5);
  assert.equal(room.turnPlayerId, empty.id);
  assert.equal(room.phase, "out_challenge");
  const state = game.publicState(room, empty.id);
  assert.equal(state.legal.challenge, true);
  assert.equal(state.legal.play, false);
  const result = game.performAction(room, empty.id, { type: "challenge" }, () => 0.5);
  assert.equal(result.error, undefined);
  assert.equal(empty.alive, true);
  assert.equal(room.phase, "playing");
  assert.equal(room.turnPlayerId, holder.id);
  assert.equal(holder.hand.length, 1);
});

test("successful lies and both kinds of challenge kills are tracked", () => {
  const room = makeRoom();
  const liar = room.players[0];
  const truthful = room.players[1];
  room.phase = "playing";
  room.tableRank = "K";
  liar.hand = [
    { id: "Q-S", rank: "Q", suit: "♠", red: false },
    { id: "J-S", rank: "J", suit: "♠", red: false }
  ];
  truthful.hand = [{ id: "K-H", rank: "K", suit: "♥", red: true }];
  room.turnPlayerId = liar.id;
  game.performAction(room, liar.id, { type: "play", cardIds: ["Q-S"] }, () => 0.5);
  game.performAction(room, truthful.id, { type: "play", cardIds: ["K-H"] }, () => 0.5);
  assert.equal(liar.matchStats.deceptions, 1);

  room.phase = "playing";
  room.turnPlayerId = liar.id;
  liar.gun = { chamber: 0, bullet: 0 };
  truthful.hand = [{ id: "K-D", rank: "K", suit: "♦", red: true }];
  game.performAction(room, liar.id, { type: "play", cardIds: ["J-S"] }, () => 0.5);
  game.performAction(room, truthful.id, { type: "challenge" }, () => 0.5);
  assert.equal(truthful.matchStats.challengeKills, 1);

  const accused = room.players[2];
  const challenger = room.players[3];
  room.phase = "playing";
  room.tableRank = "K";
  accused.alive = true;
  challenger.alive = true;
  accused.hand = [{ id: "K-C", rank: "K", suit: "♣", red: false }];
  challenger.hand = [{ id: "Q-C", rank: "Q", suit: "♣", red: false }];
  challenger.gun = { chamber: 0, bullet: 0 };
  room.turnPlayerId = accused.id;
  game.performAction(room, accused.id, { type: "play", cardIds: ["K-C"] }, () => 0.5);
  game.performAction(room, challenger.id, { type: "challenge" }, () => 0.5);
  assert.equal(accused.matchStats.failedChallengeKills, 1);
});

test("a lie caught on the final challenge is not counted as a successful deception", () => {
  const room = makeRoom();
  const liar = room.players[0];
  const challenger = room.players[1];
  for (const player of room.players) {
    player.alive = true;
    player.hand = [];
  }
  room.phase = "playing";
  room.tableRank = "K";
  liar.hand = [{ id: "Q-D", rank: "Q", suit: "♦", red: true }];
  liar.gun = { chamber: 0, bullet: 0 };
  room.turnPlayerId = liar.id;
  game.performAction(room, liar.id, { type: "play", cardIds: ["Q-D"] }, () => 0.5);
  game.performAction(room, challenger.id, { type: "challenge" }, () => 0.5);
  assert.equal(room.phase, "gameover");
  assert.equal(liar.matchStats.deceptions, 0);
  assert.equal(challenger.matchStats.challengeKills, 1);
});

test("AI hands are revealed only after every seated human is eliminated", () => {
  const room = makeRoom();
  const humans = room.players.filter((player) => player.occupied && !player.isAI);
  const ai = room.players.find((player) => player.isAI);
  const before = game.publicState(room, "viewer");
  assert.equal(before.aiHandsRevealed, false);
  assert.equal(before.players.find((player) => player.seat === ai.seat).revealedHand, null);

  for (const human of humans) {
    human.alive = false;
  }
  for (const player of room.players.filter((item) => item.isAI)) {
    player.alive = true;
  }
  const after = game.publicState(room, "viewer");
  const revealed = after.players.find((player) => player.seat === ai.seat);
  assert.equal(after.aiHandsRevealed, true);
  assert.equal(Array.isArray(revealed.revealedHand), true);
  assert.equal(revealed.revealedHand.length, ai.hand.length);
  const humanState = after.players.find((player) => player.seat === humans[0].seat);
  assert.equal(Object.hasOwn(humanState, "hand"), false);
  assert.equal(humanState.revealedHand, null);
});

test("local AI returns a legal play", () => {
  const context = {
    name: "测试 AI",
    style: "冷静",
    seat: 1,
    hand: [
      { id: "A-S", rank: "A", suit: "♠" },
      { id: "3-H", rank: "3", suit: "♥" }
    ],
    tableRank: "A",
    phase: "playing",
    round: 1,
    aliveCount: 4,
    lastPlay: null,
    alivePlayers: [],
    recentLog: [],
    recentChat: []
  };
  const decision = ai.localDecision(context, () => 0.9);
  assert.equal(decision.action, "play");
  assert.ok(decision.cardIds.length >= 1 && decision.cardIds.length <= 3);
  const normalized = ai.normalizeDecision(decision, context);
  assert.equal(normalized.action, "play");
});

test("model profiles are sanitized and keys are not exposed", () => {
  const profiles = rooms.sanitizeProfiles([
    { name: "DeepSeek", provider: "openai", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat", apiKey: "secret" },
    { name: "", provider: "unknown", model: "" }
  ]);
  assert.equal(profiles.length, 1);
  assert.equal(profiles[0].provider, "openai");
  const room = game.createRoom("TEST2", profiles);
  const state = game.publicState(room, "someone");
  assert.equal(JSON.stringify(state).includes("secret"), false);
});
