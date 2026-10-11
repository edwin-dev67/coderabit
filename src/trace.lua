-- A bounded observation environment, not a Roblox implementation.
local host_print, host_exit = print, os.exit
local host_type, host_tostring = type, tostring
local events = 0
local function quote(s)
  return '"' .. s:gsub('[%z\1-\31\127-\255\\"]', function(c)
    if c == '"' then return '\\"' end
    if c == '\\' then return '\\\\' end
    return string.format('\\u%04x', string.byte(c))
  end) .. '"'
end
local function value(v)
  local t = host_type(v)
  if t == 'string' then return v:sub(1, 2048) end
  if t == 'number' or t == 'boolean' or t == 'nil' then return host_tostring(v) end
  return '<' .. t .. '>'
end
local function emit(kind, name, ...)
  events = events + 1
  if events > 1000 then host_exit(3) end
  local args = {}
  for i = 1, select('#', ...) do args[i] = quote(value(select(i, ...))) end
  host_print('{"kind":' .. quote(kind) .. ',"name":' .. quote(name) .. ',"args":[' .. table.concat(args, ',') .. ']}')
end
local proxy
proxy = function(name)
  return setmetatable({}, {
    __index = function(_, key)
      local field = name .. '.' .. value(key)
      if key == 'HttpGet' or key == 'HttpGetAsync' then
        return function(_, url) emit('http-blocked', field, url); return '' end
      end
      return proxy(field:sub(1, 2048))
    end,
    __newindex = function(_, key, v) emit('set', name .. '.' .. value(key), v) end,
    __call = function(_, ...) emit('call', name, ...); return proxy(name .. '()') end,
    __tostring = function() return '<mock ' .. name .. '>' end,
  })
end
local function copy(t)
  local result = {}
  for k, v in pairs(t) do result[k] = v end
  return result
end
local env = {
  assert = assert, error = error, ipairs = ipairs, pairs = pairs, next = next,
  pcall = pcall, xpcall = xpcall, select = select, tonumber = tonumber,
  tostring = tostring, type = type, typeof = type, unpack = unpack,
  rawget = rawget, rawset = rawset, rawequal = rawequal,
  setmetatable = setmetatable, getmetatable = getmetatable, newproxy = newproxy,
  math = copy(math), string = copy(string), table = copy(table), _VERSION = _VERSION,
  game = proxy('game'), workspace = proxy('workspace'), Enum = proxy('Enum'),
  Instance = proxy('Instance'), Vector3 = proxy('Vector3'), CFrame = proxy('CFrame'),
}
env._G = env
env.getfenv = function() return env end
env.getgenv = function() return env end
env.getrenv = function() return env end
env.print = function(...) emit('print', 'print', ...) end
env.warn = function(...) emit('print', 'warn', ...) end
env.loadstring = function(source)
  emit('dynamic-source', 'loadstring', source)
  return function(...) emit('mock', 'loaded-function', ...); return proxy('loaded') end
end
env.tick = function() return 0 end
env.wait = function() emit('mock', 'wait'); return nil end
env.spawn = function(fn) emit('deferred', 'spawn', fn) end
env.task = { spawn = env.spawn, defer = env.spawn, wait = env.wait, delay = env.spawn }
local fn, err = loadfile('/input.lua')
if not fn then emit('error', 'compile', err); host_exit(2) end
setfenv(fn, env)
local budget = 0
debug.sethook(function()
  budget = budget + 1000
  if budget >= 2000000 then
    emit('limit', 'instructions', budget)
    host_exit(3)
  end
end, '', 1000)
local ok, message = pcall(fn)
debug.sethook()
if not ok then emit('error', 'runtime', message); host_exit(2) end
emit('complete', 'observations-only')
