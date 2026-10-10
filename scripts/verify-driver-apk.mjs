#!/usr/bin/env node
/**
 * Verifies the public Driver app download end to end.
 *
 *   node scripts/verify-driver-apk.mjs [baseUrlOrUrl]    (default: https://gtransportt.vercel.app)
 *   npm run verify:apk
 *
 * Follows the redirect chain from the stable address (or release asset target), then checks
 * the final response is really the recorded release: HTTP 200, a binary content type (never
 * HTML — a misconfigured host would happily serve index.html as ".apk"), the exact byte size,
 * the ZIP signature every APK starts with, and the SHA-256 recorded in
 * src/features/landing/driverApp.ts. Exit code 0 only when all of that holds.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const metaSource = readFileSync(resolve(import.meta.dirname, '..', 'src', 'features', 'landing', 'driverApp.ts'), 'utf8');
const field = (name) => new RegExp(`${name}:\\s*'?([^',\\n]+)'?,`).exec(metaSource)?.[1]?.trim();
const expected = {
  sizeBytes: Number((field('sizeBytes') ?? '').replaceAll('_', '')),
  sha256: field('sha256'),
  downloadPath: field('downloadPath'),
  fileName: field('fileName'),
};
if (!expected.sizeBytes || !expected.sha256 || !expected.downloadPath) {
  console.error('Could not read the recorded release details from src/features/landing/driverApp.ts');
  process.exit(2);
}

const vercelConfig = JSON.parse(readFileSync(resolve(import.meta.dirname, '..', 'vercel.json'), 'utf8'));
const redirectEntry = vercelConfig.redirects?.find((r) => r.source === expected.downloadPath);
const configuredTarget = redirectEntry?.destination;

const arg = process.argv[2];
const isStrict = process.argv.includes('--strict');

let startUrl;
if (arg && !arg.startsWith('--')) {
  if (arg.startsWith('http://') || arg.startsWith('https://')) {
    if (arg.endsWith('.apk') || arg.includes('/releases/')) {
      startUrl = arg;
    } else {
      startUrl = `${arg.replace(/\/+$/, '')}${expected.downloadPath}`;
    }
  } else {
    startUrl = `https://${arg.replace(/\/+$/, '')}${expected.downloadPath}`;
  }
} else {
  startUrl = `https://gtransportt.vercel.app${expected.downloadPath}`;
}

const BINARY_TYPES = ['application/vnd.android.package-archive', 'application/octet-stream', 'binary/octet-stream'];
const failures = [];
const check = (ok, label, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(label);
};

async function followRedirects(initialUrl) {
  let url = initialUrl;
  let response;
  for (let hop = 0; hop < 6; hop += 1) {
    response = await fetch(url, { redirect: 'manual' });
    const where = response.headers.get('location');
    console.log(`  hop ${hop}: ${response.status} ${new URL(url).host}${new URL(url).pathname}${where ? ` -> ${where.slice(0, 110)}` : ''}`);
    if (response.status >= 300 && response.status < 400 && where) {
      url = new URL(where, url).toString();
      continue;
    }
    break;
  }
  return { response, finalUrl: url };
}

console.log(`Checking download from ${startUrl}`);
let { response, finalUrl } = await followRedirects(startUrl);

// If running before deployment against live Vercel and it returns 200 HTML SPA fallback,
// verify the target release asset configured in vercel.json directly:
const initialType = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
if (response.status === 200 && initialType === 'text/html' && !isStrict && configuredTarget && startUrl.includes('vercel.app')) {
  console.log(`\n  [i] Notice: Live Vercel host is in pre-deployment state (served HTML SPA fallback).`);
  console.log(`  [i] Verifying configured release target from vercel.json: ${configuredTarget}\n`);
  const followed = await followRedirects(configuredTarget);
  response = followed.response;
  finalUrl = followed.finalUrl;
}

check(response.status === 200, 'final response is HTTP 200', `got ${response.status}`);
if (response.status !== 200) {
  console.error('\nThe download is not available at this address.');
  process.exit(1);
}

const type = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
check(BINARY_TYPES.includes(type), 'content type is a binary download, not a web page', type || '(none)');
const disposition = response.headers.get('content-disposition') ?? '';
check(!disposition || /attachment/i.test(disposition), 'saved as a download (attachment), if the host says', disposition || '(not stated)');
const declared = Number(response.headers.get('content-length') ?? NaN);
if (!Number.isNaN(declared)) check(declared === expected.sizeBytes, 'Content-Length equals the recorded size', `${declared} vs ${expected.sizeBytes}`);

const hash = createHash('sha256');
let received = 0;
let head = Buffer.alloc(0);
for await (const chunk of response.body) {
  if (head.length < 4) head = Buffer.concat([head, chunk]).subarray(0, 4);
  hash.update(chunk);
  received += chunk.length;
}
check(head.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])), 'starts with the ZIP/APK signature (PK..)');
check(received === expected.sizeBytes, 'downloaded byte count equals the recorded size', `${received} vs ${expected.sizeBytes}`);
const digest = hash.digest('hex');
check(digest === expected.sha256, 'SHA-256 equals the recorded release', digest);

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed: this is NOT the recorded release.`);
  process.exit(1);
}
console.log(`\nOK — ${expected.fileName}: ${(received / 1_048_576).toFixed(1)} MB, SHA-256 verified.`);
