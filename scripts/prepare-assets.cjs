"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium } = require("playwright");

// Re-encode source art for delivery; source originals are retained separately.
async function main() {
  const root = path.resolve(__dirname, "..");
  const source = process.argv[2];
  const prop = process.argv[3] === "revolver";
  if (!source) throw new Error("Pass the generated tavern PNG as the first argument.");
  const backup = path.join(root, ".qa", "art-sources");
  await fs.mkdir(backup, { recursive: true });
  await fs.copyFile(source, path.join(backup, prop ? "revolver.png" : "tavern.png"));
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage();
    const assets = prop ? [[source, "assets/revolver.webp", 768, 0.9]] : [
      [source, "assets/tavern.webp", 1536, 0.87],
      [path.join(root, "public/assets/textures/walnut.jpg"), "assets/textures/walnut.webp", 768, 0.86],
      [path.join(root, "public/assets/textures/weave.jpg"), "assets/textures/weave.webp", 512, 0.8]
    ];
    for (const [input, output, maxWidth, quality] of assets) {
      const buffer = await fs.readFile(input);
      const mime = input.endsWith(".png") ? "image/png" : "image/jpeg";
      const result = await page.evaluate(async ({ data, maxWidth, quality }) => {
        const img = new Image();
        img.src = data;
        await img.decode();
        const canvas = document.createElement("canvas");
        const ratio = Math.min(1, maxWidth / img.naturalWidth);
        canvas.width = Math.round(img.naturalWidth * ratio);
        canvas.height = Math.round(img.naturalHeight * ratio);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        return { url: canvas.toDataURL("image/webp", quality), width: canvas.width, height: canvas.height };
      }, { data: "data:" + mime + ";base64," + buffer.toString("base64"), maxWidth, quality });
      const encoded = Buffer.from(result.url.split(",")[1], "base64");
      await fs.writeFile(path.join(root, "public", output), encoded);
      console.log(output + ": " + result.width + "x" + result.height + ", " + encoded.length + " bytes");
    }
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
