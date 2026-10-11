'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { deobfuscate } = require('../src');
const { validate } = require('../src/validate');
const engine = require('../vendor/prostone/src');
const { resolve } = require('../vendor/prostone/src/lua/scope');
const jumps = require('../vendor/prostone/src/beautify/jumps');

const fixture = name => path.join(__dirname, 'fixtures', name);
const lua = process.env.LUA51 || 'lua5.1';
const luac = process.env.LUAC51 || 'luac5.1';
function execute(code) {
  const p = spawnSync(lua, ['-'], { input: code, encoding: 'utf8', timeout: 5000 });
  assert.equal(p.status, 0, p.error?.message || p.stderr);
  return p.stdout;
}
const original = fs.readFileSync(fixture('behavior.lua'));

for (const preset of ['weak', 'medium', 'strong']) {
  for (const seed of [17, 42]) {
    test(`${preset}/${seed}: closures, branches, loops, nils, bytes and side effects`, async () => {
      const input = fs.readFileSync(fixture(`${preset}-${seed}.lua`));
      const result = await deobfuscate(input, { luac, snapshots: true });
      assert.equal(result.report.status, 'recovered', JSON.stringify(result.report));
      assert.equal(result.report.stats['devirtualize.layers'], preset === 'strong' ? 2 : 1);
      assert.equal(result.report.remainingVMs, 0);
      assert.equal(result.report.semanticEquivalence, 'not-verified');
      assert.deepEqual(result.report.warnings, []);
      const expected = execute(original);
      assert.equal(execute(input), expected, 'fixture matches original');
      assert.equal(execute(Buffer.from(result.code, 'latin1')), expected, 'recovery matches original');
      assert.ok(result.stages.every(s => typeof s.code === 'string'));
      assert.ok(result.strings.some(s => s.text === 'recursive'));
    });
  }
}

test('failed pass rolls back its AST, notes and counters', () => {
  const step = engine.STEPS.find(s => s.name === '02-fold');
  const run = step.run;
  try {
    step.run = ctx => {
      ctx.chunk.body.statements = [];
      ctx.bump('fake'); ctx.note('fake');
      throw new Error('test failure');
    };
    const context = engine.run(engine.parse('print("kept")'), { only: ['02-fold'] });
    assert.match(context.source(), /kept/);
    assert.equal(context.stats.fake, undefined);
    assert.deepEqual(context.notes, []);
    assert.match(context.warnings[0].message, /rolled back/);
  } finally { step.run = run; }
});

test('jump cleanup can copy a bounded return tail without missing constants', () => {
  const chunk = engine.parse('if flag then goto finish end; print("before"); ::finish:: print("after"); return 9');
  resolve(chunk);
  assert.ok(jumps.clean(chunk) > 0);
  const code = engine.unparse(chunk);
  assert.doesNotMatch(code, /goto|::/);
  assert.equal(validate(code, luac).status, 'passed');
  assert.equal(execute('flag = true; ' + code), 'after\n');
  assert.equal(execute('flag = false; ' + code), 'before\nafter\n');
});

test('missing compiler cannot certify recovered code', async () => {
  const result = await deobfuscate('print("ok")', { force: true, luac: '/missing/luac' });
  assert.equal(result.report.status, 'partial');
  assert.equal(result.report.validation.status, 'unavailable');
});

test('invalid Lua output is rejected by a real compiler', () => {
  assert.equal(validate('goto missing', luac).status, 'failed');
});

test('input and worker limits fail explicitly', async () => {
  await assert.rejects(deobfuscate(Buffer.alloc(2 * 1024 * 1024 + 1)), /2 MiB/);
  await assert.rejects(deobfuscate(''), /1 byte/);
  await assert.rejects(deobfuscate('print(1)', { timeoutMs: NaN }), /timeoutMs/);
  await assert.rejects(deobfuscate('print(1)', { force: true, timeoutMs: 1 }), /exceeded/);
  await assert.rejects(deobfuscate('local =', { force: true }), /./);
});

test('binary constants preserve every byte in the JSON representation', async () => {
  const result = await deobfuscate('print("\\000\\255\\128")', { force: true, luac });
  const value = result.strings.find(s => s.base64 === 'AP+A');
  assert.ok(value);
  assert.equal(value.printable, false);
});

test('CLI writes diagnostics and refuses to overwrite an existing directory', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recover-test-'));
  try {
    const cli = path.join(__dirname, '..', 'bin', 'recover.js');
    const destination = path.join(dir, 'result');
    const args = [cli, fixture('weak-17.lua'), '-o', destination, '--luac', luac, '--snapshots'];
    const run = () => spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 15000 });
    const first = run();
    assert.equal(first.status, 0, first.stderr);
    const bytes = fs.readFileSync(path.join(destination, 'recovered.lua'));
    assert.equal(JSON.parse(fs.readFileSync(path.join(destination, 'report.json'))).validation.status, 'passed');
    assert.ok(fs.readdirSync(path.join(destination, 'stages')).length > 0);
    assert.equal(run().status, 1);
    assert.deepEqual(fs.readFileSync(path.join(destination, 'recovered.lua')), bytes);
    const partial = spawnSync(process.execPath, [cli, fixture('weak-17.lua'), '-o', path.join(dir, 'partial'), '--luac', '/missing'], { encoding: 'utf8' });
    assert.equal(partial.status, 2);
    assert.ok(fs.existsSync(path.join(dir, 'partial', 'partial.lua')));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('customer regression sample', { skip: !process.env.PROMETHEUS_SAMPLE }, async () => {
  const result = await deobfuscate(fs.readFileSync(process.env.PROMETHEUS_SAMPLE), { luac });
  assert.equal(result.report.status, 'recovered');
  assert.deepEqual(result.report.warnings, []);
  assert.equal(result.report.stats['devirtualize.layers'], 1);
  for (const name of ['Best', 'Strength', 'Rebirth']) assert.match(result.code, new RegExp(`function ${name}\\(`));
  assert.doesNotMatch(result.code, /goto |::/);
  assert.ok(result.report.urls.some(url => url.includes('Tora-Library')));
});

test('unsupported jumps stay partial after both strategies', async () => {
  const result = await deobfuscate('::again:: print("loop"); goto again', { force: true, luac });
  assert.equal(result.report.status, 'partial');
  assert.equal(result.report.validation.status, 'failed');
  assert.equal(result.report.attempts.length, 2);
  assert.ok(result.report.unsupported.includes('Goto'));
});


test('decoder cleanup preserves an unresolved control transfer', async () => {
  const result = await deobfuscate('goto missing', { force: true, luac });
  assert.equal(result.report.status, 'partial');
  assert.match(result.code, /goto missing/);
});

test('decoder loops can be removed when their break stays inside the loop', async () => {
  const source = 'local c = {}; local n = 0; while true do n = n + 1; c[n] = string.char(64+n); if n == 3 then break end end; print(c[1], c[3])';
  const result = await deobfuscate(source, { force: true, luac });
  assert.equal(result.report.status, 'recovered');
  assert.equal(execute(result.code), execute(source));
  assert.doesNotMatch(result.code, /while/);
});
