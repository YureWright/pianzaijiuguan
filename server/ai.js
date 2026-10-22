"use strict";

const DEFAULT_BASE_URLS = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta"
};

const FALLBACK_LINES = {
  play: [
    "我先把牌放下，信不信由你。",
    "别盯着我的手，盯着我的眼睛。",
    "这一手，我觉得很稳。",
    "轮到你了，敢不敢跟？",
    "酒馆里最不缺的就是胆子。",
    "我只说一次：这是真的。"
  ],
  challenge: [
    "等等，我不信。",
    "你的手在抖。亮牌。",
    "这故事讲得太顺了。",
    "我不买账，开牌。",
    "你刚才眨眼了。"
  ]
};

function pick(items, rng) {
  const random = typeof rng === "function" ? rng : Math.random;
  return items[Math.floor(random() * items.length)];
}

function trimUrl(url) {
  return String(url || "").trim().replace(/\/+$/, "");
}

function endpointFor(profile) {
  const provider = profile.provider || "openai";
  const base = trimUrl(profile.baseUrl || DEFAULT_BASE_URLS[provider] || DEFAULT_BASE_URLS.openai);
  if (provider === "openai") {
    if (/\/chat\/completions$/.test(base)) {
      return base;
    }
    return base + "/chat/completions";
  }
  if (provider === "anthropic") {
    if (/\/messages$/.test(base)) {
      return base;
    }
    return base + "/messages";
  }
  if (provider === "gemini") {
    const model = encodeURIComponent(profile.model);
    if (base.indexOf("{model}") >= 0) {
      return base.replace("{model}", model) + (base.indexOf(":generateContent") >= 0 ? "" : ":generateContent");
    }
    if (base.indexOf(":generateContent") >= 0) {
      return base;
    }
    return base + "/models/" + model + ":generateContent";
  }
  throw new Error("不支持的模型供应商。");
}

