"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "../public/app.js"), "utf8").replace(/initialize\(\);\s*$/, "");
function client() {
  const timers = [];
  const revoked = [];
  const audio = [];
  const context = vm.createContext({
    window: { TavernExperience: { preferences: { narration: "key" } } },
    document: { getElementById: () => null },
    AbortController, console,
    URL: { createObjectURL: () => "blob:voice", revokeObjectURL: url => revoked.push(url) },
    setTimeout: (fn, ms) => { const timer = { fn, ms }; timers.push(timer); return timer; },
    clearTimeout: timer => { if (timer) timer.cleared = true; },
    Audio: function () { this.play = () => new Promise(() => {}); this.pause = () => {}; audio.push(this); }
  });
  vm.runInContext(source + "\nglobalThis.state = app;", context);
  vm.runInContext("setBackgroundMusicDucked = () => {}; maybeShowVictorySettlement = () => {};", context);
  Object.assign(context.state, { roomCode: "MAIN", playerId: "player", playerToken: "token", ttsConfig: { enabled: true } });
  return { context, app: context.state, timers, revoked, audio, run: code => vm.runInContext(code, context) };
}
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
const voiceResponse = () => ({ ok: true, headers: { get: () => "audio/wav" }, blob: async () => ({ size: 12 }) });

test("playback reuses a prefetch that is still in flight", async () => {
  const c = client();
  let resolve;
  let calls = 0;
  c.context.fetch = () => { calls++; return new Promise(done => { resolve = done; }); };
  c.run('prefetchVoice({ text: "hello", voice: "Ethan", roleId: "" }); speak("hello");');
  resolve(voiceResponse());
  await flush();
  assert.equal(calls, 1);
  assert.equal(c.audio.length, 1);
  assert.deepEqual(c.revoked, []);
});

test("a stalled audio start falls back once and a late media event cannot restart it", async () => {
  const c = client();
  c.context.fetch = async () => voiceResponse();
  let fallbackCount = 0;
  c.context.playBrowserVoice = () => { fallbackCount++; };
  c.run('speak("hello");');
  await flush();
  const start = c.timers.find(timer => timer.ms === 2500);
  assert.ok(start);
  const mediaError = c.audio[0].onerror;
  start.fn();
  mediaError();
  assert.equal(fallbackCount, 1);
  assert.equal(c.app.voiceMetrics.fallbacks, 1);
  c.timers.find(timer => timer.ms === 18000).fn();
  assert.equal(c.app.speaking, false);
  assert.equal(c.app.voiceMetrics.completed, 1);
});

test("voice reset aborts synthesis requests and cancels the previous playback watchdog", async () => {
  const c = client();
  let signal;
  c.context.fetch = (_url, options) => {
    signal = options.signal;
    return new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new Error("aborted"))));
  };
  c.run('speak("hello"); resetVoiceRuntime();');
  await flush();
  assert.equal(signal.aborted, true);
  assert.equal(c.app.speaking, false);
  assert.equal(c.app.voiceRequests.size, 0);
  assert.equal(c.timers.find(timer => timer.ms === 18000).cleared, true);
});

test("pending speech has a hard deadline even if the speech engine stays busy", () => {
  const c = client();
  let acknowledged;
  c.context.acknowledgeSpeech = id => { acknowledged = id; };
  c.context.speak = () => { c.app.speaking = true; };
  c.run('handlePendingSpeech({ pendingSpeech: { id: "speech-1", text: "hello", playerName: "AI" } });');
  c.timers.find(timer => timer.ms === 25000).fn();
  assert.equal(acknowledged, "speech-1");
  assert.equal(c.app.speaking, false);
  assert.equal(c.timers.some(timer => timer.ms === 15000), false);
});

test("a synthesis timeout aborts the request and starts browser fallback", async () => {
  const c = client();
  let signal;
  let fallbacks = 0;
  c.context.fetch = (_url, options) => {
    signal = options.signal;
    return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("timeout"))));
  };
  c.context.playBrowserVoice = () => { fallbacks++; };
  c.run('speak("hello");');
  c.timers.find(timer => timer.ms === 10000).fn();
  await flush();
  assert.equal(signal.aborted, true);
  assert.equal(fallbacks, 1);
  assert.equal(c.app.voiceRequests.size, 0);
});

test("next game stays unavailable until settlement and account refresh finish", async () => {
  const c = client();
  const bar = { innerHTML: "" };
  const dialog = { open: true, close() { this.open = false; } };
  c.context.document.getElementById = id => id === "action-bar" ? bar : dialog;
  c.context.window.TavernExperience.render = (element, html) => { element.innerHTML = html; };
  c.context.clearInterval = () => {};
  Object.assign(c.app, { connected: true, sessionToken: "test", room: { phase: "gameover", canRestart: true }, victoryShowKey: "game-1" });
  c.run('renderActionBar(app.room);');
  assert.ok(!bar.innerHTML.includes('data-action="restart"'));
  let finishRefresh;
  c.context.refreshAccount = () => new Promise(resolve => { finishRefresh = resolve; });
  const finished = c.run('finishVictorySettlement();');
  assert.equal(dialog.open, false);
  c.timers.find(timer => timer.ms === 260).fn();
  await flush();
  c.run('renderActionBar(app.room);');
  assert.ok(!bar.innerHTML.includes('data-action="restart"'));
  finishRefresh({ pendingRename: false });
  await finished;
  assert.ok(bar.innerHTML.includes('data-action="restart"'));
  c.app.account = { pendingRename: true };
  c.run('renderActionBar(app.room);');
  assert.ok(!bar.innerHTML.includes('data-action="restart"'));
  assert.ok(bar.innerHTML.includes("更换用户名"));
});

test("cancelling a consumed prefetch cannot start a replacement synthesis request", async () => {
  const c = client();
  let calls = 0;
  c.context.fetch = (_url, options) => {
    calls++;
    return new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new Error("aborted"))));
  };
  c.run('prefetchVoice({ text: "hello", voice: "Ethan", roleId: "" }); speak("hello"); resetVoiceRuntime();');
  await flush();
  assert.equal(calls, 1);
  assert.equal(c.app.voiceRequests.size, 0);
});
