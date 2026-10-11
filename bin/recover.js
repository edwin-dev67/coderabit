#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { deobfuscate } = require('../src');
const { trace } = require('../src/trace');

const HELP = `Usage: node bin/recover.js input.lua [options]
  -o DIRECTORY     New output directory (default: <input>.recovered)
  --luac PATH      Lua 5.1 compiler (or LUAC51 environment variable)
  --snapshots      Save code after each transformation
  --trace          Add isolated, partial runtime observations (Linux)
  --lua PATH       Lua 5.1 interpreter for trace (or LUA51)
  --timeout MS     Static analysis timeout per attempt (default 30000)
  --force          Process code without the Prometheus detector
  -h, --help       Show help
Exit: 0 recovered + syntax checked; 2 partial/unvalidated; 1 failure.
Syntax checking does not establish behavioral equivalence.
`;

async function main(argv) {
  const opts = {};
  let input;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') { process.stdout.write(HELP); return 0; }
    if (['-o', '--luac', '--lua', '--timeout'].includes(arg)) {
      if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`Missing value for ${arg}`);
      opts[arg] = argv[++i];
    } else if (['--trace', '--snapshots', '--force'].includes(arg)) opts[arg] = true;
    else if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
    else if (input) throw new Error('Only one input file is supported');
    else input = arg;
  }
  if (!input) throw new Error(HELP);
  const destination = path.resolve(opts['-o'] || `${input}.recovered`);
  if (fs.existsSync(destination)) throw new Error(`Output directory already exists: ${destination}`);
  const stat = fs.statSync(input);
  if (!stat.isFile() || stat.size > 2 * 1024 * 1024) throw new Error('Input must be a file of at most 2 MiB');
  const source = fs.readFileSync(input);
  const result = await deobfuscate(source, {
    luac: opts['--luac'], snapshots: opts['--snapshots'], force: opts['--force'],
    timeoutMs: opts['--timeout'] === undefined ? undefined : Number(opts['--timeout']),
  });
  const observations = opts['--trace'] ? trace(source, opts['--lua'] || process.env.LUA51) : null;
  if (observations) result.report.trace = { status: observations.status, reason: observations.reason };
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  // Claim a new directory atomically; never merge into previous output.
  fs.mkdirSync(destination);
  const filename = result.report.status === 'recovered' ? 'recovered.lua' : 'partial.lua';
  fs.writeFileSync(path.join(destination, filename), result.code, 'latin1');
  fs.writeFileSync(path.join(destination, 'report.json'), JSON.stringify(result.report, null, 2));
  fs.writeFileSync(path.join(destination, 'strings.json'), JSON.stringify(result.strings, null, 2));
  if (observations) fs.writeFileSync(path.join(destination, 'trace.json'), JSON.stringify(observations, null, 2));
  if (opts['--snapshots']) {
    fs.mkdirSync(path.join(destination, 'stages'));
    result.stages.forEach((stage, i) => fs.writeFileSync(
      path.join(destination, 'stages', `${String(i + 1).padStart(3, '0')}-${stage.step}.lua`), stage.code, 'latin1',
    ));
  }
  process.stdout.write(`${result.report.status}: ${path.join(destination, filename)}\n`
    + `Lua 5.1 syntax: ${result.report.validation.status}; semantic equivalence: not verified\n`);
  if (observations) process.stdout.write(`Trace: ${observations.status}\n`);
  return result.report.status === 'recovered' && (!observations || observations.status === 'observed') ? 0 : 2;
}

if (require.main === module) main(process.argv.slice(2)).then(code => { process.exitCode = code; })
  .catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
module.exports = { main };
