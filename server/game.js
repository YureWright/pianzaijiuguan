"use strict";

const crypto = require("node:crypto");

const SEAT_COUNT = 4;
const HAND_SIZE = 5;
const MAX_PLAY = 3;
const CHAMBER_COUNT = 3;

const RANKS = ["J", "Q", "K"];
const RANK_COPIES = 6;
const JOKER_COUNT = 2;
const SUITS = [
  { key: "S", symbol: "♠", red: false },
  { key: "H", symbol: "♥", red: true },
  { key: "D", symbol: "♦", red: true },
  { key: "C", symbol: "♣", red: false }
];

const AI_PERSONAS = [
  { name: "酒保·维克", emoji: "🥃", style: "沉稳、话少，喜欢用短句施压" },
  { name: "红裙女士", emoji: "🌹", style: "优雅、危险，擅长反讽和试探" },
  { name: "老千·卢克", emoji: "🎩", style: "圆滑、爱吹嘘， bluff 时反而很自信" },
  { name: "占卜师·米拉", emoji: "🔮", style: "神秘、隐喻式发言，偶尔故意说错" }
];

function makeId() {
  return crypto.randomUUID();
}

function randomInt(max, rng) {
  const source = typeof rng === "function" ? rng : Math.random;
  return Math.floor(source() * max);
}

function shuffle(items, rng) {
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1, rng);
    const temp = result[i];
    result[i] = result[j];
    result[j] = temp;
  }
  return result;
}

function createDeck() {
  const deck = [];
  for (const rank of RANKS) {
    for (let copy = 0; copy < RANK_COPIES; copy += 1) {
      const suit = SUITS[copy % SUITS.length];
      deck.push({
        id: rank + "-" + copy,
        rank,
        suit: suit.symbol,
        red: suit.red,
        wild: false
      });
    }
  }
  for (let index = 0; index < JOKER_COUNT; index += 1) {
    deck.push({
      id: "JOKER-" + index,
      rank: "JOKER",
      label: index === 0 ? "大王" : "小王",
      suit: "🃏",
      red: index === 0,
      wild: true
    });
  }
  return deck;
}

function createSeat(seat) {
  return {
    seat,
    id: null,
    name: "空位",
    emoji: "🪑",
    isAI: false,
    occupied: false,
    connected: false,
    alive: false,
    autopilot: false,
    hand: [],
    gun: null,
    secret: null,
    accountId: null,
    location: null,
    matchStats: null,
    aiRoleId: null,
    avatarUrl: null,
    portraitUrl: null,
    modelLabel: null
  };
}

function createRoom(code) {
  return {
    code,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    phase: "lobby",
    hostId: null,
    round: 0,
    players: Array.from({ length: SEAT_COUNT }, (_, seat) => createSeat(seat)),
    aiLineup: [],
    aiRoleCache: {},
    aiMemories: {},
    tableCard: null,
    tableRank: null,
    turnPlayerId: null,
    turnDeadline: null,
    turnGateUntil: null,
    turnGateReason: null,
    pendingSpeech: null,
    pendingCinematic: null,
    deferredAction: null,
    pile: [],
    lastPlay: null,
    outPlayerId: null,
    lastReveal: null,
    roundResult: null,
    nextRoundAt: null,
    nextStarterSeat: null,
    winnerId: null,
    winnerName: null,
    aiThinkingId: null,
    aiThought: null,
    roundThoughts: [],
    gameOverRecorded: false,
    demo: false,
    log: [],
    chat: [],
    version: 0
  };
}

function sanitizeName(value, fallback) {
  const text = String(value || "").replace(/\s+/g, " ").trim().slice(0, 16);
  return text || fallback;
}

function humanCount(room) {
  return room.players.filter((player) => player.occupied && !player.isAI).length;
}

function findPlayer(room, playerId) {
  return room.players.find((player) => player.occupied && player.id === playerId) || null;
}

function alivePlayers(room) {
  return room.players.filter((player) => player.occupied && player.alive);
}

function addLog(room, type, text, extra) {
  const entry = Object.assign({
    id: makeId(),
    at: Date.now(),
    type,
    text
  }, extra || {});
  room.log.push(entry);
  if (room.log.length > 100) {
    room.log.splice(0, room.log.length - 100);
  }
  room.updatedAt = Date.now();
  room.version += 1;
  return entry;
}

