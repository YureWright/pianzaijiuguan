"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const tts = require("../server/tts");

const settings = {
  baseUrl: "https://dashscope.aliyuncs.com/api/v1",
  model: "qwen3-tts-flash",
  apiKey: "sk-test-key",
  defaultVoice: "Cherry",
  speed: 1,
  format: "mp3"
};

test("qwen tts uses the DashScope native synthesis endpoint", () => {
  assert.equal(
    tts.endpointFor(settings),
    "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation"
  );
  assert.equal(
    tts.endpointFor({ baseUrl: "https://example.com/audio/speech" }),
    "https://example.com/audio/speech"
  );
  assert.equal(
    tts.endpointFor({ baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1" }),
    "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation"
  );
});

test("qwen tts sends the expected payload and returns binary audio", async () => {
  const originalFetch = global.fetch;
  let captured = null;
  tts.clearCache();
  global.fetch = async (url, options) => {
    captured = { url: String(url), options };
    return new Response(Buffer.from("ID3-qwen-audio"), {
      status: 200,
      headers: { "content-type": "audio/mpeg" }
    });
  };
  try {
    const audio = await tts.synthesize(settings, { text: "  今晚  没人值得相信。 ", voice: "Ethan" });
    assert.equal(captured.url, "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation");
    assert.equal(captured.options.headers.Authorization, "Bearer sk-test-key");
    const body = JSON.parse(captured.options.body);
    assert.equal(body.model, "qwen3-tts-flash");
    assert.equal(body.input.text, "今晚 没人值得相信。");
    assert.equal(body.input.voice, "Ethan");
    assert.equal(body.input.language_type, "Chinese");
    assert.equal(audio.contentType, "audio/mpeg");
    assert.equal(audio.buffer.toString(), "ID3-qwen-audio");
  } finally {
    global.fetch = originalFetch;
    tts.clearCache();
  }
});

test("qwen tts keeps OpenAI speech payloads for custom compatible endpoints", () => {
  const body = tts.requestPayloadFor({
    model: "openai-tts",
    baseUrl: "https://example.com/v1/audio/speech"
  }, {
    text: "测试",
    voice: "alloy",
    format: "mp3",
    speed: 1.2
  });
  assert.equal(body.input, "测试");
  assert.equal(body.voice, "alloy");
  assert.equal(body.response_format, "mp3");
  assert.equal(body.speed, 1.2);
});

test("qwen tts can download an audio URL returned as JSON", async () => {
  const originalFetch = global.fetch;
  let calls = 0;
  tts.clearCache();
  global.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return new Response(JSON.stringify({
        output: { audio: { url: "https://cdn.example.com/voice.mp3" } }
      }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    return new Response(Buffer.from("remote-audio"), {
      status: 200,
      headers: { "content-type": "audio/mpeg" }
    });
  };
  try {
    const audio = await tts.synthesize(settings, { text: "抓到谎言，质疑成功。" });
    assert.equal(calls, 2);
    assert.equal(audio.buffer.toString(), "remote-audio");
  } finally {
    global.fetch = originalFetch;
    tts.clearCache();
  }
});
