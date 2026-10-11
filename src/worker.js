'use strict';

const { parentPort, workerData } = require('node:worker_threads');
const engine = require('../vendor/prostone/src');
const { walk } = require('../vendor/prostone/src/lua/walk');
const { resolve } = require('../vendor/prostone/src/lua/scope');

try {
  const stages = [];
  let snapshotBytes = 0;
  const result = engine.deobfuscate(workerData.source, {
    detect: !workerData.force,
    skip: workerData.conservative ? ['07-opt', '09-fmt', '10-name'] : [],
    onSnapshot({ step, pass, layer, code, stats }) {
      const stage = { step, pass, layer, bytes: Buffer.byteLength(code, 'latin1'), stats };
      if (workerData.snapshots) {
        snapshotBytes += stage.bytes;
        if (snapshotBytes > 32 * 1024 * 1024) throw new Error('Snapshot limit exceeded (32 MiB)');
        stage.code = code;
      }
      stages.push(stage);
    },
  });
  const strings = new Set();
  const unsupported = new Set();
  let functions = 0;
  walk(result.chunk, {
    enter(node) {
      if (node.kind === 'String') strings.add(node.value);
      if (node.kind === 'Function') functions++;
      if (['Goto', 'Label', 'Continue'].includes(node.kind)) unsupported.add(node.kind);
    },
  });
  resolve(result.chunk);
  const remaining = engine.detect(result.chunk);
  parentPort.postMessage({
    code: result.code, stages, notes: result.notes, warnings: result.warnings,
    stats: result.stats, functions, unsupported: [...unsupported],
    remainingVMs: remaining.instances.length,
    strings: [...strings].map(value => ({
      text: value,
      base64: Buffer.from(value, 'latin1').toString('base64'),
      printable: /^[\x20-\x7e\t\r\n]*$/.test(value),
    })),
  });
} catch (error) {
  parentPort.postMessage({ error: error.message });
}
