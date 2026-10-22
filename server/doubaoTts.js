"use strict";

const crypto = require("node:crypto");

const CACHE_LIMIT = 80;
const CACHE_TTL_MS = 30 * 60 * 1000;
const CLASSIC_ENDPOINT = "https://openspeech.bytedance.com/api/v1/tts";
const API_ENDPOINT = "https://openspeech.bytedance.com/api/v3/tts/unidirectional";
const cache = new Map();
const inFlight = new Map();

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url, options) {
  let response = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    response = await fetch(url, options);
    if (response.status !== 429 && response.status < 500) {
      return response;
    }
    if (attempt === 0) {
      try {
        if (response.body) {
          await response.body.cancel();
        }
      } catch (error) {
        // Ignore stream cleanup before retry.
      }
      await wait(350);
    }
  }
  return response;
}

function authModeFor(settings) {
  return settings && settings.authMode === "apikey" ? "apikey" : "classic";
}

function normalizeEndpoint(value, mode) {
  return String(value || (mode === "apikey" ? API_ENDPOINT : CLASSIC_ENDPOINT)).trim();
}

function audioType(format) {
  const value = String(format || "mp3").toLowerCase();
  if (value === "wav") return "audio/wav";
  if (value === "ogg_opus" || value === "opus") return "audio/ogg";
  return "audio/mpeg";
}

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) {
    return null;
  }
  if (Date.now() - entry.createdAt > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  cache.delete(key);
  cache.set(key, entry);
  return entry.audio;
}

function cacheSet(key, audio) {
  cache.set(key, { audio, createdAt: Date.now() });
  while (cache.size > CACHE_LIMIT) {
    cache.delete(cache.keys().next().value);
  }
}

function payloadLines(raw) {
  const text = String(raw || "").trim();
  if (!text) {
    return [];
  }
  if (!text.includes("\n")) {
    try {
      return [JSON.parse(text)];
    } catch (error) {
      return [];
    }
  }
  const values = [];
  for (const line of text.split(/\r?\n/)) {
    const clean = line.trim().replace(/^data:\s*/, "");
    if (!clean) {
      continue;
    }
    try {
      values.push(JSON.parse(clean));
    } catch (error) {
      // Ignore incomplete stream frames; the final code still determines success.
    }
  }
  return values;
}

function decodeApiKeyResponse(raw) {
  const chunks = [];
  let lastError = null;
  for (const payload of payloadLines(raw)) {
    const header = payload.header || {};
    const code = Number(header.code == null ? payload.code : header.code);
    if (Number.isFinite(code) && code !== 0 && code !== 20000000) {
      const message = header.message || payload.message || "豆包语音合成失败";
      lastError = code === 55000000
        ? "[55000000] Resource ID 与音色 ID 不匹配，请从对应音色目录选择 speaker。原始信息：" + message
        : "[" + code + "] " + message;
      continue;
    }
    if (payload.data) {
      chunks.push(Buffer.from(String(payload.data), "base64"));
    }
  }
  if (lastError) {
    throw new Error(lastError);
  }
  if (chunks.length === 0) {
    throw new Error("豆包语音接口没有返回音频数据。");
  }
  return Buffer.concat(chunks);
}

async function synthesizeClassic(settings, params, signal) {
  const { text, voice, format, speed, endpoint } = params;
  const appId = String(settings.appId || "").trim();
  const accessToken = String(settings.accessToken || "").trim();
  if (!appId || !accessToken) {
    throw new Error("豆包经典语音 AppID 或 Access Token 未配置。");
  }
  if (!/^[\x21-\x7e]+$/.test(appId) || !/^[\x21-\x7e]+$/.test(accessToken)) {
    throw new Error("豆包经典语音凭据包含中文或空格，请重新填写 AppID 和 Access Token。");
  }
  const cluster = String(settings.cluster || "volcano_tts").trim().slice(0, 80);
  const reqid = crypto.randomUUID();
  const response = await fetchWithRetry(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer;" + accessToken
    },
    signal,
    body: JSON.stringify({
      app: { appid: appId, token: accessToken, cluster },
      user: { uid: "liars-bar" },
      audio: {
        voice_type: voice,
        encoding: format,
        speed_ratio: speed,
        volume_ratio: 1,
        pitch_ratio: 1
      },
      request: {
        reqid,
        text,
        text_type: "plain",
        operation: "query"
      }
    })
  });
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  let payload = null;
  if (contentType.includes("application/json")) {
    payload = await response.json();
  }
  if (!response.ok) {
    throw new Error("豆包经典语音接口返回 " + response.status +
      (payload && payload.message ? "：" + payload.message : ""));
  }
  if (!payload) {
    throw new Error("豆包经典语音接口返回了无效响应。");
  }
  const code = Number(payload.code);
  if (code !== 0 && code !== 3000) {
    throw new Error("豆包经典语音合成失败 " + (payload.code == null ? "" : "[" + payload.code + "]") +
      "：" + (payload.message || "未知错误"));
  }
  const base64 = String(payload.data || "").trim();
  if (!base64) {
    throw new Error("豆包经典语音接口没有返回音频数据。");
  }
  return Buffer.from(base64, "base64");
}

