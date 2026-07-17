local inMinigame = false
local result = false

local VALID_GAMES = { screw = true, spark = true, immo = true }
local VALID_DIFF = { easy = true, medium = true, hard = true }
local ALL_GAMES = { "screw", "spark", "immo" }

math.randomseed(GetGameTimer())

-- Build a vehicle-class → category-settings lookup once from the config.
local CLASS_SETTINGS = {}
for name, classes in pairs(Config.Categories or {}) do
    local settings = Config.CategorySettings and Config.CategorySettings[name]
    if settings then
        for _, class in ipairs(classes) do
            CLASS_SETTINGS[class] = settings
        end
    end
end

-- The category settings for the vehicle the player is currently in.
local function vehicleSettings()
    local veh = GetVehiclePedIsIn(PlayerPedId(), false)
    if veh ~= 0 then
        local s = CLASS_SETTINGS[GetVehicleClass(veh)]
        if s then return s end
    end
    return Config.DefaultCategory or {}
end

-- Pick the game: an explicit valid game wins (e.g. /hwtest); otherwise a random
-- one from the vehicle category's allowed list (empty list ⇒ all games).
local function resolveGame(game)
    if VALID_GAMES[game] then return game end
    local pool = {}
    for _, g in ipairs(vehicleSettings().games or {}) do
        if VALID_GAMES[g] then pool[#pool + 1] = g end
    end
    if #pool == 0 then pool = ALL_GAMES end
    return pool[math.random(#pool)]
end

-- Pick the difficulty: an explicit valid difficulty wins; otherwise the
-- vehicle category's difficulty.
local function resolveDifficulty(difficulty)
    if VALID_DIFF[difficulty] then return difficulty end
    local d = vehicleSettings().difficulty
    if VALID_DIFF[d] then return d end
    return "medium"
end

RegisterNUICallback("result", function(data, cb)
    cb("ok")
    SetNuiFocus(false, false)
    result = data and data.result == true
    inMinigame = false
end)

local function stopMinigame()
    SendNUIMessage({ type = "stop" })
    SetNuiFocus(false, false)
    result = false
    inMinigame = false
end

-- ---- Thief animation + tool prop while hotwiring -------------------------
local hwProp = nil
local function startAnimProp()
    local a = Config.Animation
    if not a or not a.enabled then return end
    -- fully async so the minigame UI appears instantly
    CreateThread(function()
        local ped = PlayerPedId()
        RequestAnimDict(a.dict)
        local t = GetGameTimer()
        while not HasAnimDictLoaded(a.dict) and GetGameTimer() - t < 1000 do Wait(10) end
        if inMinigame and HasAnimDictLoaded(a.dict) then
            TaskPlayAnim(ped, a.dict, a.clip, 4.0, -4.0, -1, 49, 0, false, false, false)
        end
        if a.prop then
            local model = GetHashKey(a.prop)
            RequestModel(model)
            local t2 = GetGameTimer()
            while not HasModelLoaded(model) and GetGameTimer() - t2 < 1000 do Wait(10) end
            if inMinigame and HasModelLoaded(model) then
                local c = GetEntityCoords(ped)
                hwProp = CreateObject(model, c.x, c.y, c.z, true, true, false)
                AttachEntityToEntity(hwProp, ped, GetPedBoneIndex(ped, a.bone or 28422),
                    a.offset.x, a.offset.y, a.offset.z, a.rot.x, a.rot.y, a.rot.z, true, true, false, true, 1, true)
            end
            SetModelAsNoLongerNeeded(model)
        end
    end)
end
local function stopAnimProp()
    local a = Config.Animation
    if a and a.dict then StopAnimTask(PlayerPedId(), a.dict, a.clip, 3.0) end
    ClearPedTasks(PlayerPedId())
    if hwProp and DoesEntityExist(hwProp) then DeleteEntity(hwProp) end
    hwProp = nil
end

-- ---- Set the car's own alarm off (failure) -------------------------------
local function triggerAlarm(veh)
    if not Config.Alarm or not Config.Alarm.enabled or not veh or veh == 0 then return end
    SetVehicleAlarm(veh, true)
    StartVehicleAlarm(veh)
    CreateThread(function()
        Wait((Config.Alarm.duration or 8) * 1000)
        if DoesEntityExist(veh) then SetVehicleAlarm(veh, false) end
    end)
end

-- ---- Skill-based easing (cbz_skills) -------------------------------------
-- Returns an ease factor 0..1 from the player's level in the configured skill.
local function skillEase()
    local s = Config.SkillDifficulty
    if not s or not s.enabled or (s.strength or 0) <= 0 then return 0 end
    if GetResourceState("cbz_skills") ~= "started" then return 0 end
    local ok, lvl = pcall(function() return exports.cbz_skills:GetSkillLevel(s.skillId) end)
    lvl = (ok and tonumber(lvl)) or 0
    local maxL = s.maxLevel or 5
    local frac = maxL > 0 and math.min(1.0, lvl / maxL) or 0
    return frac * math.min(1.0, s.strength or 1.0)
end

-- Copy the params and ease them by factor e (0..1). Never mutates the config.
local function easeParams(game, params, e)
    if e <= 0 then return params end
    local p = {}
    for k, v in pairs(params) do p[k] = v end
    if game == "screw" then
        p.tol  = (p.tol or 30) * (1 + e * 0.4)
        p.hold = (p.hold or 400) * (1 - e * 0.25)
    elseif game == "spark" then
        p.zone  = (p.zone or 0.18) * (1 + e * 0.4)
        p.speed = (p.speed or 1.0) * (1 - e * 0.25)
    elseif game == "immo" then
        p.cycleMs = (p.cycleMs or 110) * (1 + e * 0.35)
    end
    return p
end

-- ---- Required item (ox_inventory, client-side count check) ---------------
local function hasRequiredItem()
    local r = Config.RequireItem
    if not r or not r.enabled then return true end
    if GetResourceState("ox_inventory") ~= "started" then return true end -- fail-open if inv missing
    local count = exports.ox_inventory:Search("count", r.item) or 0
    return count >= 1
end

--- Run a hotwire minigame (blocking).
--- @param game string|nil 'screw'|'spark'|'immo' — nil/invalid ⇒ random from the vehicle category's allowed games
--- @param difficulty string|nil 'easy'|'medium'|'hard' — nil/invalid ⇒ the vehicle category's difficulty
--- @param isTest boolean|nil true to skip item/police/alarm consequences (admin test)
--- @return boolean success
local function startMinigame(game, difficulty, isTest)
    if inMinigame then return false end
    game = resolveGame(game)
    difficulty = resolveDifficulty(difficulty)

    local params = Config.Games[game] and Config.Games[game][difficulty]
    if not params then return false end
    local duration = Config.Duration[difficulty] or 20000

    -- skill-based easing (higher skill ⇒ easier + a bit more time)
    local e = skillEase()
    params = easeParams(game, params, e)
    duration = math.floor(duration * (1 + e * 0.2))

    -- required item (real hotwire only)
    if not isTest and not hasRequiredItem() then
        TriggerEvent("chat:addMessage", {
            color = { 255, 120, 120 },
            args = { "HOTWIRE", ("You need a %s to hotwire this vehicle."):format(Config.RequireItem.item) }
        })
        return false
    end

    local veh = GetVehiclePedIsIn(PlayerPedId(), false)
    result = false
    inMinigame = true
    startAnimProp()
    SetNuiFocus(true, true)
    SendNUIMessage({
        type = "start",
        game = game,
        duration = duration,
        params = params,
        failOnMistake = Config.FailOnMistake ~= false,
        sound = { enabled = (Config.Sound and Config.Sound.enabled) ~= false, volume = (Config.Sound and Config.Sound.volume) or 0.5 },
    })

    local startedInVehicle = IsPedInAnyVehicle(PlayerPedId(), false)
    local startTime = GetGameTimer()
    local deadline = startTime + duration + 5000
    while inMinigame do
        Wait(50)
        local ped = PlayerPedId()
        if GetGameTimer() > deadline
            or IsEntityDead(ped)
            or (startedInVehicle and not IsPedInAnyVehicle(ped, false)) then
            stopMinigame()
        end
    end
    stopAnimProp()

    if not isTest then
        local elapsed = GetGameTimer() - startTime
        if result then
            TriggerServerEvent("cbz_hotwire:sv:result", true, game, difficulty, elapsed)
        else
            triggerAlarm(veh)
            TriggerServerEvent("cbz_hotwire:sv:result", false, game, difficulty, elapsed)
        end
    end
    return result
end

exports("startMinigame", startMinigame)
exports("stopMinigame", stopMinigame)

-- /hwtest [easy|medium|hard] [screw|spark|immo]
-- No args ⇒ random game + difficulty by the vehicle you're in (like a real hotwire).
RegisterNetEvent("cbz_hotwire:test", function(diffArg, gameArg)
    local difficulty = VALID_DIFF[diffArg] and diffArg or nil
    local game = VALID_GAMES[gameArg] and gameArg or nil
    local ok = startMinigame(game, difficulty, true) -- isTest: no server result/alarm
    TriggerEvent("chat:addMessage", {
        color = { 255, 170, 0 },
        args = { "HOTWIRE", ("%s / %s → %s"):format(game or "random", difficulty or "by-class", ok and "success" or "failed") }
    })
    print(("[cbz_hotwire] test %s/%s: %s"):format(game or "random", difficulty or "by-class", ok and "success" or "failed"))
end)

RegisterNetEvent("cbz_hotwire:forceStop", function()
    stopMinigame()
end)

AddEventHandler("onResourceStop", function(res)
    if res ~= GetCurrentResourceName() then return end
    SetNuiFocus(false, false)
    if hwProp and DoesEntityExist(hwProp) then DeleteEntity(hwProp) end
end)