function addChat(room, playerId, name, text, kind) {
  const clean = String(text || "").replace(/\s+/g, " ").trim().slice(0, 120);
  if (!clean) {
    return null;
  }
  const entry = {
    id: makeId(),
    at: Date.now(),
    playerId: playerId || null,
    name: sanitizeName(name, "酒馆"),
    text: clean,
    kind: kind || "chat"
  };
  room.chat.push(entry);
  if (room.chat.length > 80) {
    room.chat.splice(0, room.chat.length - 80);
  }
  room.updatedAt = Date.now();
  room.version += 1;
  return entry;
}

function addHuman(room, id, name, options) {
  const opts = options || {};
  if (room.phase !== "lobby") {
    return { error: "对局已经开始，只能作为观战者加入。" };
  }
  if (humanCount(room) >= 2) {
    return { error: "真人席位已满，最多两位真人玩家。" };
  }
  const preferred = Number.isInteger(opts.seat) ? room.players[opts.seat] : null;
  const seat = preferred && !preferred.occupied
    ? preferred
    : room.players.find((player) => !player.occupied);
  if (!seat) {
    return { error: "房间已满。" };
  }
  seat.id = id;
  seat.secret = makeId();
  seat.name = sanitizeName(name, "匿名玩家");
  seat.accountId = opts.accountId || null;
  seat.location = opts.location || null;
  seat.matchStats = { deceptions: 0, challengeKills: 0, failedChallengeKills: 0 };
  seat.emoji = "🕵️";
  seat.isAI = false;
  seat.occupied = true;
  seat.connected = true;
  seat.alive = false;
  seat.autopilot = false;
  seat.hand = [];
  seat.gun = null;
  seat.modelProfileId = null;
  seat.modelLabel = null;
  if (!room.hostId) {
    room.hostId = id;
  }
  addLog(room, "join", seat.name + " 走进了酒馆。");
  return { player: seat };
}

function removeHuman(room, playerId) {
  const player = findPlayer(room, playerId);
  if (!player || player.isAI) {
    return null;
  }
  if (room.phase !== "lobby") {
    player.connected = false;
    player.autopilot = true;
    addLog(room, "leave", player.name + " 暂时离席，由 AI 托管。");
    return player;
  }
  const name = player.name;
  player.id = null;
  player.secret = null;
  player.name = "空位";
  player.emoji = "🪑";
  player.occupied = false;
  player.connected = false;
  player.alive = false;
  player.autopilot = false;
  player.hand = [];
  player.gun = null;
  player.accountId = null;
  player.location = null;
  player.matchStats = null;
  if (room.hostId === playerId) {
    const nextHost = room.players.find((item) => item.occupied && !item.isAI);
    room.hostId = nextHost ? nextHost.id : null;
  }
  addLog(room, "leave", name + " 离开了酒馆。");
  return player;
}

function memoryKeyFor(player) {
  if (player.aiRoleId) {
    return "role:" + player.aiRoleId;
  }
  if (player.isAI) {
    return "local-seat:" + player.seat;
  }
  return "autopilot:" + player.id;
}

function ensureAIMemory(room, player) {
  const key = memoryKeyFor(player);
  if (!room.aiMemories[key]) {
    room.aiMemories[key] = {
      episodes: [],
      beliefs: {},
      lastThought: "",
      createdAt: Date.now()
    };
  }
  return room.aiMemories[key];
}

function rememberEvent(room, player, text, data) {
  const memory = ensureAIMemory(room, player);
  memory.episodes.push(Object.assign({
    at: Date.now(),
    round: room.round,
    text
  }, data || {}));
  if (memory.episodes.length > 18) {
    memory.episodes.splice(0, memory.episodes.length - 18);
  }
}

function updateBelief(memory, name, patch) {
  if (!name) {
    return;
  }
  const current = memory.beliefs[name] || {
    claims: 0,
    truths: 0,
    lies: 0,
    challenges: 0,
    correctChallenges: 0,
    wrongChallenges: 0
  };
  for (const key of Object.keys(patch)) {
    current[key] = (current[key] || 0) + patch[key];
  }
  memory.beliefs[name] = current;
}

