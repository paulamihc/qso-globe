// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Paul Friend
// Renders one seamless full turn of the globe to an animated GIF (and a still PNG),
// for pages such as QRZ.com bios that allow images but not scripts.
//
// Usage: node scripts/render-gif.mjs [--size 360x405] [--frames 100] [--delay 250] [--colours 40] [--out out/qso-globe.gif]
// Needs Google Chrome installed (it drives it headless), and site/ built and holding contacts.json.
import { chromium } from 'playwright-core';
import gifenc from 'gifenc';
import { PNG } from 'pngjs';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { extname, join, dirname } from 'node:path';

const { GIFEncoder, quantize, applyPalette } = gifenc;
const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
};
const [W, H] = arg('size', '360x405').split('x').map(Number);
const FRAMES = +arg('frames', 100);
const DELAY = +arg('delay', 250);
const OUT = arg('out', 'out/qso-globe.gif');
const COLOUR = arg('colour', 'band');
const COLOURS = Math.min(255, +arg('colours', 40));

// Serve site/ on a private port for the headless browser.
const root = new URL('../site/', import.meta.url).pathname;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  let p = new URL(req.url, 'http://x').pathname;
  if (p.endsWith('/')) p += 'index.html';
  let body;
  try { body = await readFile(join(root, p)); } catch { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': types[extname(p)] || 'application/octet-stream' });
  res.end(body);
}).listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const port = server.address().port;

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
await page.goto(`http://127.0.0.1:${port}/?render=1&colour=${COLOUR}`);
await page.waitForFunction(() => document.documentElement.dataset.ready === '1');

console.log(`Rendering ${FRAMES} frames at ${W}×${H}…`);
const frames = [];
for (let i = 0; i < FRAMES; i++) {
  await page.evaluate(([i, n]) => window.renderFrame(i, n), [i, FRAMES]);
  const png = PNG.sync.read(await page.screenshot({ type: 'png' }));
  frames.push(png.data);
  if (i === 0) {
    await mkdir(dirname(OUT), { recursive: true });
    await writeFile(OUT.replace(/\.gif$/, '.png'), PNG.sync.write(png));
  }
}
await browser.close();
server.close();

// One palette for the whole animation (no flicker), built from a spread of frames.
const sampleIdx = Array.from({ length: 10 }, (_, k) => Math.floor((k * FRAMES) / 10));
const sample = new Uint8Array(sampleIdx.length * W * H * 4);
sampleIdx.forEach((f, k) => sample.set(frames[f], k * W * H * 4));
const colours = quantize(sample, COLOURS);
while (colours.length < 255) colours.push([0, 0, 0]);
const TRANSPARENT = 255;
const palette = [...colours, [0, 0, 0]];

// Pixels that do not change from the previous frame are written as transparent, which keeps the file small.
const gif = GIFEncoder();
let prev = null;
for (let i = 0; i < FRAMES; i++) {
  const index = applyPalette(frames[i], colours);
  let out = index;
  if (prev) {
    out = new Uint8Array(index);
    for (let p = 0; p < out.length; p++) if (index[p] === prev[p]) out[p] = TRANSPARENT;
  }
  gif.writeFrame(out, W, H, {
    palette, delay: DELAY, dispose: 1, repeat: 0,
    ...(prev ? { transparent: true, transparentIndex: TRANSPARENT } : {}),
  });
  prev = index;
}
gif.finish();
const bytes = gif.bytes();
await writeFile(OUT, bytes);
console.log(`Wrote ${OUT} (${(bytes.length / 1024 / 1024).toFixed(2)} MB, one turn every ${((FRAMES * DELAY) / 1000).toFixed(1)} s) and ${OUT.replace(/\.gif$/, '.png')}`);
