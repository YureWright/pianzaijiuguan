"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const PROVIDER_DEFAULTS = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta"
};

const DEFAULT_ROLES = [
  {
    name: "DeepSeek",
    provider: "openai",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    avatarEmoji: "🐋",
    portraitUrl: "/portraits/deepseek.svg",
    systemPrompt: "你冷静、擅长概率判断。先观察对手的声明数量和历史行为，再决定是否质疑；不要因为情绪轻易开枪。"
  },
  {
    name: "GPT",
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4.1-mini",
    avatarEmoji: "🤖",
    portraitUrl: "/portraits/gpt.svg",
    systemPrompt: "你精于计算和试探。尽量用最少的牌制造最大压力，喜欢用连续的声明逼对手犯错。"
  },
  {
    name: "Claude",
    provider: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    model: "claude-sonnet-4-20250514",
    avatarEmoji: "🎭",
    portraitUrl: "/portraits/claude.svg",
    systemPrompt: "你优雅、敏锐，擅长从语气和行动节奏判断谎言。质疑时要果断，发言可以带有反讽。"
  },
  {
    name: "Kimi",
    provider: "openai",
    baseUrl: "https://api.moonshot.cn/v1",
    model: "moonshot-v1-8k",
    avatarEmoji: "🌙",
    portraitUrl: "/portraits/kimi.svg",
    systemPrompt: "你谨慎而耐心，重视长期记忆和对手倾向。不要急着质疑，只有证据足够时才出手。"
  },
  {
    name: "豆包",
    provider: "openai",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    model: "doubao-1-5-pro-32k-250115",
    avatarEmoji: "🫘",
    portraitUrl: "/portraits/doubao.svg",
    systemPrompt: "你激进、爱冒险，喜欢用虚张声势压迫别人。适当主动撒谎，但不要连续暴露同样的模式。"
  },
  {
    name: "千问",
    provider: "openai",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-plus",
    avatarEmoji: "🧠",
    portraitUrl: "/portraits/qwen.svg",
    systemPrompt: "你善于总结和推演，喜欢根据概率、剩余牌数和对手历史做决定，发言简洁。"
  }
];

function defaultPromptFor(name) {
  const match = DEFAULT_ROLES.find((role) => role.name === name);
  return match ? match.systemPrompt : "你是一名擅长社交推理和虚张声势的牌手，优先保证自己存活。";
}

function defaultPortraitFor(name) {
  const match = DEFAULT_ROLES.find((role) => role.name === name);
  return match ? match.portraitUrl : "/portraits/gpt.svg";
}

const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 64).toString("hex");
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function clampText(value, max, fallback) {
  const text = String(value == null ? "" : value).trim();
  return (text || fallback || "").slice(0, max);
}

function validAvatarUrl(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  if (text.length > 400000) {
    throw new Error("头像文件太大。");
  }
  if (!/^data:image\/(png|jpeg|webp|gif);base64,/i.test(text) && !/^https?:\/\//i.test(text)) {
    throw new Error("头像必须是图片 URL 或上传的图片。");
  }
  return text;
}

function validMusicUrl(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  if (text.length > 13 * 1024 * 1024) {
    throw new Error("背景音乐文件太大。");
  }
  if (/^data:audio\/(mpeg|mp3|wav|ogg|webm|mp4|aac);base64,/i.test(text) ||
      /^https?:\/\//i.test(text) ||
      /^\//.test(text)) {
    return text;
  }
  throw new Error("背景音乐必须是音频 URL、站内路径或上传的音频文件。");
}

class AdminStore {
  constructor(options) {
    const opts = options || {};
    this.dataDir = opts.dataDir || process.env.DATA_DIR || path.join(__dirname, "..", "data");
    this.configPath = path.join(this.dataDir, "config.json");
    this.sessions = new Map();
    this.generatedPassword = null;
    this.config = this.loadConfig();
  }