function rememberReveal(room, accused, challenger, truthful, shot, dead) {
  for (const player of room.players) {
    if (!player.occupied || (!player.isAI && !player.autopilot)) {
      continue;
    }
    const memory = ensureAIMemory(room, player);
    updateBelief(memory, accused.name, {
      claims: 1,
      truths: truthful ? 1 : 0,
      lies: truthful ? 0 : 1
    });
    updateBelief(memory, challenger.name, {
      challenges: 1,
      correctChallenges: truthful ? 0 : 1,
      wrongChallenges: truthful ? 1 : 0
    });
    rememberEvent(
      room,
      player,
      challenger.name + " 质疑 " + accused.name + "，" +
        (truthful ? "亮牌属实" : "抓到谎言") + "；" +
        (dead ? "有人中弹出局。" : (shot ? "有人中弹。" : "空枪继续。")),
      { type: "reveal", truthful, accused: accused.name, challenger: challenger.name }
    );
  }
}

function buildMemorySummary(room, player) {
  const memory = ensureAIMemory(room, player);
  return {
    episodes: memory.episodes.slice(-8).map((entry) => entry.text),
    beliefs: Object.entries(memory.beliefs).slice(-6).map((entry) => ({
      name: entry[0],
      claims: entry[1].claims,
      truths: entry[1].truths,
      lies: entry[1].lies,
      challenges: entry[1].challenges,
      correctChallenges: entry[1].correctChallenges,
      wrongChallenges: entry[1].wrongChallenges
    })),
    lastThought: memory.lastThought || ""
  };
}

function analyzeSituation(room, player) {
  const rankMatches = player.hand.filter((card) => !card.wild && card.rank === room.tableRank).length;
  const jokers = player.hand.filter((card) => card.wild).length;
  const unseenMatching = Math.max(0, RANK_COPIES - rankMatches) + Math.max(0, JOKER_COUNT - jokers);
  const unseenTotal = Math.max(1, RANK_COPIES * RANKS.length + JOKER_COUNT - player.hand.length);
  let claimProbability = null;
  if (room.lastPlay) {
    claimProbability = 1;
    for (let index = 0; index < room.lastPlay.count; index += 1) {
      claimProbability *= Math.max(0, unseenMatching - index) / Math.max(1, unseenTotal - index);
    }
  }
  return {
    matchingRank: rankMatches,
    jokers,
    unseenMatching,
    unseenTotal,
    claimProbability: claimProbability == null ? null : Math.round(claimProbability * 1000) / 1000,
    lastClaimCount: room.lastPlay ? room.lastPlay.count : 0
  };
}

function captureRoundThoughts(room) {
  const thoughts = [];
  for (const player of room.players) {
    if (!player.occupied || (!player.isAI && !player.autopilot)) {
      continue;
    }
    const memory = ensureAIMemory(room, player);
    if (memory.lastMonologue && memory.lastMonologueRound === room.round) {
      thoughts.push({
        playerId: player.id,
        name: player.name,
        avatarEmoji: player.emoji,
        avatarUrl: player.avatarUrl,
        portraitUrl: player.portraitUrl,
        text: memory.lastMonologue
      });
    }
  }
  room.roundThoughts = thoughts;
  return thoughts;
}

function fillAISeats(room, aiRoles) {
  const roles = Array.isArray(aiRoles) ? aiRoles : [];
  let aiIndex = 0;
  for (const player of room.players) {
    if (player.occupied) {
      continue;
    }
    const persona = AI_PERSONAS[player.seat % AI_PERSONAS.length];
    const role = roles.length > 0 ? roles[aiIndex % roles.length] : null;
    player.id = "ai-" + makeId();
    player.name = role ? role.name : persona.name;
    player.emoji = role ? (role.avatarEmoji || persona.emoji) : persona.emoji;
    player.avatarUrl = role ? (role.avatarUrl || null) : null;
    player.portraitUrl = role ? (role.portraitUrl || null) : null;
    player.isAI = true;
    player.occupied = true;
    player.connected = true;
    player.alive = true;
    player.autopilot = !player.isAI && !player.connected;
    player.aiRoleId = role ? role.id : null;
    player.modelLabel = role ? role.name : "本地策略";
    ensureAIMemory(room, player);
    aiIndex += 1;
  }
}

