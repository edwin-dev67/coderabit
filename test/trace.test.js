'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { trace } = require('../src/trace');
const lua = process.env.LUA51;

test('trace fails closed without a supported interpreter', () => {
  assert.equal(trace(Buffer.from('print(1)'), '/missing/lua').status, 'unavailable');
});

test('isolated observations block HTTP and omit host APIs', () => {
  const result = trace(Buffer.from('print(os, io, package, debug); game:HttpGet("https://example.invalid/"); task.spawn(function() print("not run") end)'), lua);
  assert.equal(result.status, 'observed', result.reason);
  assert.deepEqual(result.events.find(e => e.kind === 'print').args, ['nil', 'nil', 'nil', 'nil']);
  assert.ok(result.events.some(e => e.kind === 'http-blocked'));
  assert.ok(result.events.some(e => e.kind === 'deferred'));
  assert.ok(!result.events.some(e => e.args.includes('not run')));
});

test('runtime error and instruction exhaustion are incomplete, never success', () => {
  const error = trace(Buffer.from('error("intentional")'), lua);
  assert.equal(error.status, 'incomplete');
  assert.ok(error.events.some(e => e.kind === 'error'));
  const loop = trace(Buffer.from('while true do end'), lua);
  assert.equal(loop.status, 'incomplete');
  assert.equal(loop.exitCode, 3);
  assert.ok(loop.events.some(e => e.kind === 'limit'));
});
