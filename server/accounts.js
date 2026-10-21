"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ACCOUNT_DEFS = [
  { id: "shanghai", location: "上海", envKey: "SHANGHAI_LOGIN_KEY" },
  { id: "hangzhou", location: "杭州", envKey: "HANGZHOU_LOGIN_KEY" }
];
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function hashKey(key, salt) {
  return crypto.scryptSync(String(key), salt, 64).toString("hex");
}

function newStats() {
  return {
    gamesPlayed: 0,
    wins: 0,
    deaths: 0,
    deceptions: 0,
    challengeKills: 0,
    failedChallengeKills: 0,
    currentStreak: 0,
    bestStreak: 0
  };
}

function normalizeUsername(value) {
  const text = String(value || "").normalize("NFKC").replace(/\s+/g, " ").trim().slice(0, 16);
  if (Array.from(text).length < 2) {
    throw new Error("用户名至少需要 2 个字符。");
  }
  if (/[·|｜<>]/.test(text)) {
    throw new Error("用户名不能包含地点分隔符或尖括号。");
  }
  return text;
}

class AccountStore {
  constructor(options) {
    const opts = options || {};
    this.dataDir = opts.dataDir || process.env.DATA_DIR || path.join(__dirname, "..", "data");
    this.accountsPath = path.join(this.dataDir, "accounts.json");
    this.sessions = new Map();
    this.generatedKeys = {};
    this.initialKeys = opts.initialKeys || {};
    this.config = this.load();
  }