function firstAliveSeat(room, startSeat) {
  for (let offset = 0; offset < SEAT_COUNT; offset += 1) {
    const seat = (startSeat + offset) % SEAT_COUNT;
    const player = room.players[seat];
    if (player.occupied && player.alive) {
      return player;
    }
  }
  return null;
}

function nextAlivePlayer(room, currentSeat) {
  return firstAliveSeat(room, (currentSeat + 1) % SEAT_COUNT);
}

function cardsInHands(room) {
  return alivePlayers(room).reduce((total, player) => total + player.hand.length, 0);
}

function nextAliveWithCards(room, currentSeat) {
  for (let offset = 1; offset <= SEAT_COUNT; offset += 1) {
    const player = room.players[(currentSeat + offset) % SEAT_COUNT];
    if (player.occupied && player.alive && player.hand.length > 0) {
      return player;
    }
  }
  return null;
}

function setTurn(room, player) {
  room.turnPlayerId = player ? player.id : null;
  if (!player) {
    room.phase = "playing";
    return;
  }
  const holders = alivePlayers(room).filter((item) => item.hand.length > 0);
  const lastHolderForced = Boolean(room.lastPlay && room.lastPlay.playerId !== player.id &&
    holders.length === 1 && holders[0].id === player.id);
  room.phase = (player.hand.length === 0 && room.lastPlay) || lastHolderForced
    ? "out_challenge"
    : "playing";
}

function nextTurnPlayer(room, currentSeat) {
  const alive = alivePlayers(room);
  if (alive.length === 2) {
    let next = nextAlivePlayer(room, currentSeat);
    if (next && next.hand.length === 0 && !room.lastPlay) {
      next = nextAlivePlayer(room, next.seat);
    }
    return next;
  }
  return nextAliveWithCards(room, currentSeat);
}

function startGame(room, options) {
  const opts = options || {};
  if (room.phase !== "lobby") {
    return { error: "当前状态无法开始游戏。" };
  }
  if (humanCount(room) > 2) {
    return { error: "最多两位真人玩家。" };
  }
  fillAISeats(room, opts.aiRoles);
  for (const player of room.players) {
    if (!player.occupied) {
      continue;
    }
    player.alive = true;
    player.autopilot = !player.isAI && !player.connected;
    player.hand = [];
    player.gun = { chamber: 0, bullet: randomInt(CHAMBER_COUNT, opts.rng) };
    player.matchStats = { deceptions: 0, challengeKills: 0, failedChallengeKills: 0 };
  }
  room.phase = "playing";
  room.round = 0;
  room.winnerId = null;
  room.winnerName = null;
  room.lastReveal = null;
  room.roundResult = null;
  room.outPlayerId = null;
  room.nextRoundAt = null;
  room.gameOverRecorded = false;
  addLog(room, "game", "牌局开始，四席入座。");
  const starter = typeof opts.starterSeat === "number"
    ? opts.starterSeat
    : randomInt(SEAT_COUNT, opts.rng);
  startRound(room, { rng: opts.rng, starterSeat: starter });
  return { ok: true };
}

function startRound(room, options) {
  const opts = options || {};
  const alive = alivePlayers(room);
  if (alive.length <= 1) {
    finishGame(room, alive[0] || null);
    return;
  }
  const deck = shuffle(createDeck(), opts.rng);
  for (const player of alive) {
    player.hand = deck.splice(0, HAND_SIZE);
  }
  const tableSuit = SUITS[randomInt(SUITS.length, opts.rng)];
  const tableCard = {
    id: "TABLE-" + (room.round + 1),
    rank: RANKS[randomInt(RANKS.length, opts.rng)],
    suit: tableSuit.symbol,
    red: tableSuit.red,
    wild: false,
    table: true
  };
  room.round += 1;
  room.tableCard = tableCard;
  room.tableRank = tableCard.rank;
  room.turnPlayerId = null;
  room.turnDeadline = null;
  room.turnGateUntil = null;
  room.turnGateReason = null;
  room.pendingSpeech = null;
  room.pendingCinematic = null;
  room.deferredAction = null;
  room.pile = [];
  room.lastPlay = null;
  room.outPlayerId = null;
  room.lastReveal = null;
  room.roundResult = null;
  room.nextRoundAt = null;
  room.nextStarterSeat = null;
  room.phase = "playing";
  const starterSeat = typeof opts.starterSeat === "number"
    ? opts.starterSeat
    : 0;
  const starter = firstAliveSeat(room, starterSeat);
  room.turnPlayerId = starter ? starter.id : null;
  addLog(room, "round", "第 " + room.round + " 轮开始。桌面点数为 " + room.tableRank + "。", {
    round: room.round,
    rank: room.tableRank,
    suit: tableCard ? tableCard.suit : ""
  });
  for (const player of alive) {
    if (player.isAI || player.autopilot) {
      rememberEvent(room, player, "第 " + room.round + " 轮开始，桌面点数 " + room.tableRank + "。", { type: "round" });
    }
  }
}