  loadConfig() {
    fs.mkdirSync(this.dataDir, { recursive: true, mode: 0o750 });
    if (fs.existsSync(this.configPath)) {
      const parsed = JSON.parse(fs.readFileSync(this.configPath, "utf8"));
      if (!parsed.admin || !parsed.admin.salt || !parsed.admin.hash) {
        throw new Error("管理员配置文件缺少密码信息。");
      }
      if (!Array.isArray(parsed.roles)) {
        parsed.roles = this.defaultRoles();
        this.saveConfig(parsed);
      } else {
        let migrated = false;
        for (const role of parsed.roles) {
          if (typeof role.systemPrompt !== "string") {
            role.systemPrompt = defaultPromptFor(role.name);
            migrated = true;
          }
          if (typeof role.portraitUrl !== "string" || !role.portraitUrl) {
            role.portraitUrl = defaultPortraitFor(role.name);
            migrated = true;
          }
        }
        if (migrated) {
          this.saveConfig(parsed);
        }
      }
      if (!parsed.music || typeof parsed.music !== "object") {
        parsed.music = this.defaultMusic();
        this.saveConfig(parsed);
      }
      return parsed;
    }
    const envPassword = process.env.ADMIN_PASSWORD;
    const password = envPassword || crypto.randomBytes(12).toString("base64url");
    if (!envPassword) {
      this.generatedPassword = password;
    }
    const salt = crypto.randomBytes(16).toString("hex");
    const config = {
      version: 1,
      admin: {
        salt,
        hash: hashPassword(password, salt),
        updatedAt: Date.now()
      },
      music: this.defaultMusic(),
      roles: this.defaultRoles()
    };
    this.saveConfig(config);
    return config;
  }

  defaultRoles() {
    return DEFAULT_ROLES.map((role, index) => ({
      id: "ai-" + crypto.randomUUID(),
      name: role.name,
      provider: role.provider,
      baseUrl: role.baseUrl,
      model: role.model,
      apiKey: "",
      avatarEmoji: role.avatarEmoji || "🎲",
      avatarUrl: "",
      portraitUrl: role.portraitUrl,
      systemPrompt: role.systemPrompt,
      enabled: true,
      order: index,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }));
  }

  defaultMusic() {
    return {
      url: "",
      volume: 0.35,
      enabled: false,
      updatedAt: Date.now()
    };
  }

  publicMusic() {
    const music = this.config.music || this.defaultMusic();
    return {
      url: music.url || "",
      volume: Math.max(0, Math.min(0.8, Number(music.volume) || 0.35)),
      enabled: Boolean(music.enabled && music.url),
      updatedAt: music.updatedAt || 0
    };
  }

  updateMusic(input) {
    const source = input || {};
    const current = this.config.music || this.defaultMusic();
    const clear = source.clear === true;
    const url = clear ? "" : validMusicUrl(source.url === undefined ? current.url : source.url);
    const volumeValue = Number(source.volume === undefined ? current.volume : source.volume);
    const volume = Number.isFinite(volumeValue) ? Math.max(0, Math.min(0.8, volumeValue)) : 0.35;
    const enabled = clear ? false : (source.enabled === undefined ? Boolean(current.enabled) : Boolean(source.enabled));
    this.config.music = {
      url,
      volume,
      enabled: Boolean(url && enabled),
      updatedAt: Date.now()
    };
    this.saveConfig();
    return this.publicMusic();
  }