async function synthesizeApiKey(settings, params, signal) {
  const { text, voice, format, speed, endpoint } = params;
  const apiKey = String(settings.apiKey || "").trim();
  const resourceId = String(settings.resourceId || "seed-tts-2.0").trim();
  if (!apiKey) {
    throw new Error("豆包新版语音 API Key 未配置。");
  }
  if (!resourceId) {
    throw new Error("豆包新版语音 Resource ID 未配置。");
  }
  if (!/^[\x21-\x7e]+$/.test(apiKey) || !/^[\x21-\x7e]+$/.test(resourceId)) {
    throw new Error("豆包语音 API Key 或 Resource ID 包含中文或空格，请重新填写。");
  }
  const response = await fetchWithRetry(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": apiKey,
      "X-Api-Resource-Id": resourceId,
      "X-Api-Request-Id": crypto.randomUUID()
    },
    signal,
    body: JSON.stringify({
      req_params: {
        text,
        speaker: voice,
        audio_params: {
          format,
          sample_rate: 24000,
          speech_rate: Math.max(-50, Math.min(100, Math.round((speed - 1) * 100)))
        }
      }
    })
  });
  const raw = await response.text();
  if (!response.ok) {
    let detail = raw.slice(0, 300);
    try {
      const payload = JSON.parse(raw);
      const header = payload.header || payload;
      const code = Number(header.code || response.status);
      detail = code === 55000000
        ? "[55000000] Resource ID 与音色 ID 不匹配，请从对应音色目录选择 speaker。原始信息：" + (header.message || detail)
        : "[" + code + "] " + (header.message || detail);
    } catch (error) {
      // Keep the raw response excerpt.
    }
    throw new Error("豆包新版语音接口返回 " + response.status + "：" + detail);
  }
  return decodeApiKeyResponse(raw);
}

async function synthesize(settings, options) {
  const opts = options || {};
  const text = String(opts.text || "").replace(/\s+/g, " ").trim().slice(0, 500);
  if (!text) {
    throw new Error("豆包语音文本不能为空。");
  }
  const mode = authModeFor(settings);
  const voice = String(opts.voice || settings.voiceType ||
    (mode === "apikey" ? "zh_female_vv_uranus_bigtts" : "BV001_streaming")).trim().slice(0, 120);
  const format = settings.format || "mp3";
  const speed = Math.max(0.5, Math.min(2, Number(settings.speed) || 1));
  const endpoint = normalizeEndpoint(settings.endpoint, mode);
  const key = crypto.createHash("sha256")
    .update([mode, endpoint, settings.resourceId || "", settings.appId || "", settings.cluster || "",
      voice, String(speed), format, text].join("\n"))
    .digest("hex");
  const cached = cacheGet(key);
  if (cached) {
    return cached;
  }
  if (inFlight.has(key)) {
    return inFlight.get(key);
  }
  const task = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), opts.timeoutMs || 30000);
    try {
      const params = { text, voice, format, speed, endpoint };
      const buffer = mode === "apikey"
        ? await synthesizeApiKey(settings, params, controller.signal)
        : await synthesizeClassic(settings, params, controller.signal);
      const audio = { buffer, contentType: audioType(format) };
      cacheSet(key, audio);
      return audio;
    } catch (error) {
      if (error && error.name === "AbortError") {
        throw new Error("豆包语音合成超时，请检查网络和接口地址。");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  })();
  inFlight.set(key, task);
  try {
    return await task;
  } finally {
    inFlight.delete(key);
  }
}

function clearCache() {
  cache.clear();
  inFlight.clear();
}

module.exports = { synthesize, clearCache, normalizeEndpoint, authModeFor };