function triggerRoulette(player, rng) {
  if (!player.gun) {
    player.gun = { chamber: 0, bullet: randomInt(CHAMBER_COUNT, rng) };
  }
  const shot = player.gun.chamber === player.gun.bullet;
  if (!shot) {
    player.gun.chamber += 1;
  }
  return {
    shot,
    chamber: player.gun.chamber,
    chambers: CHAMBER_COUNT
  };
}

function finishGame(room, winner, reason) {
  if (room.lastPlay && room.lastPlay.lie) {
    const previous = findPlayer(room, room.lastPlay.playerId);
    if (previous && previous.matchStats) {
      previous.matchStats.deceptions += 1;
    }
    room.lastPlay.lie = false;
  }
  room.phase = "gameover";
  room.turnPlayerId = null;
  room.nextRoundAt = null;
  room.aiThinkingId = null;
  room.aiThought = null;
  room.winnerId = winner ? winner.id : null;
  room.winnerName = winner ? winner.name : "无人";
  room.roundResult = reason || (winner
    ? winner.name + " 成为了酒馆里最后的活人。"
    : "酒馆归于沉寂。");
  for (const player of room.players) {
    if (player.occupied) {
      player.alive = Boolean(winner && player.id === winner.id);
    }
  }
  captureRoundThoughts(room);
  addLog(room, "gameover", room.roundResult, {
    winnerId: room.winnerId,
    winnerName: room.winnerName
  });
}

function performAction(room, playerId, action, rng) {
  if (room.phase !== "playing" && room.phase !== "out_challenge") {
    return { error: "现在不能行动。" };
  }
  const player = findPlayer(room, playerId);
  if (!player || !player.alive) {
    return { error: "你不在牌局中。" };
  }
  if (room.turnPlayerId !== playerId) {
    return { error: "还没轮到你。" };
  }
  if (room.pendingSpeech || (room.turnGateUntil && Date.now() < room.turnGateUntil)) {
    return { error: "等待上一位玩家放话结束。" };
  }
  const type = action && action.type;
  if (type === "challenge") {
    return resolveChallenge(room, player, rng, action.speech);
  }
  if (type === "pass") {
    return { error: "空手牌阶段只能质疑，不能放过。" };
  }
  if (type === "play") {
    return playCards(room, player, action.cardIds, action.speech, rng);
  }
  return { error: "未知操作。" };
}

