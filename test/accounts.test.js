"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { AccountStore } = require("../server/accounts");
const { RoomStore } = require("../server/rooms");

function tempStore() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "liars-accounts-"));
  const store = new AccountStore({
    dataDir,
    initialKeys: { shanghai: "shanghai-test-key", hangzhou: "hangzhou-test-key" }
  });
  return { store, dataDir };
}

test("fixed accounts login with keys and never expose raw keys", () => {
  const { store, dataDir } = tempStore();
  try {
    assert.equal(store.login("shanghai", "wrong").error, "账户密钥不正确。");
    const shanghai = store.login("shanghai", "shanghai-test-key");
    const hangzhou = store.login("hangzhou", "hangzhou-test-key");
    assert.equal(Boolean(shanghai.token), true);
    assert.equal(Boolean(hangzhou.token), true);
    assert.equal(shanghai.account.location, "上海");
    assert.equal(hangzhou.account.location, "杭州");
    assert.equal(JSON.stringify(shanghai.account).includes("shanghai-test-key"), false);
    const config = fs.readFileSync(path.join(dataDir, "accounts.json"), "utf8");
    assert.equal(config.includes("shanghai-test-key"), false);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("usernames are unique across locations and a death forces a rename", () => {
  const { store, dataDir } = tempStore();
  try {
    const shanghai = store.login("shanghai", "shanghai-test-key");
    const hangzhou = store.login("hangzhou", "hangzhou-test-key");
    assert.equal(store.setUsername(shanghai.token, "阿青").ok, true);
    assert.match(store.setUsername(hangzhou.token, "阿青").error, /已经被/);
    assert.equal(store.setUsername(hangzhou.token, "小满").ok, true);

    const room = {
      gameOverRecorded: false,
      winnerId: "hangzhou-player",
      players: [
        {
          occupied: true,
          isAI: false,
          id: "shanghai-player",
          accountId: "shanghai",
          alive: false,
          matchStats: { deceptions: 3, challengeKills: 1, failedChallengeKills: 2 }
        },
        {
          occupied: true,
          isAI: false,
          id: "hangzhou-player",
          accountId: "hangzhou",
          alive: true,
          matchStats: { deceptions: 1, challengeKills: 0, failedChallengeKills: 0 }
        },
        {
          occupied: true,
          isAI: true,
          id: "ai-player",
          aiRoleId: "ai-deepseek",
          name: "DeepSeek",
          alive: false
        }
      ]
    };
    assert.equal(store.recordGame(room), true);
    const shanghaiAccount = store.byId("shanghai");
    assert.equal(shanghaiAccount.pendingRename, true);
    assert.equal(shanghaiAccount.stats.deceptions, 3);
    assert.equal(shanghaiAccount.stats.challengeKills, 1);
    assert.equal(shanghaiAccount.stats.failedChallengeKills, 2);
    assert.equal(shanghaiAccount.stats.currentStreak, 0);
    const hangzhouAccount = store.byId("hangzhou");
    assert.equal(hangzhouAccount.stats.bestStreak, 1);
    assert.match(store.setUsername(shanghai.token, "阿青").error, /必须更换/);
    assert.equal(store.setUsername(shanghai.token, "阿青二号").ok, true);
    assert.equal(store.byId("shanghai").pendingRename, false);

    const board = store.leaderboard([{ id: "ai-deepseek", name: "DeepSeek" }]);
    assert.equal(board.users.find((item) => item.id === "shanghai").kills, 3);
    assert.equal(board.ai[0].games, 1);
    assert.equal(board.ai[0].wins, 0);
    assert.equal(board.ai[0].winRate, 0);

    store.resetAll();
    assert.equal(store.byId("shanghai").username, "");
    assert.equal(store.byId("shanghai").stats.gamesPlayed, 0);
    assert.equal(store.byId("hangzhou").username, "");
    assert.deepEqual(store.leaderboard([{ id: "ai-deepseek", name: "DeepSeek" }]).users.map((item) => item.username), ["", ""]);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("the single main table keeps survivors and removes a dead account on the next game", () => {
  const { store: accountStore, dataDir } = tempStore();
  const roles = [
    { id: "ai-deepseek", name: "DeepSeek", avatarEmoji: "🐋", avatarUrl: "", portraitUrl: "", enabled: true },
    { id: "ai-gpt", name: "GPT", avatarEmoji: "🤖", avatarUrl: "", portraitUrl: "", enabled: true },
    { id: "ai-claude", name: "Claude", avatarEmoji: "🎭", avatarUrl: "", portraitUrl: "", enabled: true }
  ];
  const adminStore = {
    enabledRoles: () => roles,
    getRole: (id) => roles.find((role) => role.id === id) || null,
    publicView: (role) => role
  };
  const roomStore = new RoomStore({ adminStore, accountStore });
  try {
    const shanghai = accountStore.login("shanghai", "shanghai-test-key");
    const hangzhou = accountStore.login("hangzhou", "hangzhou-test-key");
    accountStore.setUsername(shanghai.token, "外滩老千");
    accountStore.setUsername(hangzhou.token, "西湖牌客");
    const shanghaiEntry = roomStore.enterMainTable(accountStore.byId("shanghai"));
    const hangzhouEntry = roomStore.enterMainTable(accountStore.byId("hangzhou"));
    assert.equal(shanghaiEntry.roomCode, "MAIN");
    assert.equal(shanghaiEntry.room.players.filter((player) => player.occupied && !player.isAI).length, 2);
    const started = roomStore.startRoom("MAIN", shanghaiEntry.player.id, shanghaiEntry.player.secret);
    assert.equal(started.ok, true);
    const room = shanghaiEntry.room;
    const shanghaiPlayer = room.players.find((player) => player.accountId === "shanghai");
    const hangzhouPlayer = room.players.find((player) => player.accountId === "hangzhou");
    const shanghaiSecret = shanghaiPlayer.secret;
    room.pendingSpeech = {
      id: "speech-ack",
      playerId: "ai-x",
      playerName: "AI",
      text: "听我说完。",
      requiredAcks: [shanghaiPlayer.id, hangzhouPlayer.id]
    };
    room.turnGateUntil = Date.now() + 12000;
    const firstAck = roomStore.acknowledgeSpeech("MAIN", shanghaiPlayer.id, shanghaiSecret, "speech-ack");
    assert.equal(firstAck.waitingFor, 1);
    assert.equal(room.pendingSpeech.id, "speech-ack");
    const secondAck = roomStore.acknowledgeSpeech("MAIN", hangzhouPlayer.id, hangzhouPlayer.secret, "speech-ack");
    assert.equal(secondAck.ok, true);
    assert.equal(room.pendingSpeech, null);
    assert.equal(room.turnGateUntil, null);

    const previousRevealId = room.lastReveal ? room.lastReveal.id : null;
    room.phase = "playing";
    room.turnPlayerId = hangzhouPlayer.id;
    room.lastPlay = {
      playerId: shanghaiPlayer.id,
      playerName: shanghaiPlayer.name,
      count: 1,
      claimRank: room.tableRank,
      speech: "",
      cards: [shanghaiPlayer.hand[0]],
      lie: true,
      at: Date.now()
    };
    room.pendingSpeech = {
      id: "deferred-challenge",
      playerId: hangzhouPlayer.id,
      playerName: hangzhouPlayer.name,
      text: "你这话我不信。",
      requiredAcks: [shanghaiPlayer.id, hangzhouPlayer.id]
    };
    room.turnGateUntil = Date.now() + 12000;
    room.deferredAction = {
      playerId: hangzhouPlayer.id,
      action: { type: "challenge", speech: "" }
    };
    roomStore.acknowledgeSpeech("MAIN", shanghaiPlayer.id, shanghaiSecret, "deferred-challenge");
    assert.equal(room.lastReveal ? room.lastReveal.id : null, previousRevealId);
    roomStore.acknowledgeSpeech("MAIN", hangzhouPlayer.id, hangzhouPlayer.secret, "deferred-challenge");
    assert.equal(Boolean(room.lastReveal), true);
    assert.notEqual(room.lastReveal.id, previousRevealId);
    assert.equal(room.turnGateReason, "cinematic");
    assert.equal(room.turnGateUntil > Date.now(), true);
    room.phase = "gameover";
    room.winnerId = shanghaiPlayer.id;
    room.winnerName = shanghaiPlayer.name;
    room.roundResult = "测试结算";
    for (const player of room.players) {
      if (player.occupied) {
        player.alive = player.id === shanghaiPlayer.id;
      }
    }
    roomStore.afterChange(room);
    assert.equal(accountStore.byId("hangzhou").pendingRename, true);
    const next = roomStore.startNextGame("MAIN", shanghaiPlayer.id, shanghaiSecret);
    assert.equal(next.ok, true);
    assert.equal(room.phase, "playing");
    assert.equal(room.code, "MAIN");
    assert.equal(room.players.some((player) => player.accountId === "hangzhou"), false);
    const keptShanghai = room.players.find((player) => player.accountId === "shanghai");
    assert.equal(Boolean(keptShanghai), true);
    assert.equal(keptShanghai.secret, shanghaiSecret);
    assert.equal(room.players.filter((player) => player.occupied).length, 4);
  } finally {
    roomStore.closeAll();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
