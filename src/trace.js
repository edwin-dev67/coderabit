'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function trace(source, lua) {
  if (process.platform !== 'linux' || !lua) {
    return { status: 'unavailable', reason: 'Trace requires Linux, bubblewrap, prlimit and --lua pointing to Lua 5.1.' };
  }
  let executable;
  try { executable = fs.realpathSync(lua); } catch {
    return { status: 'unavailable', reason: 'Lua interpreter path does not exist.' };
  }
  const version = spawnSync(executable, ['-v'], { encoding: 'utf8', timeout: 3000 });
  if (version.status !== 0 || !/Lua 5\.1\b/.test(version.stdout + version.stderr)) {
    return { status: 'unavailable', reason: 'Trace requires Lua 5.1.' };
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prometheus-trace-'));
  try {
    fs.writeFileSync(path.join(dir, 'input.lua'), source);
    const args = ['--as=268435456', '--cpu=5', '--fsize=1048576', '--', 'bwrap',
      '--unshare-all', '--die-with-parent', '--new-session', '--clearenv',
      '--ro-bind', '/usr', '/usr'];
    for (const library of ['/lib', '/lib64']) {
      if (fs.existsSync(library)) args.push('--ro-bind', library, library);
    }
    args.push('--dev', '/dev', '--tmpfs', '/tmp', '--chdir', '/tmp',
      '--ro-bind', executable, '/lua',
      '--ro-bind', path.join(__dirname, 'trace.lua'), '/trace.lua',
      '--ro-bind', path.join(dir, 'input.lua'), '/input.lua', '/lua', '/trace.lua');
    const result = spawnSync('prlimit', args, {
      encoding: 'utf8', timeout: 8000, killSignal: 'SIGKILL', maxBuffer: 4 * 1024 * 1024,
    });
    const events = [];
    for (const line of (result.stdout || '').split('\n').filter(Boolean)) {
      try { events.push(JSON.parse(line)); } catch { /* Non-protocol output is not source code. */ }
    }
    return {
      status: result.status === 0 ? 'observed' : events.length ? 'incomplete' : 'unavailable',
      exitCode: result.status, events,
      reason: result.error?.message || result.stderr || '',
      limitations: 'Mock environment; callbacks and downloaded code are not executed. Observations do not prove equivalence.',
    };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
module.exports = { trace };
