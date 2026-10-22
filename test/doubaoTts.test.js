"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const doubaoTts = require("../server/doubaoTts");

const settings = {
  endpoint: "https://openspeech.bytedance.com/api/v1/tts",
  appId: "test-app-id",
  accessToken: "test-access-token",
  cluster: "volcano_tts",
  voiceType: "BV001_streaming",
  speed: 1,
  format: "mp3"
};

test("doubao classic tts sends app credentials and decodes base64 audio", async () => {
  const originalFetch = global.fetch;
  let captured = null;
  doubaoTts.clearCache();
  global.fetch = async (url, options) => {
    captured = { url: String(url), options };
    return new Response(JSON.stringify({
      code: 3000,
      message: "Success",
      data: Buffer.from("doubao-classic-audio").toString("base64")
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  try {
    const audio = await doubaoTts.synthesize(settings, {
      text: "今晚由我来坐庄。",
      voice: "BV001_streaming"
    });
    assert.equal(captured.url, "https://openspeech.bytedance.com/api/v1/tts");
    assert.equal(captured.options.headers.Authorization, "Bearer;test-access-token");
    const body = JSON.parse(captured.options.body);
    assert.equal(body.app.appid, "test-app-id");
    assert.equal(body.app.token, "test-access-token");
    assert.equal(body.app.cluster, "volcano_tts");
    assert.equal(body.audio.voice_type, "BV001_streaming");
    assert.equal(body.audio.encoding, "mp3");
    assert.equal(body.request.text, "今晚由我来坐庄。");
    assert.equal(body.request.operation, "query");
    assert.equal(body.request.text_type, "plain");
    assert.equal(audio.contentType, "audio/mpeg");
    assert.equal(audio.buffer.toString(), "doubao-classic-audio");
  } finally {
    global.fetch = originalFetch;
    doubaoTts.clearCache();
  }
});

test("doubao classic tts surfaces API error codes", async () => {
  const originalFetch = global.fetch;
  doubaoTts.clearCache();
  global.fetch = async () => new Response(JSON.stringify({
    code: 3001,
    message: "Missing required: app.appid"
  }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
  try {
    await assert.rejects(
      doubaoTts.synthesize(settings, { text: "测试", voice: "BV001_streaming" }),
      /3001.*Missing required/
    );
  } finally {
    global.fetch = originalFetch;
    doubaoTts.clearCache();
  }
});

test("doubao api-key mode sends v3 headers and merges NDJSON audio chunks", async () => {
  const originalFetch = global.fetch;
  let captured = null;
  doubaoTts.clearCache();
  global.fetch = async (url, options) => {
    captured = { url: String(url), options };
    return new Response([
      JSON.stringify({ code: 0, data: Buffer.from("first-").toString("base64") }),
      JSON.stringify({ code: 0, data: Buffer.from("second").toString("base64") }),
      JSON.stringify({ code: 20000000, message: "OK" })
    ].join("\n"), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  try {
    const audio = await doubaoTts.synthesize({
      authMode: "apikey",
      endpoint: "https://openspeech.bytedance.com/api/v3/tts/unidirectional",
      apiKey: "api-key-test",
      resourceId: "seed-tts-2.0",
      voiceType: "zh_female_vv_uranus_bigtts",
      speed: 1,
      format: "mp3"
    }, { text: "新版豆包测试", voice: "zh_female_vv_uranus_bigtts" });
    assert.equal(captured.url, "https://openspeech.bytedance.com/api/v3/tts/unidirectional");
    assert.equal(captured.options.headers["X-Api-Key"], "api-key-test");
    assert.equal(captured.options.headers["X-Api-Resource-Id"], "seed-tts-2.0");
    assert.equal(Boolean(captured.options.headers["X-Api-Request-Id"]), true);
    const body = JSON.parse(captured.options.body);
    assert.equal(body.req_params.text, "新版豆包测试");
    assert.equal(body.req_params.speaker, "zh_female_vv_uranus_bigtts");
    assert.equal(body.req_params.audio_params.format, "mp3");
    assert.equal(audio.buffer.toString(), "first-second");
  } finally {
    global.fetch = originalFetch;
    doubaoTts.clearCache();
  }
});

test("doubao api-key mode reports missing resource grants", async () => {
  const originalFetch = global.fetch;
  doubaoTts.clearCache();
  global.fetch = async () => new Response(JSON.stringify({
    header: { code: 45000030, message: "[resource_id=seed-tts-2.0] requested resource not granted" }
  }), {
    status: 403,
    headers: { "content-type": "application/json" }
  });
  try {
    await assert.rejects(
      doubaoTts.synthesize({
        authMode: "apikey",
        endpoint: "https://openspeech.bytedance.com/api/v3/tts/unidirectional",
        apiKey: "api-key-test",
        resourceId: "seed-tts-2.0",
        speed: 1,
        format: "mp3"
      }, { text: "测试", voice: "zh_female_vv_uranus_bigtts" }),
      /403.*45000030.*not granted/
    );
  } finally {
    global.fetch = originalFetch;
    doubaoTts.clearCache();
  }
});

test("doubao api-key mode rejects non-ASCII header credentials", async () => {
  await assert.rejects(
    doubaoTts.synthesize({
      authMode: "apikey",
      endpoint: "https://openspeech.bytedance.com/api/v3/tts/unidirectional",
      apiKey: "试听失败：related resource",
      resourceId: "seed-tts-2.0",
      speed: 1,
      format: "mp3"
    }, { text: "测试", voice: "zh_female_vv_uranus_bigtts" }),
    /中文或空格/
  );
});
