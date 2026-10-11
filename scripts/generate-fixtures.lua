-- Run from repository root with Lua 5.1 and PROMETHEUS_ROOT set to the pinned checkout.
local root = assert(os.getenv('PROMETHEUS_ROOT'), 'Set PROMETHEUS_ROOT')
package.path = root .. '/src/?.lua;' .. package.path
require('prometheus') -- Upstream compatibility initialization, including math.random.
local Pipeline = require('prometheus.pipeline')
local presets = require('presets')
local f = assert(io.open('test/fixtures/behavior.lua', 'rb'))
local source = f:read('*a'); f:close()
for _, preset in ipairs({'Weak', 'Medium', 'Strong'}) do
  for _, seed in ipairs({17, 42}) do
    presets[preset].Seed = seed
    local result = Pipeline:fromConfig(presets[preset]):apply(source, 'behavior.lua')
    local out = assert(io.open('test/fixtures/' .. preset:lower() .. '-' .. seed .. '.lua', 'wb'))
    out:write(result); out:close()
  end
end