function buildPrompt(context) {
  const legal = context.phase === "out_challenge" || context.hand.length === 0
    ? "强制质疑窗口：只能 challenge（质疑）上一次出牌，不能 play（出牌），也不能 pass（放过）。"
    : "你可以 challenge（质疑上一次出牌）或 play（打出 1 到 3 张手牌）。";
  const hand = context.hand.map((card) => {
    if (card.wild) {
      return "万能牌" + (card.label || "") + " [" + card.id + "]";
    }
    return card.rank + card.suit + " [" + card.id + "]";
  }).join("，");
  const lastPlay = context.lastPlay
    ? context.lastPlay.playerName + " 宣称打出 " + context.lastPlay.count + " 张 " + context.lastPlay.claimRank
    : "暂无";
  const system = [
    "你在中文社交推理牌局《骗子酒馆》中扮演 " + context.name + "。",
    "你的性格是：" + context.style + "。",
    "牌组共 20 张：J、Q、K 各 6 张，加大小王两张万能牌。每轮桌面公开一个 J/Q/K 点数。",
    "这是 Liars Bar 核心规则：玩家每回合扣下 1 到 3 张牌，并宣称它们都是桌面点数。大小王可以当作任意点数，因此含王的亮牌永远算真。",
    "玩家可以质疑上一位玩家。质疑后亮出上一位玩家的牌；如果对方撒谎，对方玩俄罗斯轮盘，否则质疑者玩。",
    "牌局不会因为枪响重开，也不会在质疑后重新发牌。手牌打空不等于淘汰。",
    "存活人数大于 2 时，空手玩家自动跳过；只剩 2 人时，空手玩家若面对上一位的出牌必须质疑，若上一位刚质疑完则跳过。",
    "全场只剩最后一名持牌者、且上一手来自其他玩家时，他不能出牌，必须质疑。没有任何“放过”操作。",
    "你可以撒谎、虚张声势、观察公开信息，但绝不能编造你看不到的牌。",
    "你必须利用记忆中的历史质疑、亮牌结果和对手倾向来更新判断，不要每轮从零开始。",
    "先在心里完成推理。reasoning 只写一句简短判断依据，不会展示给其他玩家。",
    "speech 是你当场说给所有人听的公开喊话：要挑衅、自信、拉拢或转移注意力，让其他人相信你；不能暴露自己的手牌或真实推理。",
    "monologue 是你的私人想法，只会在牌局结束后展示；可以分析自己的手牌、概率和真实计划。",
    "你的目标是在不中弹的情况下让其他玩家出局。",
    "只输出一个 JSON 对象，不要 Markdown，不要解释 JSON 之外的内容。"
  ].join("\n");
  const adminPrompt = context.systemPrompt
    ? "\n管理员为这个角色设定的额外提示词：\n" + String(context.systemPrompt).slice(0, 4000)
    : "";
  const tactical = context.tactical || {};
  const memory = context.memory || {};
  const beliefText = (memory.beliefs || []).map((item) => {
    return item.name + "：声明" + item.claims + "，真" + item.truths + "，假" + item.lies +
      "，质疑" + item.challenges + "（正确" + item.correctChallenges + "/错误" + item.wrongChallenges + "）";
  }).join("；");
  const user = [
    "第 " + context.round + " 轮。桌面公开点数：" + context.tableRank + "。存活人数：" + context.aliveCount + "。",
    "你的手牌：" + hand + "。",
    "上一位玩家的声明：" + lastPlay + "。",
    "其他存活玩家：" + context.alivePlayers.map((item) => item.name + "(" + item.handCount + "张)").join("，") + "。",
    "最近事件：" + context.recentLog.join(" / "),
    "最近发言：" + context.recentChat.join(" / "),
    "战术估算：你手里有 " + (tactical.matchingRank || 0) + " 张桌面点数牌、" +
      (tactical.jokers || 0) + " 张万能牌；上一位声明属实的粗略概率为 " +
      (tactical.claimProbability == null ? "未知" : tactical.claimProbability) + "。",
    "长期记忆：" + ((memory.episodes || []).join(" / ") || "暂无"),
    "对手倾向：" + (beliefText || "暂无足够数据"),
    "你上一轮内部判断：" + (memory.lastThought || "暂无"),
    legal,
    "输出格式：{\"action\":\"play|challenge\",\"cardIds\":[\"选择的手牌id\"],\"speech\":\"面向所有人的挑衅式公开喊话，1到2句\",\"monologue\":\"不超过90字的私人想法，牌局结束后才展示\",\"reasoning\":\"一句内部判断，不超过60字\",\"confidence\":0.0}。",
    "如果 action 是 challenge，cardIds 必须为空数组；如果 action 是 play，必须给出 1 到 3 个真实存在的手牌 id。",
    "confidence 是 0 到 1 之间的数字，表示你对本次决策的把握。",
    "请做出最有利于自己存活的选择。"
  ].join("\n");
  return { system: system + adminPrompt, user };
}

function extractContent(data, provider) {
  if (provider === "anthropic") {
    if (Array.isArray(data.content)) {
      return data.content.map((part) => part.text || "").join("").trim();
    }
    return "";
  }
  if (provider === "gemini") {
    const candidate = data.candidates && data.candidates[0];
    const parts = candidate && candidate.content && candidate.content.parts;
    return Array.isArray(parts) ? parts.map((part) => part.text || "").join("").trim() : "";
  }
  const message = data.choices && data.choices[0] && data.choices[0].message;
  if (!message) {
    return "";
  }
  if (typeof message.content === "string") {
    return message.content.trim();
  }
  if (Array.isArray(message.content)) {
    return message.content.map((part) => part.text || "").join("").trim();
  }
  return "";
}

function parseModelJson(text) {
  let clean = String(text || "").trim();
  const fenced = clean.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    clean = fenced[1].trim();
  }
  const first = clean.indexOf("{");
  const last = clean.lastIndexOf("}");
  if (first < 0 || last <= first) {
    throw new Error("模型没有返回 JSON。");
  }
  return JSON.parse(clean.slice(first, last + 1));
}

