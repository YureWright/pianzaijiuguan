"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const { startServer } = require("./qa-server.cjs");
const root = path.resolve(__dirname, "..");
const emptyHandOnly = process.argv.includes("--empty-hand");
const output = path.join(root, "test-results", emptyHandOnly ? "empty-hand" : "acceptance");
const report = { startedAt: new Date().toISOString(), browser: "Chrome / Playwright", uses: "Real browser UI and a real local Node server; no intercepted game responses or modified game clocks.", checks: {}, rounds: [], errors: [], assets: [] };
let browser;
let server;
const pages = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function saveReport() { await fs.writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2)); }
async function capture(page, name, fullPage = false) { await page.screenshot({ path: path.join(output, name + ".png"), fullPage }); }
async function createPage(contextOptions = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, recordVideo: { dir: path.join(output, "videos"), size: { width: 1280, height: 800 } }, ...contextOptions });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  page.on("pageerror", error => report.errors.push(error.message));
  page.on("response", response => {
    if (response.status() >= 400 && !response.url().includes("/events?")) report.errors.push("HTTP " + response.status() + " " + response.url().split("?")[0]);
  });
  pages.push(page);
  return page;
}
async function login(page, location, username) {
  await page.goto(server.base);
  await page.locator("#model-summary-text").filter({ hasText: "6" }).waitFor();
  await page.selectOption("#login-location", location);
  await page.fill("#login-key", server.keys[location]);
  await page.locator("#login-form button[type=submit]").click();
  await page.fill("#username-input", username);
  await page.locator("#username-form button[type=submit]").click();
  await page.waitForFunction(() => app.room && app.connected, null, { timeout: 5000 });
}
async function configure(page, motion, narration) {
  await page.locator("#experience-button").click();
  await page.selectOption("#motion-select", motion);
  await page.selectOption("#narration-select", narration);
  await page.locator('[data-close-dialog="experience-dialog"]').last().click();
}
async function inspectAssets(page) {
  const files = [];
  async function walk(directory) {
    for (const file of await fs.readdir(directory, { withFileTypes: true })) {
      const full = path.join(directory, file.name);
      if (file.isDirectory()) await walk(full);
      else if (/\.(svg|png|jpe?g|webp)$/i.test(file.name)) files.push("/" + path.relative(path.join(root, "public"), full).replaceAll("\\", "/"));
    }
  }
  await walk(path.join(root, "public", "assets"));
  await walk(path.join(root, "public", "portraits"));
  files.push("/favicon.svg");
  report.assets = await page.evaluate(async files => Promise.all(files.map(async url => {
    const response = await fetch(url);
    const image = new Image(); image.src = url;
    try { await image.decode(); return { url, status: response.status, width: image.naturalWidth, height: image.naturalHeight, ok: response.ok && image.naturalWidth > 0 }; }
    catch (_) { return { url, status: response.status, ok: false }; }
  })), files);
  assert.ok(report.assets.every(asset => asset.ok), "Every local art asset must load and decode");
  report.checks.assetCount = report.assets.length;
  report.checks.propAlpha = await page.evaluate(async () => {
    const image = new Image(); image.src = "/assets/revolver.webp"; await image.decode();
    const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext("2d"); context.drawImage(image, 0, 0);
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let transparent = 0; let maximumAlpha = 0;
    for (let index = 3; index < data.length; index += 4) { if (!data[index]) transparent++; maximumAlpha = Math.max(maximumAlpha, data[index]); }
    return { transparentPixels: transparent, maximumAlpha, totalPixels: data.length / 4, cornerAlpha: data[3] };
  });
  assert.ok(report.checks.propAlpha.transparentPixels > report.checks.propAlpha.totalPixels * .2 && report.checks.propAlpha.maximumAlpha >= 250 && report.checks.propAlpha.cornerAlpha === 0);
}
async function geometry(page, name) {
  const result = await page.evaluate(() => {
    const action = document.getElementById("action-bar").getBoundingClientRect();
    const hand = document.getElementById("hand-row").getBoundingClientRect();
    return { width: innerWidth, height: innerHeight, documentWidth: document.documentElement.scrollWidth, actionTop: action.top, actionBottom: action.bottom, handTop: hand.top, handBottom: hand.bottom };
  });
  report.checks[name] = result;
  assert.ok(result.documentWidth <= result.width + 1, name + ": no horizontal overflow");
  assert.ok(result.actionTop >= 0 && result.actionBottom <= result.height + 1, name + ": controls stay visible");
  assert.ok(result.handTop >= 0 && result.handBottom <= result.height + 1, name + ": hand stays visible");
}
async function selectionCheck(page) {
  const card = page.locator("[data-card-id]").first();
  const original = await card.elementHandle();
  await card.click();
  await page.keyboard.press("2");
  assert.equal(await page.evaluate(() => app.selected.size), 2);
  assert.ok(await original.evaluate(element => element.isConnected), "Selecting a second card must retain the first DOM node");
  await page.keyboard.press("3");
  await page.keyboard.press("4");
  assert.equal(await page.evaluate(() => app.selected.size), 3, "Maximum selection is three");
  await page.keyboard.press("Escape");
  assert.equal(await page.evaluate(() => app.selected.size), 0);
  await page.locator("#sort-hand").click();
  assert.ok(await original.evaluate(element => element.isConnected), "Sorting retains card nodes");
  await page.keyboard.press("1");
  await capture(page, "desktop-selected");
  await page.locator("#clear-selection").click();
  report.checks.selection = { retainedNodes: true, shortcuts: true, maxThree: true, sort: true };
}
async function state(page) {
  return page.evaluate(() => ({ phase: app.room.phase, turn: app.room.turnPlayerId, me: app.room.me && { id: app.room.me.id, alive: app.room.me.alive, hand: app.room.me.hand.map(card => ({ id: card.id, rank: card.rank, wild: card.wild })) }, rank: app.room.tableRank, legal: app.room.legal, lastPlay: app.room.lastPlay, reveal: app.room.lastReveal, fx: app.fxAnimating, connected: app.connected, queue: app.animationQueue.length, gate: app.room.turnGateReason, speech: Boolean(app.room.pendingSpeech), voice: app.voiceMetrics, speaking: app.speaking }));
}
async function playRound(clients, name) {
  const round = { name, startedAt: new Date().toISOString(), actions: [], reveals: [], emptyHandObserved: false, refreshAfterDeath: false };
  report.rounds.push(round);
  const host = await Promise.all(clients.map(page => page.evaluate(() => ({ start: app.room.canStart, restart: app.room.canRestart }))));
  const hostIndex = host.findIndex(value => value.start || value.restart);
  assert.ok(hostIndex >= 0, "A player can start the next game");
  await clients[hostIndex].locator(host[hostIndex].start ? "[data-action=start]" : "[data-action=restart]").click();
  await clients[0].waitForFunction(() => ["playing", "out_challenge"].includes(app.room.phase), null, { timeout: 5000 });
  await geometry(clients[0], name + "-desktop");
  if (clients[1]) await geometry(clients[1], name + "-mobile");
  if (name === "full") {
    await selectionCheck(clients[0]);
    await capture(clients[0], "desktop-table");
    await capture(clients[1], "mobile-table");
  }
  const started = Date.now();
  let lastReveal = null;
  let capturedReveal = false;
  let capturedExecution = false;
  let refreshed = false;
  let playerTurns = 0;
  for (let tick = 0; Date.now() - started < 240000; tick++) {
    const first = await state(clients[0]);
    round.lastState = { elapsedMs: Date.now() - started, phase: first.phase, gate: first.gate, fx: first.fx, queue: first.queue, speech: first.speech, speaking: first.speaking, voice: first.voice };
    if (first.reveal && first.reveal.id !== lastReveal) {
      lastReveal = first.reveal.id;
      round.reveals.push({ truthful: first.reveal.truthful, shot: first.reveal.shot, elapsedMs: Date.now() - started });
    }
    if (!capturedReveal && await clients[0].locator(".table-reveal-inline").isVisible().catch(() => false)) {
      await delay(650);
      await capture(clients[0], name + "-reveal");
      capturedReveal = true;
    }
    if (!capturedExecution && await clients[0].locator("#table-fx.active.fx-execution").isVisible().catch(() => false)) {
      await delay(name === "full" ? 2300 : 150);
      await capture(clients[0], name + "-execution");
      capturedExecution = true;
    }
    if (first.phase === "gameover") {
      round.winner = await clients[0].evaluate(() => app.room.winnerName);
      round.durationMs = Date.now() - started;
      round.voice = await Promise.all(clients.map(page => page.evaluate(() => app.voiceMetrics)));
      for (const [index, page] of clients.entries()) {
        await page.waitForFunction(() => document.getElementById("victory-dialog").open, null, { timeout: 20000 });
        await capture(page, name + "-settlement-" + index);
        assert.equal(await page.evaluate(() => app.fxAnimating || app.animationQueue.length > 0), false, "Settlement follows the cinematic");
      }
      round.settlement = true;
      await saveReport();
      return;
    }
    for (const [index, page] of clients.entries()) {
      const current = index === 0 ? first : await state(page);
      if (current.me && current.me.alive && current.me.hand.length === 0) round.emptyHandObserved = true;
      if (!refreshed && current.me && !current.me.alive && current.phase !== "gameover") {
        const oldId = current.me.id;
        await page.reload();
        await page.waitForFunction(() => app.room && app.connected, null, { timeout: 5000 });
        assert.equal(await page.evaluate(() => document.getElementById("username-dialog").open), false, "A dead player can refresh and keep watching");
        assert.equal(await page.evaluate(() => app.room.me.id), oldId);
        round.refreshAfterDeath = true;
        refreshed = true;
        continue;
      }
      if (!current.me?.alive || !current.connected || current.fx || current.gate || current.speech || current.queue || current.turn !== current.me.id) continue;
      const challenge = page.locator("[data-action=challenge]");
      const play = page.locator("[data-action=play]");
      const shouldChallenge = current.phase === "out_challenge" || (!name.startsWith("empty-hand") && current.legal.challenge && (playerTurns % 3 !== 0 || current.me.hand.length === 0));
      if (shouldChallenge && await challenge.isVisible() && await challenge.isEnabled()) {
        await challenge.click();
        round.actions.push({ type: "challenge", player: index, elapsedMs: Date.now() - started });
        playerTurns++;
      } else if (current.legal.play && await play.isVisible()) {
        if (await page.locator("#clear-selection").isEnabled()) await page.locator("#clear-selection").click();
        const matching = current.me.hand.filter(card => card.wild || card.rank === current.rank);
        const chosen = name.startsWith("empty-hand") ? current.me.hand.slice(0, 3) : (matching.length ? matching : current.me.hand).slice(0, playerTurns % 2 ? 2 : 1);
        for (const card of chosen) await page.locator('[data-card-id="' + card.id + '"]').click();
        if (await play.isEnabled()) {
          if (index === 0) await page.keyboard.press("Enter"); else await play.click();
          round.actions.push({ type: "play", player: index, count: chosen.length, elapsedMs: Date.now() - started });
          playerTurns++;
        }
      }
    }
    if (tick % 15 === 0) await saveReport();
    await delay(170);
  }
  throw new Error(name + ": game did not settle within four minutes");
}
async function finishRound(clients, suffix) {
  for (const [index, page] of clients.entries()) {
    if (await page.locator("#victory-dialog").evaluate(element => element.open)) await page.locator("#victory-continue").click();
    await delay(400);
    if (await page.locator("#username-dialog").evaluate(element => element.open)) {
      await page.fill("#username-input", "再战" + index + suffix);
      await page.locator("#username-form button[type=submit]").click();
      await page.waitForFunction(() => !document.getElementById("username-dialog").open, null, { timeout: 5000 });
    }
  }
}
async function main() {
  await fs.mkdir(output, { recursive: true });
  const chrome = process.env.BROWSER_PATH || ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"].find(file => fsSync.existsSync(file));
  browser = await chromium.launch({ ...(chrome ? { executablePath: chrome } : {}), headless: true, args: ["--autoplay-policy=no-user-gesture-required", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
  server = await startServer();
  const desktop = await createPage();
  await desktop.goto(server.base);
  await capture(desktop, "home-desktop");
  await inspectAssets(desktop);
  await login(desktop, "shanghai", "上海验收");
  const mobile = await createPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await mobile.goto(server.base);
  await capture(mobile, "home-mobile", true);
  await login(mobile, "hangzhou", "杭州验收");
  await desktop.waitForFunction(() => app.room.humanCount === 2, null, { timeout: 5000 });
  await desktop.locator("[data-lineup-select]").first().selectOption({ label: "Kimi" });
  await desktop.waitForFunction(() => app.room.aiLineup[0].name === "Kimi", null, { timeout: 5000 });
  await desktop.fill("#chat-input", "今晚，听起来越真的越要小心。");
  await desktop.locator("#chat-form button").click();
  await mobile.locator("#feed-list").filter({ hasText: "今晚，听起来越真的越要小心。" }).waitFor();
  report.checks.chat = true;
  await desktop.locator("#camera-toggle").click();
  await mobile.locator("#camera-toggle").click();
  await desktop.waitForFunction(() => document.getElementById("remote-video").videoWidth > 0 && app.pc?.connectionState === "connected", null, { timeout: 15000 });
  report.checks.video = await desktop.evaluate(() => ({ localWidth: document.getElementById("local-video").videoWidth, remoteWidth: document.getElementById("remote-video").videoWidth, connection: app.pc.connectionState, device: "Chromium synthetic camera; actual WebRTC P2P video frames" }));
  await desktop.locator("#camera-size-toggle").click();
  assert.equal(await desktop.locator("#camera-size-toggle").getAttribute("aria-expanded"), "true");
  await capture(desktop, "video-p2p");
  await desktop.locator("#camera-size-toggle").click();
  await desktop.locator("#camera-toggle").click();
  await mobile.locator("#camera-toggle").click();
  await desktop.waitForFunction(() => document.getElementById("camera-dock").hidden, null, { timeout: 5000 });
  await mobile.waitForFunction(() => document.getElementById("camera-dock").hidden, null, { timeout: 5000 });
  report.checks.video.closeClearsBothViews = true;
  await capture(desktop, "lobby-desktop");
  await capture(mobile, "lobby-mobile");
  const oldId = await desktop.evaluate(() => app.playerId);
  await desktop.context().setOffline(true);
  await desktop.locator("#connection-banner").waitFor({ state: "visible" });
  await delay(1500);
  await desktop.context().setOffline(false);
  await desktop.waitForFunction(() => app.connected && document.getElementById("connection-banner").hidden, null, { timeout: 10000 });
  assert.equal(await desktop.evaluate(() => app.playerId), oldId);
  report.checks.reconnect = { restoredSeat: true, keptTableVisible: true };
  if (emptyHandOnly) {
    await configure(desktop, "reduced", "off");
    await configure(mobile, "reduced", "off");
    for (let attempt = 1; attempt <= 3; attempt++) {
      await playRound([desktop, mobile], "empty-hand-" + attempt);
      await finishRound([desktop, mobile], "空" + attempt);
      if (report.rounds.at(-1).emptyHandObserved) break;
    }
    assert.ok(report.rounds.some(round => round.emptyHandObserved), "A live human must play their hand empty during a complete UI game");
    assert.equal(report.errors.length, 0);
    report.passed = true;
    report.completedAt = new Date().toISOString();
    console.log("Empty-hand browser playthrough passed.");
    return;
  }
  console.log("Assets, login, lobby, chat, P2P video and reconnect passed; playing full-motion round.");
  await playRound([desktop, mobile], "full");
  await finishRound([desktop, mobile], "甲");
  await desktop.locator("#leaderboard-button").click();
  for (const tab of ["deception", "kills", "streak", "ai"]) {
    await desktop.locator('[data-board="' + tab + '"]').click();
    await desktop.locator(".board-row").first().waitFor();
  }
  await capture(desktop, "leaderboard");
  await desktop.locator('[data-close-dialog="leaderboard-dialog"]').click();
  report.checks.leaderboard = true;
  await configure(desktop, "reduced", "off");
  await configure(mobile, "reduced", "off");
  await desktop.setViewportSize({ width: 1280, height: 720 });
  console.log("Full-motion round and settlement passed; playing reduced-motion rematch.");
  await playRound([desktop, mobile], "reduced-rematch");
  await finishRound([desktop, mobile], "乙");
  report.checks.rematch = true;
  report.checks.preferences = await desktop.evaluate(() => ({ ...TavernExperience.preferences, voice: app.voiceEnabled }));
  const admin = await createPage({ viewport: { width: 1366, height: 900 }, recordVideo: undefined });
  await admin.goto(server.base + "/admin.html");
  await admin.fill("#admin-password", server.keys.admin);
  await admin.locator("#login-form button[type=submit]").click();
  await admin.locator(".admin-role-card").first().waitFor();
  assert.equal(await admin.locator(".admin-role-card").count(), 6);
  await admin.locator("#add-role-button").click();
  await admin.fill("#role-name", "验收角色");
  await admin.fill("#role-model", "local-qa");
  await admin.fill("#role-prompt", "保持冷静，简洁发言。");
  await admin.locator("#save-role").click();
  await admin.waitForFunction(() => document.querySelectorAll(".admin-role-card").length === 7, null, { timeout: 5000 });
  report.checks.admin = { login: true, portraits: 6, createRole: true };
  await capture(admin, "admin-roles", true);
  assert.equal(report.errors.length, 0, "No browser exceptions or unexpected HTTP failures");
  report.passed = true;
  report.completedAt = new Date().toISOString();
  console.log("Acceptance passed: " + report.assets.length + " art assets; two complete UI playthroughs; desktop and mobile.");
}
main().catch(async error => {
  report.passed = false;
  report.failure = error.message;
  for (const [index, page] of pages.entries()) await capture(page, "failure-" + index, true).catch(() => {});
  console.error(error.stack);
  process.exitCode = 1;
}).finally(async () => {
  await saveReport().catch(() => {});
  if (browser) await browser.close();
  if (server) await server.stop();
});
