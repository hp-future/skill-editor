/**
 * Drive the running demo page in headless Chrome and evaluate expressions.
 *
 *   node scripts/drive-page.mjs http://127.0.0.1:5183 scripts/cdp/*.cdp
 *
 * Each `.cdp` file is JSON Lines: one `{"expression": "..."}` per line (extra
 * CDP fields are passed through). Results are printed as JSON. This exists so
 * interactive behaviour (keyboard navigation, drag & drop) can be verified
 * without adding a browser-automation dependency.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [url, ...scriptFiles] = process.argv.slice(2);
if (!url || scriptFiles.length === 0) {
  console.error('usage: node scripts/drive-page.mjs <url> <script.cdp> [...]');
  process.exit(2);
}

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];
const chromePath = process.env.CHROME_PATH ?? CHROME_CANDIDATES.find(existsSync);
if (!chromePath) {
  console.error('No Chrome/Edge binary found; set CHROME_PATH.');
  process.exit(2);
}

const commands = [];
for (const file of scriptFiles) {
  for (const line of (await readFile(file, 'utf8')).split('\n')) {
    const trimmed = line.trim();
    if (trimmed) commands.push(JSON.parse(trimmed));
  }
}

const profile = await mkdtemp(join(tmpdir(), 'skill-editor-cdp-'));
const port = 9222 + Math.floor(Math.random() * 400);
const chrome = spawn(
  chromePath,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--window-size=1280,860',
    url,
  ],
  { stdio: 'ignore' },
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function findTarget() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      const page = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      // Chrome is still starting up.
    }
    await sleep(250);
  }
  throw new Error('Chrome DevTools endpoint never became available.');
}

let socket;
let nextId = 1;
const pending = new Map();

function send(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

try {
  const wsUrl = await findTarget();
  socket = new WebSocket(wsUrl);
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
    else entry.resolve(message.result);
  });
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', () => reject(new Error('WebSocket error')), { once: true });
  });

  await send('Runtime.enable');
  // Let the app finish its initial load.
  await sleep(1500);

  for (const [index, command] of commands.entries()) {
    const { label, waitMs, screenshotPath, ...rest } = command;
    const params = { awaitPromise: true, returnByValue: true, ...rest };
    const result = await send(command.method ?? 'Runtime.evaluate', params);
    const heading = `#${index + 1} ${label ?? command.method ?? ''}`;

    if (screenshotPath) {
      await writeFile(screenshotPath, Buffer.from(result.data, 'base64'));
      console.log(`${heading}: wrote ${screenshotPath}`);
    } else if (result.exceptionDetails) {
      console.log(`${heading} EXCEPTION`);
      console.log(
        JSON.stringify(
          result.exceptionDetails.exception?.description ?? result.exceptionDetails,
          null,
          2,
        ),
      );
    } else {
      console.log(heading);
      console.log(JSON.stringify(result.result?.value ?? result.result, null, 2));
    }
    if (waitMs) await sleep(waitMs);
  }
} finally {
  socket?.close();
  chrome.kill();
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
