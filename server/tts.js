"use strict";

const crypto = require("node:crypto");

const CACHE_LIMIT = 120;
const cache = new Map();
const inFlight = new Map();
const MAX_CONCURRENT = 1;
let activeRequests = 0;
const requestQueue = [];

function acquireRequestSlot() {
  return new Promise((resolve) => {
    const grant = () => {
      activeRequests += 1;
      resolve();
    };
    if (activeRequests < MAX_CONCURRENT) {
      grant();
    } else {
      requestQueue.push(grant);
    }
  });
}

function releaseRequestSlot() {
  activeRequests = Math.max(0, activeRequests - 1);
  const next = requestQueue.shift();
  if (next) {
    next();
  }
}

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

function endpointFor(settings) {
  let base = String(settings.baseUrl || "").trim().replace(/\/+$/, "");
  if (!base) {
    throw new Error("TTS 接口 URL 未配置。");
  }
  if (/\/audio\/speech$/i.test(base) ||
      /\/services\/aigc\/multimodal-generation\/generation$/i.test(base) ||
      /\/services\/audio\/tts\/SpeechSynthesizer$/i.test(base)) {
    return base;
  }
  base = base.replace(/\/compatible-mode\/v1$/i, "/api/v1");
  if (/\/api\/v1$/i.test(base)) {
    return base + "/services/aigc/multimodal-generation/generation";
  }
  return base + "/services/aigc/multimodal-generation/generation";
}

function requestPayloadFor(settings, options) {
  const opts = options || {};
  const endpoint = endpointFor(settings);
  const nativeDashScope = /multimodal-generation|\/SpeechSynthesizer$/i.test(endpoint);
  if (nativeDashScope) {
    return {
      model: settings.model || "qwen3-tts-flash",
      input: {
        text: opts.text,
        voice: opts.voice,
        language_type: "Chinese"
      }
    };
  }
  return {
    model: settings.model || "qwen3-tts-flash",
    input: opts.text,
    voice: opts.voice,
    response_format: opts.format || "mp3",
    speed: opts.speed || 1
  };
}

function audioType(format) {
  const value = String(format || "mp3").toLowerCase();
  if (value === "wav") return "audio/wav";
  if (value === "opus") return "audio/ogg";
  if (value === "aac") return "audio/aac";
  if (value === "flac") return "audio/flac";
  return "audio/mpeg";
}

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) {
    return null;
  }
  cache.delete(key);
  cache.set(key, entry);
  return entry;
}

function cacheSet(key, value) {
  cache.set(key, value);
  while (cache.size > CACHE_LIMIT) {
    cache.delete(cache.keys().next().value);
  }
}

function findAudioPayload(value) {
  if (!value) {
    return null;
  }
  if (typeof value === "string") {
    const text = value.trim();
    if (/^https?:\/\//i.test(text)) {
      return { url: text };
    }
    if (/^data:audio\//i.test(text)) {
      return { dataUrl: text };
    }
    if (/^[A-Za-z0-9+/=]{300,}$/.test(text)) {
      return { base64: text };
    }
    return null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findAudioPayload(item);
      if (found) return found;
    }
    return null;
  }
  if (typeof value === "object") {
    for (const key of ["url", "audio_url", "audioUrl", "data", "base64", "audio", "output", "result"]) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        const found = findAudioPayload(value[key]);
        if (found) return found;
      }
    }
    for (const item of Object.values(value)) {
      const found = findAudioPayload(item);
      if (found) return found;
    }
  }
  return null;
}

async function decodeResponse(response, format) {
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  if (contentType.startsWith("audio/") || contentType.includes("application/octet-stream")) {
    return {
      buffer: Buffer.from(await response.arrayBuffer()),
      contentType: contentType.startsWith("audio/") ? contentType : audioType(format)
    };
  }
  const payload = await response.json();
  const found = findAudioPayload(payload);
  if (!found) {
    throw new Error("TTS 接口没有返回音频数据。");
  }
  if (found.dataUrl) {
    const match = found.dataUrl.match(/^data:(audio\/[^;]+);base64,(.*)$/i);
    if (!match) {
      throw new Error("TTS 返回的音频格式无法识别。");
    }
    return { buffer: Buffer.from(match[2], "base64"), contentType: match[1] };
  }
  if (found.base64) {
    return { buffer: Buffer.from(found.base64, "base64"), contentType: audioType(format) };
  }
  if (found.url) {
    const audioResponse = await fetchWithRetry(found.url, {});
    if (!audioResponse.ok) {
      throw new Error("TTS 音频下载失败。");
    }
    return {
      buffer: Buffer.from(await audioResponse.arrayBuffer()),
      contentType: audioResponse.headers.get("content-type") || audioType(format)
    };
  }
  throw new Error("TTS 返回的音频格式无法识别。");
}

async function synthesize(settings, options) {
  const opts = options || {};
  const text = String(opts.text || "").replace(/\s+/g, " ").trim().slice(0, 500);
  const voice = String(opts.voice || settings.defaultVoice || "Cherry").trim().slice(0, 60);
  if (!text) {
    throw new Error("TTS 文本不能为空。");
  }
  if (!settings.apiKey) {
    throw new Error("TTS API Key 未配置。");
  }
  const format = settings.format || "mp3";
  const speed = Math.max(0.5, Math.min(2, Number(settings.speed) || 1));
  const key = crypto.createHash("sha256")
    .update([endpointFor(settings), settings.model, voice, String(speed), format, text].join("\n"))
    .digest("hex");
  const cached = cacheGet(key);
  if (cached) {
    return cached;
  }
  if (inFlight.has(key)) {
    return inFlight.get(key);
  }
  const task = (async () => {
    await acquireRequestSlot();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), opts.timeoutMs || 30000);
    try {
      const endpoint = endpointFor(settings);
      const response = await fetchWithRetry(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + settings.apiKey
        },
        signal: controller.signal,
        body: JSON.stringify(requestPayloadFor(settings, { text, voice, format, speed }))
      });
      if (!response.ok) {
        let detail = "";
        try {
          detail = (await response.text()).slice(0, 300);
        } catch (error) {
          detail = "";
        }
        throw new Error("TTS 接口返回 " + response.status + "（" + endpoint + "）" + (detail ? "：" + detail : ""));
      }
      const result = await decodeResponse(response, format);
      cacheSet(key, result);
      return result;
    } finally {
      clearTimeout(timeout);
      releaseRequestSlot();
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

module.exports = { synthesize, clearCache, endpointFor, requestPayloadFor };
