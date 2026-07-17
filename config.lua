Config = {}

-- =====================================================================
-- MINIGAME & DIFFICULTY PER VEHICLE CATEGORY
-- =====================================================================
-- Vehicles are grouped into named categories (economy, sport, luxury…). For
-- each category you choose WHICH minigames may appear and the difficulty.
--
-- 1) Map GTA vehicle classes to a category. (Class ids are the GTA vehicle
--    classes — change which class belongs to which category here.)
Config.Categories = {
    economy = { 0, 1, 9, 10, 11, 17, 20 },  -- Compacts, Sedans, Off-road, Industrial, Utility, Service, Commercial
    average = { 2, 3, 4, 8, 12, 14 },        -- SUVs, Coupes, Muscle, Motorcycles, Vans, Boats
    sport   = { 5, 6, 22 },                  -- Sports Classics, Sports, Open Wheel
    luxury  = { 7, 15, 16 },                 -- Super, Helicopters, Planes
    special = { 18, 19 },                    -- Emergency, Military
}

-- 2) Per category: which minigames may appear (one is picked at random from
--    the list) and the difficulty. games can be any subset of
--    { 'screw', 'spark', 'immo' }. An empty list ⇒ all three.
Config.CategorySettings = {
    economy = { games = { 'screw', 'spark' },          difficulty = 'easy'   },
    average = { games = { 'screw', 'spark', 'immo' },  difficulty = 'medium' },
    sport   = { games = { 'spark', 'immo' },           difficulty = 'hard'   },
    luxury  = { games = { 'immo' },                     difficulty = 'hard'   },
    special = { games = { 'screw', 'spark', 'immo' },  difficulty = 'hard'   },
}

-- Fallback for any vehicle class not listed in a category above.
Config.DefaultCategory = { games = { 'screw', 'spark', 'immo' }, difficulty = 'medium' }

-- =====================================================================
-- ONE MISTAKE = FAIL
-- =====================================================================
-- When true, a single wrong input (wrong wire in "wires", wrong digit in
-- "immo") instantly fails the minigame. This is where the difficulty comes from:
-- you must get it right first try. (The screwdriver's "slip" stays a soft
-- reset, since overshooting a rotation is imprecision, not a wrong choice.)
Config.FailOnMistake = true

-- =====================================================================
-- FAILURE BEHAVIOUR
-- =====================================================================
-- On failure the minigame closes and the vehicle alarm goes off.
-- The police alert is NOT handled here — wasabi_carlock already does it
-- (Config.notifyPolice.hotwire in its own config), so there's no dispatch
-- dependency and no double alert.

-- =====================================================================
-- SOUND  (synthesised in the UI, no audio files needed)
-- =====================================================================
Config.Sound = {
    enabled = true,
    volume  = 0.5, -- 0..1
}

-- =====================================================================
-- ANIMATION + TOOL PROP  (played on the thief while hotwiring)
-- =====================================================================
Config.Animation = {
    enabled = true,
    dict    = 'anim@amb@clubhouse@tutorial@bkr_tut_ig3@',
    clip    = 'machinic_loop_mechandplayer',
    prop    = 'prop_tool_screwdvr',           -- attached to the right hand (false = no prop)
    bone    = 28422,                          -- IK_R_Hand
    offset  = { x = 0.13, y = 0.02, z = -0.02 },
    rot     = { x = -80.0, y = 0.0, z = 0.0 },
}

-- =====================================================================
-- ALARM ON FAILURE  (the car's own alarm goes off when you get caught)
-- =====================================================================
Config.Alarm = {
    enabled  = true,
    duration = 8, -- seconds
}

-- =====================================================================
-- REQUIRED ITEM  (ox_inventory) — OFF by default (needs the item to exist)
-- =====================================================================
Config.RequireItem = {
    enabled     = false,
    item        = 'lockpick',
    breakChance = 40,  -- % chance to consume/break the item on FAILURE
}

-- =====================================================================
-- SKILL XP REWARD  (cbz_skills)
-- =====================================================================
-- On a successful hotwire the server grants XP. If cbz_skills is running it
-- calls exports.cbz_skills:AddXp(src, amount); otherwise it fires
-- TriggerEvent(Config.Skills.event, src, amount) so you can hook any system.
Config.Skills = {
    enabled = true,
    amount  = 10,
    event   = 'cbz_hotwire:reward', -- fallback only (when cbz_skills isn't started)
}

-- =====================================================================
-- SKILL-BASED DIFFICULTY  (cbz_skills) — higher skill ⇒ easier minigame
-- =====================================================================
-- Reads the player's level in a cbz_skills skill and eases the minigame
-- (wider zones/tolerances, slower needle, slower digits, a bit more time).
-- There is no dedicated "larceny" skill in cbz_skills yet, so point skillId at
-- whichever skill you want to represent theft experience (or add one).
Config.SkillDifficulty = {
    enabled  = true,
    skillId  = 'killswitch', -- cbz_skills skill id that grants the bonus
    maxLevel = 5,            -- level at which the easing is fully applied
    strength = 1.0,          -- 0..1 — global scale of the easing (0 = off)
}

-- =====================================================================
-- SECURITY  (server-side sanity checks — can't fully stop a modded client,
-- but rejects impossible successes and rate-limits + logs abuse)
-- =====================================================================
Config.Security = {
    minSuccessMs = 1500, -- a "success" faster than this is flagged, not rewarded
    cooldownMs   = 4000, -- min time between two attempts from the same player
}

-- =====================================================================
-- DISCORD LOGS  — OFF by default (paste your webhook URL)
-- =====================================================================
Config.Logs = {
    enabled = false,
    webhook = '',
    botName = 'CBz Hotwire',
}

-- =====================================================================
-- DIFFICULTY → TIMER (ms)  — total time to complete a minigame
-- =====================================================================
Config.Duration = {
    easy   = 25000,
    medium = 20000,
    hard   = 15000,
}

-- =====================================================================
-- PER-MINIGAME DIFFICULTY
-- =====================================================================
-- screw : steps = number of catch zones to lock in a row
--         tol   = catch-zone half-width in degrees (bigger = easier to find)
--         hold  = ms you must hold inside a zone to lock it
--
-- spark : tap the wires together when the current-gauge needle is in the green
--         zone. rounds = how many wires to spark in a row; zone = green-zone
--         width as a fraction of the gauge (smaller = harder); speed = needle
--         speed in gauge-widths/sec (higher = harder). Zone shrinks + needle
--         speeds up each round. One miss = fail.
--
-- immo  : digits  = length of the security code
--         cycleMs = digit scroll speed (LOWER = faster = harder)
--         penalty = cycleMs multiplier applied on a wrong click
--                   (LOWER = harsher; 1.0 = no penalty)
Config.Games = {
    screw = {
        easy   = { steps = 3, tol = 40, hold = 350 },
        medium = { steps = 4, tol = 30, hold = 400 },
        hard   = { steps = 5, tol = 22, hold = 450 },
    },
    spark = {
        easy   = { rounds = 3, zone = 0.22, speed = 0.85 },
        medium = { rounds = 4, zone = 0.17, speed = 1.05 },
        hard   = { rounds = 5, zone = 0.13, speed = 1.30 },
    },
    immo = {
        easy   = { digits = 4, cycleMs = 140, penalty = 0.92 },
        medium = { digits = 5, cycleMs = 110, penalty = 0.90 },
        hard   = { digits = 6, cycleMs = 85,  penalty = 0.88 },
    },
}