function playCards(room, player, cardIds, speech, rng) {
  if (room.phase !== "playing") {
    return { error: "当前不是出牌阶段。" };
  }
  if (!Array.isArray(cardIds) || cardIds.length < 1 || cardIds.length > MAX_PLAY) {
    return { error: "每次必须打出 1 到 3 张牌。" };
  }
  const holdersBefore = alivePlayers(room).filter((item) => item.hand.length > 0);
  if (room.lastPlay && room.lastPlay.playerId !== player.id && holdersBefore.length === 1 && holdersBefore[0].id === player.id) {
    return { error: "你是全场最后一名持牌者，必须质疑上一位，不能出牌。" };
  }
  const uniqueIds = Array.from(new Set(cardIds.map(String)));
  if (uniqueIds.length !== cardIds.length) {
    return { error: "不能重复选择同一张牌。" };
  }
  const cards = [];
  for (const id of uniqueIds) {
    const card = player.hand.find((item) => item.id === id);
    if (!card) {
      return { error: "手牌中没有这张牌。" };
    }
    cards.push(card);
  }
  if (room.lastPlay) {
    const previous = findPlayer(room, room.lastPlay.playerId);
    if (previous && room.lastPlay.lie && previous.matchStats) {
      previous.matchStats.deceptions += 1;
    }
  }
  player.hand = player.hand.filter((card) => !uniqueIds.includes(card.id));
  const claimRank = room.tableRank;
  room.pile.push.apply(room.pile, cards);
  room.lastReveal = null;
  room.lastPlay = {
    playerId: player.id,
    playerName: player.name,
    count: cards.length,
    claimRank,
    speech: String(speech || "").slice(0, 120),
    lie: !cards.every((card) => card.wild || card.rank === claimRank),
    cards,
    at: Date.now()
  };
  addLog(room, "play", player.name + " 扣下 " + cards.length + " 张牌，宣称是 " + claimRank + "。", {
    action: "play",
    playerId: player.id,
    playerName: player.name,
    count: cards.length,
    claimRank,
    speech: String(speech || "").slice(0, 120)
  });
  if (player.hand.length === 0) {
    room.outPlayerId = player.id;
    addLog(room, "notice", player.name + " 已打空手牌，牌局继续，直到有人质疑或全部手牌耗尽。");
  } else {
    room.outPlayerId = null;
  }
  const next = nextTurnPlayer(room, player.seat);
  if (next) {
    setTurn(room, next);
  } else if (cardsInHands(room) === 0) {
    const fallback = nextAlivePlayer(room, player.seat);
    if (fallback && fallback.id !== player.id) {
      setTurn(room, fallback);
    } else {
      finishGame(room, player);
    }
  } else {
    finishGame(room, player);
  }
  room.version += 1;
  return { ok: true };
}

function resolveChallenge(room, challenger, rng, speech) {
  if (!room.lastPlay) {
    return { error: "现在没有可以质疑的出牌。" };
  }
  const accused = findPlayer(room, room.lastPlay.playerId);
  if (!accused) {
    return { error: "被质疑的玩家不在牌局中。" };
  }
  const cards = room.lastPlay.cards.slice();
  const truthful = cards.every((card) => card.wild || card.rank === room.lastPlay.claimRank);
  room.lastPlay.lie = false;
  const loser = truthful ? challenger : accused;
  const roulette = triggerRoulette(loser, rng);
  if (roulette.shot) {
    loser.alive = false;
    loser.hand = [];
    const killer = truthful ? accused : challenger;
    if (killer.matchStats) {
      if (truthful) {
        killer.matchStats.failedChallengeKills += 1;
      } else {
        killer.matchStats.challengeKills += 1;
      }
    }
  }
  const revealText = truthful ? "亮牌属实" : "抓到了谎言";
  const fateText = roulette.shot ? "中弹倒下" : "只听见空枪";
  const summary = challenger.name + " 质疑 " + accused.name + "：" + revealText + "。" +
    loser.name + " 扣下扳机，" + fateText + "。";
  room.lastReveal = {
    id: makeId(),
    at: Date.now(),
    claimantId: accused.id,
    claimantName: accused.name,
    challengerId: challenger.id,
    challengerName: challenger.name,
    loserId: loser.id,
    loserName: loser.name,
    truthful,
    shot: roulette.shot,
    dead: roulette.shot,
    speech: String(speech || "").slice(0, 120),
    cards: cards.map((card) => ({
      id: card.id,
      rank: card.rank,
      suit: card.suit,
      red: card.red,
      wild: Boolean(card.wild),
      label: card.label || ""
    })),
    summary
  };
  rememberReveal(room, accused, challenger, truthful, roulette.shot, roulette.shot);
  captureRoundThoughts(room);
  addLog(room, roulette.shot ? "death" : "challenge", summary, {
    revealId: room.lastReveal.id,
    truthful,
    shot: roulette.shot,
    speech: String(speech || "").slice(0, 120)
  });
  room.turnPlayerId = null;
  room.outPlayerId = null;
  if (alivePlayers(room).length <= 1) {
    finishGame(room, alivePlayers(room)[0] || null);
    return { ok: true, reveal: room.lastReveal };
  }
  if (cardsInHands(room) === 0) {
    const winner = truthful ? accused : challenger;
    finishGame(room, winner, winner.name + " 在最后一手质疑中胜出，所有手牌已经打完。");
    return { ok: true, reveal: room.lastReveal };
  }
  room.lastPlay = null;
  room.outPlayerId = null;
  const next = nextTurnPlayer(room, challenger.seat);
  if (!next) {
    finishGame(room, challenger, challenger.name + " 成为了酒馆里最后的持牌人。");
    return { ok: true, reveal: room.lastReveal };
  }
  room.phase = "playing";
  room.turnPlayerId = next.id;
  addLog(room, "notice", "质疑结算完毕，牌局继续。轮到 " + next.name + "。");
  return { ok: true, reveal: room.lastReveal };
}