  load() {
    fs.mkdirSync(this.dataDir, { recursive: true, mode: 0o750 });
    if (fs.existsSync(this.accountsPath)) {
      const parsed = JSON.parse(fs.readFileSync(this.accountsPath, "utf8"));
      if (!parsed.accounts || !parsed.accounts.shanghai || !parsed.accounts.hangzhou) {
        throw new Error("账户数据文件不完整。");
      }
      let changed = false;
      for (const account of Object.values(parsed.accounts)) {
        if (!account.stats) {
          account.stats = newStats();
          changed = true;
        }
        for (const [key, value] of Object.entries(newStats())) {
          if (typeof account.stats[key] !== "number") {
            account.stats[key] = value;
            changed = true;
          }
        }
      }
      if (!parsed.aiStats || typeof parsed.aiStats !== "object") {
        parsed.aiStats = {};
        changed = true;
      }
      if (changed) {
        this.config = parsed;
        this.save();
      }
      return parsed;
    }

    const accounts = {};
    for (const definition of ACCOUNT_DEFS) {
      const envKey = process.env[definition.envKey];
      const supplied = this.initialKeys[definition.id];
      const key = envKey || supplied || (definition.location === "上海" ? "SH-" : "HZ-") +
        crypto.randomBytes(12).toString("base64url");
      if (!envKey && !supplied) {
        this.generatedKeys[definition.id] = key;
      }
      const salt = crypto.randomBytes(16).toString("hex");
      accounts[definition.id] = {
        id: definition.id,
        location: definition.location,
        keySalt: salt,
        keyHash: hashKey(key, salt),
        username: "",
        pendingRename: false,
        stats: newStats(),
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
    }
    const config = { version: 1, accounts, aiStats: {} };
    this.config = config;
    this.save();
    return config;
  }

  save() {
    const tempPath = this.accountsPath + ".tmp";
    fs.writeFileSync(tempPath, JSON.stringify(this.config, null, 2), { mode: 0o600 });
    fs.renameSync(tempPath, this.accountsPath);
    try {
      fs.chmodSync(this.accountsPath, 0o600);
    } catch (error) {
      // Windows does not support POSIX modes.
    }
  }

  byId(id) {
    return this.config.accounts[id] || null;
  }

  login(location, key) {
    const accountId = String(location || "").trim().toLowerCase();
    const account = this.byId(accountId);
    if (!account) {
      return { error: "请选择上海或杭州账户。" };
    }
    const received = hashKey(String(key || ""), account.keySalt);
    if (!safeEqual(received, account.keyHash)) {
      return { error: "账户密钥不正确。" };
    }
    const token = crypto.randomBytes(32).toString("base64url");
    this.sessions.set(token, {
      accountId: account.id,
      expiresAt: Date.now() + SESSION_TTL_MS
    });
    return { token, account: this.publicAccount(account) };
  }

  logout(token) {
    this.sessions.delete(token);
  }

  authenticate(token) {
    const session = this.sessions.get(String(token || ""));
    if (!session) {
      return null;
    }
    if (session.expiresAt <= Date.now()) {
      this.sessions.delete(token);
      return null;
    }
    session.expiresAt = Date.now() + SESSION_TTL_MS;
    return this.byId(session.accountId);
  }

  accountForToken(token) {
    return this.authenticate(token);
  }

  publicAccount(account) {
    if (!account) {
      return null;
    }
    const displayName = account.username
      ? account.location + " · " + account.username
      : account.location + " · 待命名";
    return {
      id: account.id,
      location: account.location,
      username: account.username || "",
      displayName,
      needsUsername: !account.username,
      pendingRename: Boolean(account.pendingRename),
      stats: Object.assign({}, account.stats)
    };
  }

  setUsername(token, value, options) {
    const account = this.authenticate(token);
    if (!account) {
      return { error: "登录已失效，请重新登录。" };
    }
    if (options && options.blocked) {
      return { error: "牌局进行中不能修改用户名。" };
    }
    let username;
    try {
      username = normalizeUsername(value);
    } catch (error) {
      return { error: error.message };
    }
    if (account.pendingRename && username === account.username) {
      return { error: "你已被淘汰，必须更换一个新的用户名。" };
    }
    const duplicate = Object.values(this.config.accounts).find((item) =>
      item.id !== account.id && item.username && item.username.toLowerCase() === username.toLowerCase());
    if (duplicate) {
      return { error: "这个用户名已经被另一个地点的玩家使用。" };
    }
    account.username = username;
    account.pendingRename = false;
    account.updatedAt = Date.now();
    this.save();
    return { ok: true, account: this.publicAccount(account) };
  }

  recordGame(room) {
    if (room.gameOverRecorded) {
      return false;
    }
    room.gameOverRecorded = true;
    const winnerId = room.winnerId;
    for (const player of room.players) {
      if (!player.occupied) {
        continue;
      }
      if (player.isAI) {
        const key = player.aiRoleId || "name:" + player.name;
        const current = this.config.aiStats[key] || { id: player.aiRoleId || null, name: player.name, games: 0, wins: 0 };
        current.name = player.name;
        current.games += 1;
        if (winnerId === player.id) {
          current.wins += 1;
        }
        this.config.aiStats[key] = current;
        continue;
      }
      const account = player.accountId ? this.byId(player.accountId) : null;
      if (!account) {
        continue;
      }
      const won = winnerId === player.id;
      account.stats.gamesPlayed += 1;
      if (won) {
        account.stats.wins += 1;
        account.stats.currentStreak += 1;
        account.stats.bestStreak = Math.max(account.stats.bestStreak, account.stats.currentStreak);
      } else {
        account.stats.currentStreak = 0;
      }
      if (!player.alive) {
        account.stats.deaths += 1;
        account.pendingRename = true;
      }
      const match = player.matchStats || {};
      account.stats.deceptions += Number(match.deceptions || 0);
      account.stats.challengeKills += Number(match.challengeKills || 0);
      account.stats.failedChallengeKills += Number(match.failedChallengeKills || 0);
      account.lastResult = won ? "win" : "loss";
      account.lastPlayedAt = Date.now();
      account.updatedAt = Date.now();
    }
    this.save();
    return true;
  }

  leaderboard(enabledRoles) {
    const users = Object.values(this.config.accounts).map((account) => {
      const view = this.publicAccount(account);
      return {
        id: view.id,
        location: view.location,
        username: view.username,
        displayName: view.displayName,
        deception: view.stats.deceptions,
        challengeKills: view.stats.challengeKills,
        failedChallengeKills: view.stats.failedChallengeKills,
        kills: view.stats.challengeKills + view.stats.failedChallengeKills,
        bestStreak: view.stats.bestStreak,
        currentStreak: view.stats.currentStreak,
        wins: view.stats.wins,
        gamesPlayed: view.stats.gamesPlayed
      };
    });
    const roles = Array.isArray(enabledRoles) ? enabledRoles : [];
    const seen = new Set();
    const ai = [];
    for (const role of roles) {
      const stats = this.config.aiStats[role.id] || { games: 0, wins: 0 };
      seen.add(role.id);
      ai.push({
        id: role.id,
        name: role.name,
        avatarUrl: role.avatarUrl || "",
        portraitUrl: role.portraitUrl || "",
        games: stats.games,
        wins: stats.wins,
        winRate: stats.games > 0 ? stats.wins / stats.games : 0
      });
    }
    for (const [key, stats] of Object.entries(this.config.aiStats)) {
      if (seen.has(key)) {
        continue;
      }
      ai.push({
        id: key,
        name: stats.name,
        avatarUrl: "",
        portraitUrl: "",
        games: stats.games,
        wins: stats.wins,
        winRate: stats.games > 0 ? stats.wins / stats.games : 0
      });
    }
    ai.sort((left, right) => (right.winRate - left.winRate) || (right.wins - left.wins) || (right.games - left.games));
    return { users, ai };
  }

  resetAll() {
    for (const account of Object.values(this.config.accounts)) {
      account.username = "";
      account.pendingRename = false;
      account.stats = newStats();
      account.lastResult = null;
      account.lastPlayedAt = null;
      account.updatedAt = Date.now();
    }
    this.config.aiStats = {};
    this.save();
    return { ok: true };
  }
}

module.exports = { AccountStore, ACCOUNT_DEFS, normalizeUsername };
