-- Minimal Roblox-flavoured Lua sandbox used by `npm test` (and by hand when
-- checking that obfuscated output still behaves like the input).
-- Only what the sample scripts need: print() is captured, game/workspace/script
-- return permissive fake instances, bit32 is mapped onto Lua 5.3 operators.
local out = {}
__out = out
print = function(...)
  local n = select('#', ...)
  local t = {}
  for i = 1, n do t[i] = tostring(select(i, ...)) end
  out[#out + 1] = table.concat(t, "\t")
end
warn = function() end
bit32 = {
  bxor = function(a, b) return a ~ b end,
  bor  = function(a, b) return a | b end,
  band = function(a, b) return a & b end,
  bnot = function(a) return ~a end,
  lshift = function(a, n) return a << (n % 32) end,
  rshift = function(a, n) return a >> (n % 32) end
}
local any
any = {
  __index = function(_, k)
    if k == 'Name' then return 'Neon' end
    if k == 'UserId' or k == 'PlayerId' then return 7 end
    if k == 'Value' then return 0 end
    return setmetatable({}, any)
  end,
  __call = function(_, ...)
    for i = 1, select('#', ...) do
      local v = select(i, ...)
      if type(v) == 'string' and v:sub(1, 1):lower() == 'p' and type(rawget(_G, v)) == 'table' then
        return setmetatable({ LocalPlayer = setmetatable({}, any) }, any)
      end
    end
    return setmetatable({}, any)
  end,
  __tostring = function() return 'Instance' end,
  __concat = function() return 'Instance' end
}
game = setmetatable({}, any)
workspace = setmetatable({}, any)
script = setmetatable({}, any)
task = setmetatable({ wait = function() end, delay = function() end, spawn = function() end, defer = function() end }, any)