function vacateSeat(player) {
  player.id = null;
  player.secret = null;
  player.name = "空位";
  player.emoji = "🪑";
  player.isAI = false;
  player.occupied = false;
  player.connected = false;
  player.alive = false;
  player.autopilot = false;
  player.hand = [];
  player.gun = null;
  player.accountId = null;
  player.location = null;
  player.matchStats = null;
  player.aiRoleId = null;
  player.avatarUrl = null;
  player.portraitUrl = null;
  player.modelLabel = null;
}

function prepareRematch(room, options) {
  const opts = options || {};
  const keepPlayerIds = new Set(Array.isArray(opts.keepPlayerIds) ? opts.keepPlayerIds : []);
  room.phase = "lobby";
  room.round = 0;
  room.winnerId = null;
  room.winnerName = null;
  room.tableCard = null;
  room.tableRank = null;
  room.pile = [];
  room.lastPlay = null;
  room.outPlayerId = null;
  room.lastReveal = null;
  room.roundResult = null;
  room.nextRoundAt = null;
  room.nextStarterSeat = null;
  room.aiThought = null;
  room.roundThoughts = [];
  room.turnPlayerId = null;
  room.turnDeadline = null;
  room.turnGateUntil = null;
  room.turnGateReason = null;
  room.pendingSpeech = null;
  room.pendingCinematic = null;
  room.deferredAction = null;
  room.aiThinkingId = null;
  room.aiThought = null;
  room.gameOverRecorded = false;
  for (const player of room.players) {
    const keep = player.occupied && !player.isAI && keepPlayerIds.has(player.id);
    if (keep) {
      player.alive = false;
      player.hand = [];
      player.gun = null;
      player.autopilot = false;
      player.matchStats = { deceptions: 0, challengeKills: 0, failedChallengeKills: 0 };
    } else {
      vacateSeat(player);
    }
  }
  const host = room.players.find((player) => player.occupied && !player.isAI);
  room.hostId = host ? host.id : null;
  addLog(room, "game", "主桌重新开张。");
  return { ok: true };
}

function restartGame(room, options) {
  const opts = options || {};
  prepareRematch(room, { keepPlayerIds: opts.keepPlayerIds });
  return startGame(room, opts);
}

