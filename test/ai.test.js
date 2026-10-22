"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const ai = require("../server/ai");

function readBody(request) {
  return new Promise((resolve) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

function listen(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function context() {
  return {
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
    recentChat: [],
    systemPrompt: "CUSTOM_ADMIN_PROMPT_123",
    tactical: { matchingRank: 1, jokers: 0, claimProbability: 0.25 },
    memory: { episodes: ["上一轮对手撒过一次谎。"], beliefs: [], lastThought: "" }
  };
}

test("admin system prompts and memories are merged into model prompts", () => {
  const prompt = ai.buildPrompt(context());
  assert.equal(prompt.system.includes("CUSTOM_ADMIN_PROMPT_123"), true);
  assert.equal(prompt.user.includes("上一轮对手撒过一次谎"), true);
  assert.equal(prompt.system.includes("speech 不超过 40 字"), true);
});

test("model adapters support OpenAI-compatible, Anthropic and Gemini payloads", async () => {
  const seen = [];
  const server = await listen(async (request, response) => {
    const body = await readBody(request);
    seen.push({
      url: request.url,
      authorization: request.headers.authorization || null,
      anthropicKey: request.headers["x-api-key"] || null,
      body: JSON.parse(body || "{}")
    });
    response.writeHead(200, { "Content-Type": "application/json" });
    if (request.url.includes("/chat/completions")) {
      response.end(JSON.stringify({
        choices: [{ message: { content: "{\"action\":\"play\",\"cardIds\":[\"A-S\"],\"speech\":\"放下。\"}" } }]
      }));
      return;
    }
    if (request.url.includes("/messages")) {
      response.end(JSON.stringify({
        content: [{ text: "{\"action\":\"challenge\",\"cardIds\":[],\"speech\":\"我不信。\"}" }]
      }));
      return;
    }
    response.end(JSON.stringify({
      candidates: [{ content: { parts: [{ text: "```json\n{\"action\":\"play\",\"cardIds\":[\"3-H\"],\"speech\":\"轮到你了。\"}\n```" }] } }]
    }));
  });
  const port = server.address().port;
  try {
    const openai = await ai.decideWithModel({
      provider: "openai",
      baseUrl: "http://127.0.0.1:" + port + "/v1",
      model: "mock-openai",
      apiKey: "openai-key"
    }, context());
    assert.equal(openai.action, "play");
    assert.deepEqual(openai.cardIds, ["A-S"]);
    assert.equal(openai.source, "model");

    const anthropicContext = context();
    anthropicContext.lastPlay = { playerName: "对手", count: 2, claimRank: "A" };
    const anthropic = await ai.decideWithModel({
      provider: "anthropic",
      baseUrl: "http://127.0.0.1:" + port + "/v1",
      model: "mock-claude",
      apiKey: "anthropic-key"
    }, anthropicContext);
    assert.equal(anthropic.action, "challenge");

    const gemini = await ai.decideWithModel({
      provider: "gemini",
      baseUrl: "http://127.0.0.1:" + port + "/v1beta",
      model: "mock-gemini",
      apiKey: "gemini-key"
    }, context());
    assert.equal(gemini.action, "play");
    assert.deepEqual(gemini.cardIds, ["3-H"]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  assert.equal(seen.some((entry) => entry.authorization === "Bearer openai-key"), true);
  assert.equal(seen.some((entry) => entry.anthropicKey === "anthropic-key"), true);
  assert.equal(seen.some((entry) => entry.url.includes("key=gemini-key")), true);
});

test("ark doubao requests disable deep thinking for low-latency game decisions", async () => {
  const originalFetch = global.fetch;
  let captured = null;
  global.fetch = async (url, options) => {
    captured = { url: String(url), body: JSON.parse(options.body) };
    return new Response(JSON.stringify({ choices: [{ message: { content: "OK" } }] }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  try {
    const result = await ai.testConnection({
      provider: "openai",
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      model: "doubao-seed-test",
      apiKey: "test-key"
    }, { timeoutMs: 5000 });
    assert.equal(result.response, "OK");
    assert.equal(captured.body.thinking.type, "disabled");
    assert.equal(Object.prototype.hasOwnProperty.call(captured.body, "max_tokens"), false);
  } finally {
    global.fetch = originalFetch;
  }
});

test("model JSON parsing accepts fenced output and rejects illegal cards", () => {
  const parsed = ai.parseModelJson("```json\n{\"action\":\"play\",\"cardIds\":[\"A-S\"]}\n```");
  assert.equal(parsed.action, "play");
  assert.throws(() => {
    ai.normalizeDecision({ action: "play", cardIds: ["Z-Z"] }, context());
  });
  assert.throws(() => {
    ai.normalizeDecision({ action: "pass", cardIds: [] }, context());
  });
});

test("admin connection test reports latency, reply and API errors", async () => {
  const server = await listen(async (request, response) => {
    if (request.url.includes("/bad/chat/completions")) {
      response.writeHead(401, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: { message: "invalid api key" } }));
      return;
    }
    await readBody(request);
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ choices: [{ message: { content: "OK" } }] }));
  });
  const port = server.address().port;
  try {
    const result = await ai.testConnection({
      provider: "openai",
      baseUrl: "http://127.0.0.1:" + port + "/v1",
      model: "mock-model",
      apiKey: "test-key"
    });
    assert.equal(result.ok, true);
    assert.equal(result.response, "OK");
    assert.equal(result.model, "mock-model");
    assert.equal(result.latencyMs >= 0, true);
    await assert.rejects(
      ai.testConnection({
        provider: "openai",
        baseUrl: "http://127.0.0.1:" + port + "/bad",
        model: "mock-model",
        apiKey: "bad-key"
      }),
      /401.*invalid api key/
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("local AI handles the empty-hand challenge window", () => {
  const value = context();
  value.phase = "out_challenge";
  value.lastPlay = { playerName: "对手", count: 3, claimRank: "A" };
  const decision = ai.localDecision(value, () => 0.1);
  assert.equal(decision.action, "challenge");
  assert.deepEqual(decision.cardIds, []);
  assert.equal(Boolean(decision.monologue), true);
  assert.equal(Boolean(decision.speech), true);
  assert.notEqual(decision.speech, decision.monologue);
});