  saveConfig(config) {
    const data = config || this.config;
    const tempPath = this.configPath + ".tmp";
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), { mode: 0o600 });
    fs.renameSync(tempPath, this.configPath);
    try {
      fs.chmodSync(this.configPath, 0o600);
    } catch (error) {
      // Windows does not support POSIX modes.
    }
  }

  verifyPassword(password) {
    const expected = hashPassword(password, this.config.admin.salt);
    return safeEqual(expected, this.config.admin.hash);
  }

  login(password) {
    if (!this.verifyPassword(password)) {
      return null;
    }
    const now = Date.now();
    for (const entry of this.sessions.entries()) {
      if (entry[1].expiresAt <= now) {
        this.sessions.delete(entry[0]);
      }
    }
    const token = crypto.randomBytes(32).toString("base64url");
    this.sessions.set(token, { expiresAt: now + SESSION_TTL_MS });
    return token;
  }

  authenticate(token) {
    if (!token) {
      return false;
    }
    const session = this.sessions.get(token);
    if (!session) {
      return false;
    }
    if (session.expiresAt <= Date.now()) {
      this.sessions.delete(token);
      return false;
    }
    session.expiresAt = Date.now() + SESSION_TTL_MS;
    return true;
  }

  logout(token) {
    this.sessions.delete(token);
  }

  changePassword(currentPassword, nextPassword) {
    if (!this.verifyPassword(currentPassword)) {
      return { error: "当前管理员密码不正确。" };
    }
    if (!nextPassword || String(nextPassword).length < 8) {
      return { error: "新密码至少需要 8 个字符。" };
    }
    const salt = crypto.randomBytes(16).toString("hex");
    this.config.admin = {
      salt,
      hash: hashPassword(nextPassword, salt),
      updatedAt: Date.now()
    };
    this.saveConfig();
    this.sessions.clear();
    return { ok: true };
  }

  normalizeRole(input, existing) {
    const source = input || {};
    const base = existing || {};
    const provider = ["openai", "anthropic", "gemini"].includes(source.provider)
      ? source.provider
      : (base.provider || "openai");
    const name = clampText(source.name, 24, base.name || "未命名 AI");
    const model = clampText(source.model, 160, base.model || "");
    if (!model) {
      throw new Error("模型名称不能为空。");
    }
    let apiKey = base.apiKey || "";
    if (source.clearApiKey === true) {
      apiKey = "";
    } else if (typeof source.apiKey === "string" && source.apiKey.trim()) {
      apiKey = source.apiKey.trim().slice(0, 4000);
    }
    const role = {
      id: base.id || "ai-" + crypto.randomUUID(),
      name,
      provider,
      baseUrl: clampText(source.baseUrl, 500, base.baseUrl || PROVIDER_DEFAULTS[provider]),
      model,
      apiKey,
      avatarEmoji: clampText(source.avatarEmoji, 8, base.avatarEmoji || "🎲"),
      avatarUrl: source.avatarUrl === undefined ? (base.avatarUrl || "") : validAvatarUrl(source.avatarUrl),
      portraitUrl: source.portraitUrl === undefined
        ? (base.portraitUrl || defaultPortraitFor(name))
        : (String(source.portraitUrl).trim() || defaultPortraitFor(name)),
      systemPrompt: source.systemPrompt === undefined
        ? (base.systemPrompt || defaultPromptFor(name))
        : String(source.systemPrompt).slice(0, 4000),
      enabled: source.enabled === undefined ? (base.enabled !== false) : Boolean(source.enabled),
      order: typeof source.order === "number" ? source.order : (base.order || 0),
      createdAt: base.createdAt || Date.now(),
      updatedAt: Date.now()
    };
    return role;
  }

  listRoles() {
    return this.config.roles.slice().sort((left, right) => (left.order - right.order) || left.createdAt - right.createdAt);
  }

  enabledRoles() {
    return this.listRoles().filter((role) => role.enabled);
  }

  getRole(id, includeDisabled) {
    const role = this.config.roles.find((item) => item.id === id);
    if (!role || (!includeDisabled && !role.enabled)) {
      return null;
    }
    return role;
  }

  createRole(input) {
    const role = this.normalizeRole(input, null);
    role.order = this.config.roles.length;
    this.config.roles.push(role);
    this.saveConfig();
    return role;
  }

  updateRole(id, input) {
    const role = this.getRole(id, true);
    if (!role) {
      return null;
    }
    const updated = this.normalizeRole(input, role);
    const index = this.config.roles.findIndex((item) => item.id === id);
    this.config.roles[index] = updated;
    this.saveConfig();
    return updated;
  }

  deleteRole(id) {
    const before = this.config.roles.length;
    this.config.roles = this.config.roles.filter((role) => role.id !== id);
    if (this.config.roles.length === before) {
      return false;
    }
    this.config.roles.forEach((role, index) => {
      role.order = index;
    });
    this.saveConfig();
    return true;
  }

  adminView(role) {
    return {
      id: role.id,
      name: role.name,
      provider: role.provider,
      baseUrl: role.baseUrl,
      model: role.model,
      avatarEmoji: role.avatarEmoji,
      avatarUrl: role.avatarUrl,
      portraitUrl: role.portraitUrl,
      systemPrompt: role.systemPrompt,
      enabled: role.enabled,
      hasKey: Boolean(role.apiKey),
      apiKeyMasked: role.apiKey ? "••••••••" + role.apiKey.slice(-4) : "",
      updatedAt: role.updatedAt
    };
  }

  publicView(role) {
    return {
      id: role.id,
      name: role.name,
      provider: role.provider,
      model: role.model,
      avatarEmoji: role.avatarEmoji,
      avatarUrl: role.avatarUrl,
      portraitUrl: role.portraitUrl
    };
  }
}

module.exports = { AdminStore, DEFAULT_ROLES, PROVIDER_DEFAULTS };
