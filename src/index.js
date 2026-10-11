'use strict';

const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { createHash } = require('node:crypto');
const { validate } = require('./validate');

function runWorker(source, options) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'worker.js'), {
      workerData: { source, ...options },
      resourceLimits: { maxOldGenerationSizeMb: 512, stackSizeMb: 8 },
    });
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      worker.terminate();
      reject(new Error(`Static analysis exceeded ${options.timeoutMs} ms`));
    }, options.timeoutMs);
    worker.once('message', result => {
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      if (result.error) reject(new Error(result.error));
      else resolve(result);
    });
    worker.once('error', error => { settled = true; clearTimeout(timer); reject(error); });
    worker.once('exit', code => {
      clearTimeout(timer);
      if (!settled) reject(new Error(`Analysis worker exited before returning a result (code ${code})`));
    });
  });
}

async function deobfuscate(input, options = {}) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input, 'latin1');
  if (!bytes.length || bytes.length > 2 * 1024 * 1024) throw new Error('Input must be between 1 byte and 2 MiB');
  const timeoutMs = options.timeoutMs ?? 30000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300000) throw new Error('timeoutMs must be 1..300000');
  const source = bytes.toString('latin1');
  const started = Date.now();
  const settings = { timeoutMs, force: !!options.force, snapshots: !!options.snapshots };
  let result = await runWorker(source, settings);
  let syntax = validate(result.code, options.luac || process.env.LUAC51);
  const attempts = [{ mode: 'full', validation: syntax, warnings: result.warnings }];
  let mode = 'full';
  if (syntax.status === 'failed') {
    try {
      const fallback = await runWorker(source, { ...settings, conservative: true });
      const check = validate(fallback.code, options.luac || process.env.LUAC51);
      attempts.push({ mode: 'conservative', validation: check, warnings: fallback.warnings });
      if (check.status === 'passed') { result = fallback; syntax = check; mode = 'conservative'; }
    } catch (error) { attempts.push({ mode: 'conservative', error: error.message }); }
  }
  const { code, stages, strings, ...metrics } = result;
  const clean = syntax.status === 'passed' && !metrics.warnings.length
    && !metrics.remainingVMs && !metrics.unsupported.length && mode === 'full';
  return {
    code, stages, strings,
    report: {
      schemaVersion: 1, status: clean ? 'recovered' : 'partial', mode,
      inputSha256: createHash('sha256').update(bytes).digest('hex'),
      inputBytes: bytes.length, outputBytes: Buffer.byteLength(code, 'latin1'),
      elapsedMs: Date.now() - started, validation: syntax,
      semanticEquivalence: 'not-verified', attempts, ...metrics,
      urls: strings.filter(s => /^https?:\/\//i.test(s.text)).map(s => s.text),
      stages: stages.map(({ code: ignored, ...stage }) => stage),
    },
  };
}
module.exports = { deobfuscate };