function normalizeDecision(raw, context) {
  const action = String(raw && raw.action ? raw.action : "").toLowerCase();
  const speech = String(raw && raw.speech ? raw.speech : "").replace(/\s+/g, " ").trim().slice(0, 40);
  const cardIds = Array.isArray(raw && raw.cardIds) ? raw.cardIds.map(String) : [];
  const monologue = String(raw && raw.monologue ? raw.monologue : "").replace(/\s+/g, " ").trim().slice(0, 160);
  const reasoning = String(raw && raw.reasoning ? raw.reasoning : "").replace(/\s+/g, " ").trim().slice(0, 120);
  const confidenceValue = Number(raw && raw.confidence);
  const confidence = Number.isFinite(confidenceValue) ? Math.max(0, Math.min(1, confidenceValue)) : 0.5;
  const handIds = new Set(context.hand.map((card) => card.id));
  if (context.phase === "out_challenge") {
    if (action !== "challenge") {
      throw new Error("模型在质疑窗口返回了非法操作。");
    }
    return { action, cardIds: [], speech, monologue, reasoning, confidence };
  }
  if (action === "pass") {
    throw new Error("牌局中不存在放过操作。");
  }
  if (action === "challenge") {
    if (!context.lastPlay) {
      throw new Error("没有可质疑的出牌。");
    }
    return { action, cardIds: [], speech, monologue, reasoning, confidence };
  }
  if (action === "play") {
    if (context.hand.length === 0) {
      throw new Error("手牌已空，只能质疑。");
    }
    if (cardIds.length < 1 || cardIds.length > 3) {
      throw new Error("模型选择的牌数不合法。");
    }
    const unique = Array.from(new Set(cardIds));
    if (unique.some((id) => !handIds.has(id))) {
      throw new Error("模型选择了不存在的手牌。");
    }
    return { action, cardIds: unique, speech, monologue, reasoning, confidence };
  }
  throw new Error("模型返回了未知操作。");
}

async function callOpenAI(profile, prompt, signal) {
  const headers = { "Content-Type": "application/json" };
  if (profile.apiKey) {
    headers.Authorization = "Bearer " + profile.apiKey;
  }
  const response = await fetch(endpointFor(profile), {
    method: "POST",
    headers,
    signal,
    body: JSON.stringify({
      model: profile.model,
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user }
      ],
      temperature: 0.8
    })
  });
  if (!response.ok) {
    throw await providerError("OpenAI 兼容接口", response);
  }
  return extractContent(await response.json(), "openai");
}

async function callAnthropic(profile, prompt, signal) {
  const headers = {
    "Content-Type": "application/json",
    "anthropic-version": "2023-06-01"
  };
  if (profile.apiKey) {
    headers["x-api-key"] = profile.apiKey;
  }
  const response = await fetch(endpointFor(profile), {
    method: "POST",
    headers,
    signal,
    body: JSON.stringify({
      model: profile.model,
      max_tokens: 400,
      temperature: 0.8,
      system: prompt.system,
      messages: [{ role: "user", content: prompt.user }]
    })
  });
  if (!response.ok) {
    throw await providerError("Anthropic 接口", response);
  }
  return extractContent(await response.json(), "anthropic");
}

async function callGemini(profile, prompt, signal) {
  const endpoint = endpointFor(profile) + (endpointFor(profile).indexOf("?") >= 0 ? "&" : "?") +
    "key=" + encodeURIComponent(profile.apiKey || "");
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: prompt.system }] },
      contents: [{ role: "user", parts: [{ text: prompt.user }] }],
      generationConfig: { temperature: 0.8, maxOutputTokens: 400 }
    })
  });
  if (!response.ok) {
    throw await providerError("Gemini 接口", response);
  }
  return extractContent(await response.json(), "gemini");
}

async function providerError(label, response) {
  let detail = "";
  try {
    detail = (await response.text()).replace(/\s+/g, " ").trim().slice(0, 240);
  } catch (error) {
    detail = "";
  }
  return new Error(label + "返回 " + response.status + (detail ? "：" + detail : ""));
}

