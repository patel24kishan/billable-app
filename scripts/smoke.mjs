// `npm run smoke`: launches the real Electron app with BILLABLE_SMOKE=1 and a
// temporary userData folder, waits for "SMOKE OK", and cleans up.
// Usage: node scripts/smoke.mjs [path-to-app-executable]
//   default: the electron binary from node_modules running this project ("electron .").
//   Exit codes: 0 ok, 1 a check failed, 2 hard timeout, 3 load failure / crash,
//   4 userData folder refused by the app (BILLABLE_USER_DATA_DIR not inside the temp folder), 5 launcher error.
// EXPECTED stderr noise: the smoke deliberately sends bad save requests, so Electron prints
// "Error occurred in handler for 'billable:save-file': Error: Invalid save request ..." stack traces.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HARD_TIMEOUT_MS = 60_000;
const exe = process.argv[2];

let command, args;
if (exe) {
  command = path.resolve(exe);
  args = [];
} else {
  command = createRequire(import.meta.url)('electron'); // path to the electron binary
  args = [root];
}
if (!exe && !fs.existsSync(path.join(root, 'dist', 'index.html'))) {
  console.error('SMOKE FAIL: dist/index.html missing (run the build first)');
  process.exit(5);
}

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'billable-smoke-'));
const env = { ...process.env, BILLABLE_SMOKE: '1', BILLABLE_USER_DATA_DIR: userData };
delete env.ELECTRON_RUN_AS_NODE;
delete env.BILLABLE_DEV_URL;

console.log('smoke: ' + command + ' ' + args.join(' '));
console.log('smoke: temporary userData ' + userData);
console.log('smoke: note - "Error occurred in handler for \'billable:save-file\' ... Invalid save request" stack traces on stderr are EXPECTED (deliberate bad requests).');
const child = spawn(command, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: false });
let out = '';
child.stdout.on('data', (d) => { out += d; process.stdout.write(d); });
child.stderr.on('data', (d) => { out += d; process.stderr.write(d); });

let timedOut = false;
const timer = setTimeout(() => {
  timedOut = true;
  console.error('SMOKE FAIL: launcher hard timeout after ' + HARD_TIMEOUT_MS / 1000 + ' s');
  child.kill();
}, HARD_TIMEOUT_MS + 5_000); // main has its own 60 s timeout; this is the backstop

function cleanup() {
  try { fs.rmSync(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
  catch (err) { console.error('smoke: could not remove ' + userData + ': ' + err.message); }
}

child.on('error', (err) => {
  clearTimeout(timer);
  console.error('SMOKE FAIL: could not start ' + command + ': ' + err.message);
  cleanup();
  process.exit(5);
});
child.on('exit', (code, signal) => {
  clearTimeout(timer);
  // Give Chromium a moment to release files in the profile before deleting it.
  setTimeout(() => {
    cleanup();
    const ok = code === 0 && /^SMOKE OK$/m.test(out);
    if (ok) process.exit(0);
    if (timedOut) process.exit(2);
    if (code === 4) console.error('SMOKE FAIL: the app refused the userData folder (exit 4): BILLABLE_USER_DATA_DIR must be inside the temp folder');
    console.error('smoke: app exited with ' + (code !== null ? 'code ' + code : 'signal ' + signal));
    process.exit(code && code > 0 ? code : 1);
  }, 500);
});
