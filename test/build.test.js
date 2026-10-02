import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outFile = path.join(root, 'dist', 'landingtimer.user.js');

let built = null;
/** Builds once per run; every test in this file reads the same bundle. */
function bundle() {
  if (built === null) {
    execFileSync(process.execPath, [path.join(root, 'build.mjs')], { cwd: root, stdio: 'pipe' });
    built = readFileSync(outFile, 'utf8');
  }
  return built;
}

/** The bundled code alone, without the ==UserScript== banner above it. */
function code() {
  const all = bundle();
  const marker = '// ==/UserScript==';
  return all.slice(all.indexOf(marker) + marker.length);
}

test('the bundle starts with the metadata block and is one IIFE', () => {
  const code = bundle();
  assert.ok(code.startsWith('// ==UserScript=='), 'bundle must start with // ==UserScript==');
  assert.match(code, /\/\/ @name\s+Landing Timer/);
  assert.match(code, /\/\/ @namespace\s+landingtimer\.torn/);
  assert.match(code, /\/\/ @match\s+https:\/\/www\.torn\.com\/\*/);
  assert.match(code, /\/\/ @run-at\s+document-idle/);
  assert.match(code, /\/\/ ==\/UserScript==/);
  assert.match(code, /^\(\(\) => \{/m, 'bundle body must be an IIFE');
  assert.ok(!/^\s*import\s/m.test(code), 'no import statements survive bundling');
  assert.ok(!/^\s*export\s/m.test(code), 'no export statements survive bundling');
});

test('the version from the metadata block is stamped onto the injected stylesheet', () => {
  const code = bundle();
  const declared = /^\/\/ @version\s+(\S+)/m.exec(readFileSync(path.join(root, 'src', 'header.txt'), 'utf8'));
  assert.ok(declared, 'src/header.txt must declare a @version');
  assert.match(code, /data-landingtimer-version/);
  assert.ok(code.includes(`"${declared[1]}"`), `the bundle must carry the declared version ${declared[1]}`);
});

// Torn's rules forbid extra non-API requests. Landing Timer makes none at all,
// and this test is the proof a reviewer can point at. It catches the named
// network APIs and the usual DOM ways to start a request (an element given a
// URL to load); anything cleverer would still need a human reading src/.
test('rule safety: the bundle makes no network requests and asks for no permissions', () => {
  const forbidden = [
    /\bfetch\s*\(/, /XMLHttpRequest/, /GM_xmlhttpRequest/, /GM\.xmlHttpRequest/,
    /sendBeacon/, /WebSocket/, /EventSource/, /\bimport\s*\(/,
    /\bnew\s+(?:Image|Audio)\b/,              // new Image() / new Audio(url) fetch their src
    /\.src\s*=/,                               // element.src = url
    /['"](?:src|srcset|ping)['"]/,             // setAttribute('src', url), <a ping>
    /['"](?:script|img|iframe|audio|video|source|embed|link)['"]/, // creating elements that load URLs
  ];
  for (const pattern of forbidden) {
    assert.ok(!pattern.test(code()), `the bundle must not contain ${pattern}`);
  }
  const grants = [...bundle().matchAll(/^\/\/ @grant\s+(\S+)/gm)].map((m) => m[1]);
  assert.deepEqual(grants, ['none'], 'the only grant is none');
  assert.ok(!/^\/\/ @(connect|require|resource)\b/m.test(bundle()), 'no @connect, @require or @resource');
});