async function testConnection(profile, options) {
  const opts = options || {};
  const prompt = {
    system: "你是 API 连通性测试助手。只回复 OK，不要输出其他内容。",
    user: "请只回复 OK。"
  };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs || 20000);
  const startedAt = Date.now();
  try {
    let text;
    if (profile.provider === "anthropic") {
      text = await callAnthropic(profile, prompt, controller.signal);
    } else if (profile.provider === "gemini") {
      text = await callGemini(profile, prompt, controller.signal);
    } else {
      text = await callOpenAI(profile, prompt, controller.signal);
    }
    const responseText = String(text || "").replace(/\s+/g, " ").trim().slice(0, 160);
    if (!responseText) {
      throw new Error("接口已连通，但模型返回了空内容。");
    }
    return {
      ok: true,
      latencyMs: Date.now() - startedAt,
      endpoint: endpointFor(profile),
      provider: profile.provider || "openai",
      model: profile.model,
      response: responseText
    };
  } catch (error) {
    if (error && error.name === "AbortError") {
      throw new Error("连接超时，请检查接口 URL、网络或代理设置。");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function decideWithModel(profile, context, options) {
  const opts = options || {};
  const prompt = buildPrompt(context);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs || 15000);
  try {
    let text;
    if (profile.provider === "anthropic") {
      text = await callAnthropic(profile, prompt, controller.signal);
    } else if (profile.provider === "gemini") {
      text = await callGemini(profile, prompt, controller.signal);
    } else {
      text = await callOpenAI(profile, prompt, controller.signal);
    }
    const raw = parseModelJson(text);
    const decision = normalizeDecision(raw, context);
    decision.speech = decision.speech || buildPublicSpeech(context, decision, opts.rng);
    decision.monologue = decision.monologue || buildLocalMonologue(context, decision);
    decision.source = "model";
    return decision;
  } finally {
    clearTimeout(timeout);
  }
}

function challengeChance(context, rng) {
  const random = typeof rng === "function" ? rng : Math.random;
  if (!context.lastPlay) {
    return 0;
  }
  const claim = context.lastPlay.count;
  const ownMatches = context.hand.filter((card) => card.wild || card.rank === context.tableRank).length;
  const tactical = context.tactical || {};
  const probability = typeof tactical.claimProbability === "number" ? tactical.claimProbability : null;
  let chance = probability == null ? 0.24 : 0.08 + (1 - probability) * 0.55;
  chance += Math.max(0, claim - 1) * 0.07;
  if (ownMatches === 0) {
    chance += claim >= 2 ? 0.18 : 0.06;
  }
  if (ownMatches >= 2) {
    chance -= 0.08;
  }
  if (context.hand.length <= 2) {
    chance += 0.05;
  }
  const memory = context.memory || {};
  const belief = (memory.beliefs || []).find((item) => item.name === context.lastPlay.playerName);
  if (belief) {
    const claims = Math.max(1, belief.claims);
    chance += (belief.lies / claims) * 0.18;
    chance -= (belief.truths / claims) * 0.1;
    chance += (belief.correctChallenges / Math.max(1, belief.challenges)) * 0.04;
  }
  chance += (random() - 0.5) * 0.08;
  return Math.max(0.03, Math.min(0.72, chance));
}

function choosePlayCards(context, rng) {
  const random = typeof rng === "function" ? rng : Math.random;
  const matches = context.hand.filter((card) => !card.wild && card.rank === context.tableRank);
  const jokers = context.hand.filter((card) => card.wild);
  if (matches.length > 0) {
    let count = 1;
    if (matches.length >= 2 && random() < 0.42) {
      count = 2;
    }
    if (matches.length >= 3 && random() < 0.16) {
      count = 3;
    }
    return matches.slice(0, count).map((card) => card.id);
  }
  if (jokers.length > 0 && random() < 0.72) {
    return [jokers[0].id];
  }
  const order = { K: 13, Q: 12, J: 11 };
  const sorted = context.hand.filter((card) => !card.wild).sort((left, right) => (order[left.rank] || 0) - (order[right.rank] || 0));
  const count = sorted.length > 3 && random() < 0.14 ? 2 : 1;
  return sorted.slice(0, count).map((card) => card.id);
}

function buildLocalMonologue(context, decision) {
  const tactical = context.tactical || {};
  const matching = tactical.matchingRank || 0;
  const jokers = tactical.jokers || 0;
  const rank = context.tableRank || "桌面点数";
  const belief = context.memory && Array.isArray(context.memory.beliefs)
    ? context.memory.beliefs.find((item) => context.lastPlay && item.name === context.lastPlay.playerName)
    : null;
  if (decision.action === "challenge") {
    const count = context.lastPlay ? context.lastPlay.count : 0;
    const suspicion = belief && belief.lies > 0
      ? "我记得他之前就撒过谎。"
      : "这个数量和我手里的牌对不上。";
    return "他敢说有 " + count + " 张 " + rank + "……我手里只有 " + matching +
      " 张真牌和 " + jokers + " 张万能牌。" + suspicion + "这一次，我要拆开看看。";
  }
  const count = Array.isArray(decision.cardIds) ? decision.cardIds.length : 1;
  if (matching + jokers > 0) {
    return "我手里有 " + matching + " 张 " + rank + " 和 " + jokers +
      " 张万能牌。" + (count > matching ? "加一张王，听起来仍然合理。" : "先扣 " + count + " 张，看看谁敢接。");
  }
  return "手里没有 " + rank + "，但牌桌从来不是靠诚实赢的。扣 " + count + " 张，赌他们不敢质疑。";
}

function buildPublicSpeech(context, decision, rng) {
  const rank = context.tableRank || "桌面点数";
  const count = Array.isArray(decision.cardIds) ? decision.cardIds.length : 1;
  if (decision.action === "challenge") {
    const target = context.lastPlay ? context.lastPlay.playerName : "你";
    return pick([
      "诸位，你们真信 " + target + "？我把话放这，这一手有问题。",
      target + "，你刚才太急了。大家最好站远一点，别被一起带下水。",
      "这桌的戏该换主角了。" + target + "，你敢让大家看看吗？"
    ], rng);
  }
  return pick([
    "诸位，看好这一手。信我的人，今晚都能分一杯。",
    "别急着质疑。你们越犹豫，我越确定这桌该由我来收。",
    "我出 " + count + " 张 " + rank + "。敢跟的跟，不敢跟的坐着看。",
    "这一轮我很有把握。你们要是不信，尽管来试。",
    "牌桌就是这样：胆子小的看戏，胆子大的赢钱。"
  ], rng);
}

function finalizeLocalDecision(context, decision) {
  decision.speech = buildPublicSpeech(context, decision);
  decision.monologue = decision.monologue || buildLocalMonologue(context, decision);
  return decision;
}

function localDecision(context, rng) {
  const random = typeof rng === "function" ? rng : Math.random;
  const chance = challengeChance(context, random);
  if (context.phase === "out_challenge" || context.hand.length === 0) {
    return finalizeLocalDecision(context, {
      action: "challenge",
      cardIds: [],
      speech: pick(FALLBACK_LINES.challenge, random),
      reasoning: "当前是强制质疑窗口，只能质疑上一位玩家。",
      confidence: 1,
      source: "local"
    });
  }
  if (context.lastPlay && random() < chance) {
    return finalizeLocalDecision(context, {
      action: "challenge",
      cardIds: [],
      speech: pick(FALLBACK_LINES.challenge, random),
      reasoning: "根据桌面点数、手牌和对手历史，这次声明可疑。",
      confidence: chance,
      source: "local"
    });
  }
  return finalizeLocalDecision(context, {
    action: "play",
    cardIds: choosePlayCards(context, random),
    speech: pick(FALLBACK_LINES.play, random),
    reasoning: "优先消耗真实点数牌，必要时用万能牌或小牌施压。",
    confidence: 1 - chance,
    source: "local"
  });
}

module.exports = {
  DEFAULT_BASE_URLS,
  buildPrompt,
  parseModelJson,
  normalizeDecision,
  decideWithModel,
  testConnection,
  localDecision,
  buildLocalMonologue
};
