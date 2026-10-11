'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function validate(code, executable) {
  const candidates = executable ? [executable] : ['luac5.1', 'luac51', 'luac'];
  let compiler;
  for (const candidate of candidates) {
    const version = spawnSync(candidate, ['-v'], { encoding: 'utf8', timeout: 3000 });
    if (!version.error && version.status === 0 && /Lua 5\.1\b/.test(version.stdout + version.stderr)) {
      compiler = candidate;
      break;
    }
  }
  if (!compiler) return { status: 'unavailable', reason: 'Lua 5.1 compiler required; set --luac or LUAC51.' };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prometheus-validate-'));
  try {
    fs.writeFileSync(path.join(dir, 'candidate.lua'), code, 'latin1');
    const result = spawnSync(compiler, ['-p', path.join(dir, 'candidate.lua')], {
      encoding: 'utf8', timeout: 5000, maxBuffer: 1024 * 1024,
    });
    return {
      status: result.status === 0 ? 'passed' : 'failed', compiler,
      reason: (result.error?.message || result.stderr || '').replaceAll(dir, '<temporary>'),
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
module.exports = { validate };
