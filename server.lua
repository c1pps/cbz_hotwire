local ESX = exports.es_extended:getSharedObject()

-- Staff groups on this server (custom hierarchy, no stock "superadmin")
local ALLOWED_GROUPS = {
    owner = true,
    developer = true,
    management = true,
    manager = true,
    senioradmin = true,
    gameadmin = true,
    admin = true,
}

local function isAdmin(source)
    local xPlayer = ESX.GetPlayerFromId(source)
    return xPlayer ~= nil and ALLOWED_GROUPS[xPlayer.getGroup()] == true
end

local function denied(source)
    TriggerClientEvent("chat:addMessage", source, {
        color = { 255, 80, 80 },
        args = { "HOTWIRE", "You don't have permission to use this command." }
    })
end

-- /hwtest [easy|medium|hard] [screw|spark|immo]
RegisterCommand("hwtest", function(source, args)
    if source == 0 then
        print("[cbz_hotwire] /hwtest is in-game only")
        return
    end
    if not isAdmin(source) then return denied(source) end
    TriggerClientEvent("cbz_hotwire:test", source, args[1], args[2])
end, false)

RegisterCommand("hwstop", function(source)
    if source == 0 then return end
    if not isAdmin(source) then return denied(source) end
    TriggerClientEvent("cbz_hotwire:forceStop", source)
end, false)

-- ========================================================================
-- SERVER-SIDE RESULT: consequences + rate-limit + anti-cheat + logs
-- ========================================================================
local lastAttempt = {} -- src -> os.time ms

local function discordLog(title, desc, colour)
    local L = Config.Logs
    if not L or not L.enabled or not L.webhook or L.webhook == "" then return end
    PerformHttpRequest(L.webhook, function() end, "POST", json.encode({
        username = L.botName or "CBz Hotwire",
        embeds = { { title = title, description = desc, color = colour or 3092790 } }
    }), { ["Content-Type"] = "application/json" })
end

RegisterNetEvent("cbz_hotwire:sv:result", function(success, game, difficulty, elapsedMs)
    local src = source
    local xPlayer = ESX.GetPlayerFromId(src)
    local name = xPlayer and (xPlayer.getName and xPlayer.getName() or ("id " .. src)) or ("id " .. src)

    -- rate-limit: ignore consequences if attempts come faster than allowed
    local now = GetGameTimer()
    local prev = lastAttempt[src]
    lastAttempt[src] = now
    local minGap = (Config.Security and Config.Security.cooldownMs) or 0
    if prev and (now - prev) < minGap then
        discordLog("⚠️ Hotwire rate-limit", ("**%s** (id %d) attempts too fast (%dms gap)"):format(name, src, now - prev), 15158332)
        return
    end

    game = tostring(game or "?")
    difficulty = tostring(difficulty or "?")
    elapsedMs = tonumber(elapsedMs) or 0

    if success then
        -- anti-cheat: a "success" faster than humanly possible is flagged, not rewarded
        local minMs = (Config.Security and Config.Security.minSuccessMs) or 0
        if elapsedMs < minMs then
            discordLog("🚩 Suspicious hotwire", ("**%s** (id %d) 'succeeded' %s/%s in %dms (min %dms) — no reward"):format(name, src, game, difficulty, elapsedMs, minMs), 15158332)
            return
        end
        -- skill XP reward: cbz_skills if present, else the fallback event
        if Config.Skills and Config.Skills.enabled and (Config.Skills.amount or 0) > 0 then
            if GetResourceState("cbz_skills") == "started" then
                exports.cbz_skills:AddXp(src, Config.Skills.amount)
            elseif Config.Skills.event then
                TriggerEvent(Config.Skills.event, src, Config.Skills.amount)
            end
        end
        discordLog("🚗 Hotwire success", ("**%s** (id %d) — %s / %s in %.1fs"):format(name, src, game, difficulty, elapsedMs / 1000), 3066993)
    else
        -- break/consume the required item on failure
        local r = Config.RequireItem
        if r and r.enabled and (r.breakChance or 0) > 0 and math.random(100) <= r.breakChance then
            if GetResourceState("ox_inventory") == "started" then
                exports.ox_inventory:RemoveItem(src, r.item, 1)
                TriggerClientEvent("chat:addMessage", src, {
                    color = { 255, 120, 120 }, args = { "HOTWIRE", ("Your %s broke."):format(r.item) }
                })
            end
        end
        discordLog("❌ Hotwire failed", ("**%s** (id %d) — %s / %s"):format(name, src, game, difficulty), 15158332)
    end
end)

AddEventHandler("playerDropped", function()
    lastAttempt[source] = nil
end)
