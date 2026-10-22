"use strict";
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");

async function startServer() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "liars-bar-qa-"));
  const keys = Object.fromEntries(["admin", "shanghai", "hangzhou"].map(name => [name, crypto.randomBytes(24).toString("base64url")]));
  const child = spawn(process.execPath, ["server/index.js"], {
    cwd: path.resolve(__dirname, ".."), windowsHide: true,
    env: { ...process.env, HOST: "127.0.0.1", PORT: "0", DATA_DIR: dataDir,
      ADMIN_PASSWORD: keys.admin, SHANGHAI_LOGIN_KEY: keys.shanghai, HANGZHOU_LOGIN_KEY: keys.hangzhou },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  const base = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error("QA server failed to start")); }, 8000);
    child.stdout.on("data", chunk => {
      output += chunk.toString();
      const match = output.match(/running at (http:\/\/127\.0\.0\.1:\d+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("exit", code => { clearTimeout(timer); if (!output.includes("running at")) reject(new Error("QA server exited: " + code)); });
  });
  return {
    base, keys, dataDir,
    async stop() {
      if (child.exitCode !== null) return;
      await new Promise(resolve => { child.once("exit", resolve); child.kill(); });
    }
  };
}
async function post(base, endpoint, body) {
  const response = await fetch(base + endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}
async function sseState(base, params) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(base + "/api/rooms/MAIN/events?" + new URLSearchParams(params), { signal: controller.signal });
    if (!response.ok) return { status: response.status };
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let text = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) throw new Error("No state event");
      text += decoder.decode(value, { stream: true });
      const match = text.match(/event: state\ndata: ([^\n]+)\n/);
      if (match) return { status: response.status, body: JSON.parse(match[1]) };
    }
  } finally { clearTimeout(timeout); controller.abort(); }
}
module.exports = { startServer, post, sseState };