function publicState(room, viewerId) {
  const viewer = findPlayer(room, viewerId);
  const humans = room.players.filter((player) => player.occupied && !player.isAI);
  const aiHandsRevealed = humans.length > 0 && !humans.some((player) => player.alive);
  const turnPlayer = room.turnPlayerId ? findPlayer(room, room.turnPlayerId) : null;
  const lastPlay = room.lastPlay ? {
    playerId: room.lastPlay.playerId,
    playerName: room.lastPlay.playerName,
    count: room.lastPlay.count,
    claimRank: room.lastPlay.claimRank,
    at: room.lastPlay.at
  } : null;
  const isMyTurn = Boolean(viewer && room.turnPlayerId === viewer.id);
  const legal = {
    play: false,
    challenge: false,
    pass: false,
    maxCards: viewer ? Math.min(MAX_PLAY, viewer.hand.length) : 0,
    minCards: 1
  };
  if (viewer && isMyTurn && room.phase === "playing") {
    legal.play = viewer.hand.length > 0;
    legal.challenge = Boolean(room.lastPlay);
  }
  if (viewer && isMyTurn && room.phase === "out_challenge") {
    legal.challenge = Boolean(room.lastPlay);
  }
  return {
    code: room.code,
    phase: room.phase,
    round: room.round,
    players: room.players.map((player) => ({
      seat: player.seat,
      id: player.occupied ? player.id : null,
      name: player.name,
      emoji: player.emoji,
      isAI: player.isAI,
      occupied: player.occupied,
      connected: player.connected,
      alive: player.alive,
      autopilot: player.autopilot,
      location: player.location,
      handCount: player.hand.length,
      revealedHand: aiHandsRevealed && player.isAI ? player.hand.map((card) => ({
        rank: card.rank,
        suit: card.suit,
        red: Boolean(card.red),
        wild: Boolean(card.wild),
        label: card.label || ""
      })) : null,
      aiRoleId: player.aiRoleId,
      avatarUrl: player.avatarUrl,
      portraitUrl: player.portraitUrl,
      modelLabel: player.modelLabel,
      isHost: player.id === room.hostId,
      thinking: player.id === room.aiThinkingId
    })),
    me: viewer ? {
      seat: viewer.seat,
      id: viewer.id,
      name: viewer.name,
      avatarUrl: viewer.avatarUrl,
      portraitUrl: viewer.portraitUrl,
      hand: viewer.hand,
      alive: viewer.alive,
      connected: viewer.connected,
      autopilot: viewer.autopilot,
      location: viewer.location
    } : null,
    turnPlayerId: room.turnPlayerId,
    turnDeadline: room.turnDeadline,
    turnGateUntil: room.turnGateUntil,
    turnGateReason: room.turnGateReason || null,
    pendingSpeech: room.pendingSpeech || null,
    cinematicId: room.pendingCinematic ? room.pendingCinematic.id : null,
    turnSeat: turnPlayer ? turnPlayer.seat : null,
    turnPlayerName: turnPlayer ? turnPlayer.name : null,
    aiThought: room.aiThought || null,
    roundThoughts: room.roundThoughts || [],
    tableCard: room.tableCard,
    tableRank: room.tableRank,
    pileCount: room.pile.length,
    cardsInHands: cardsInHands(room),
    aiHandsRevealed,
    lastPlay,
    lastReveal: room.lastReveal,
    roundResult: room.roundResult,
    nextRoundAt: room.nextRoundAt,
    winnerId: room.winnerId,
    winnerName: room.winnerName,
    hostId: room.hostId,
    humanCount: humanCount(room),
    canStart: Boolean(viewer && viewer.id === room.hostId && room.phase === "lobby"),
    canRestart: Boolean(viewer && viewer.id === room.hostId && room.phase === "gameover"),
    isSpectator: !viewer,
    demo: room.demo,
    legal,
    aiLineup: room.aiLineup.map((id) => room.aiRoleCache[id] || { id, name: "AI", avatarEmoji: "🎲", avatarUrl: "" }),
    chat: room.chat.slice(-40),
    log: room.log.slice(-50),
    version: room.version,
    serverTime: Date.now()
  };
}

function aiContext(room, player) {
  return {
    playerId: player.id,
    name: player.name,
    style: AI_PERSONAS[player.seat % AI_PERSONAS.length].style,
    seat: player.seat,
    hand: player.hand.map((card) => ({
      id: card.id,
      rank: card.rank,
      suit: card.suit,
      wild: Boolean(card.wild),
      label: card.label || ""
    })),
    tableRank: room.tableRank,
    phase: room.phase,
    round: room.round,
    aliveCount: alivePlayers(room).length,
    lastPlay: room.lastPlay ? {
      playerId: room.lastPlay.playerId,
      playerName: room.lastPlay.playerName,
      count: room.lastPlay.count,
      claimRank: room.lastPlay.claimRank
    } : null,
    alivePlayers: alivePlayers(room).map((item) => ({
      name: item.name,
      seat: item.seat,
      handCount: item.hand.length
    })),
    recentLog: room.log.slice(-12).map((entry) => entry.text),
    recentChat: room.chat.slice(-6).map((entry) => entry.name + ": " + entry.text),
    memory: buildMemorySummary(room, player),
    tactical: analyzeSituation(room, player)
  };
}

module.exports = {
  SEAT_COUNT,
  HAND_SIZE,
  MAX_PLAY,
  CHAMBER_COUNT,
  RANK_COPIES,
  JOKER_COUNT,
  RANKS,
  SUITS,
  AI_PERSONAS,
  makeId,
  randomInt,
  createDeck,
  createRoom,
  sanitizeName,
  humanCount,
  findPlayer,
  alivePlayers,
  cardsInHands,
  addLog,
  addChat,
  addHuman,
  removeHuman,
  fillAISeats,
  startGame,
  startRound,
  performAction,
  prepareRematch,
  restartGame,
  publicState,
  aiContext,
  analyzeSituation,
  captureRoundThoughts,
  ensureAIMemory,
  rememberEvent
};
