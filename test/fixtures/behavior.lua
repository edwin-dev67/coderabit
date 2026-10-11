local function pack(...) return { n = select('#', ...), ... } end
local function values(x) return x, nil, x + 2 end
local function counter(start)
  return function(step) start = start + step; return start end
end
local function classify(x)
  if x < 0 then return 'negative' elseif x == 0 then return 'zero' else return 'positive' end
end
local a, b = counter(4), counter(20)
print('closure', a(2), b(-3), a(1))
local v = pack(values(7))
print('returns', v.n, v[1], v[2], v[3])
local total = 0
for i = 1, 8 do
  if i % 2 == 0 then total = total + i else total = total - i end
end
local n = 0
repeat n = n + 1 until n == 3
while n > 0 do n = n - 1 end
print('loops', total, n)
for i = -1, 1 do print('branch', classify(i)) end
print('bytes', string.byte('\000\255Z', 1, 3))
local calls = 0
local function side() calls = calls + 1; return calls end
local x, y = side(), side()
print('order', x, y, calls)
local function factorial(n) if n < 2 then return 1 end return n * factorial(n - 1) end
print('recursive', factorial(6))
local log = {}
local object = setmetatable({}, {
  __index = function(_, k) log[#log + 1] = k; return #log end,
})
local first, second = object.a, object.b
local skip = false and object.never
local chosen = true and object.c or object.never
print('metatable', first, second, chosen, table.concat(log, ','), skip)
local shared = 0
local function up() shared = shared + 1; return shared end
local function down() shared = shared - 2; return shared end
print('shared', up(), down(), up())
local t = {1, 2, 3}
t[1], t[2] = t[2], t[1]
print('swap', t[1], t[2])
