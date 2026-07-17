# cbz_hotwire

![cbz_hotwire](media/thumbnail.png)

**Free & open-source (GPL-3.0).** Retro comic-style hotwire minigames for
FiveM — three games, auto-picked by vehicle class. Drop-in for
**wasabi_carlock** (see Install), and standalone via a single export for
anything else. No dependencies.

- **screw** — screwdriver in the ignition barrel: spin to the invisible catch
  zones, hold to lock, slip back if you rush (old cars, trucks, utility)
- **spark** — under-dash spark contact: tap the stripped ignition wires
  together (click) exactly when the current-gauge needle is in the green zone;
  several wires in a row, the zone shrinks and the needle speeds up each round.
  One miss = fail (average cars). Pure clicks.
- **immo** — immobiliser bypass: lock each scrolling digit of the security
  code with precise timing (sports, super, emergency, military)

Developed by wthejulio · CBz Network.
Screwdriver minigame derived from B01_CTWHotWire by Binary 01 Studios
(gush3l), licensed GPL-3.0 — see LICENSE.

## Config

All tuning lives in `config.lua`:
- `Config.Categories` — group GTA vehicle classes into named categories
  (economy / average / sport / luxury / special).
- `Config.CategorySettings` — per category, which minigames may appear
  (`games = { 'screw', 'spark', 'immo' }`, one picked at random) and the
  `difficulty`. `Config.DefaultCategory` covers unlisted classes.
- `Config.Duration` — timer per difficulty (easy/medium/hard).
- `Config.Games.screw/spark/immo` — per-difficulty parameters of each minigame.
- `Config.FailOnMistake` — one wrong input instantly fails the minigame.
- `Config.Sound` — synthesised UI sound effects (no files) — `{ enabled, volume }`.
- `Config.Animation` — thief anim + tool prop while hotwiring (`dict/clip/prop/bone/offset/rot`).
- `Config.Alarm` — the car's own alarm goes off on failure (`{ enabled, duration }`).
- `Config.RequireItem` — need an ox_inventory item to hotwire; may break on fail (OFF by default).
- `Config.Skills` — fire an XP-reward event on success; wire it to your skill system (OFF by default).
- `Config.Security` — server rate-limit + reject impossibly-fast successes.
- `Config.Logs` — Discord webhook logging of attempts (OFF by default).

Police alerts are left to wasabi_carlock (`Config.notifyPolice.hotwire` in its
own config) — cbz_hotwire has no dispatch dependency.

## Install (wasabi_carlock)

1. Drop `cbz_hotwire` in your resources and `ensure cbz_hotwire`.
2. wasabi_carlock's hotwire is escrowed, so it's hooked through the bridge's
   customization file — the extension point Wasabi provides for exactly this.
   Open `wasabi_bridge/customize/client/skillCheck.lua` and paste this at the
   very top of `WSB.skillCheck(data)`:

```lua
    -- cbz_hotwire — hand wasabi_carlock's hotwire off to the minigame.
    -- Hotwiring only happens from wasabi_carlock while in the DRIVER seat
    -- (its lockpick is done outside the car), so everything else falls through.
    if GetResourceState("cbz_hotwire") == "started" then
        local invoker = GetInvokingResource and GetInvokingResource() or nil
        if invoker == "wasabi_carlock" or invoker == nil then
            local ped = PlayerPedId()
            local veh = GetVehiclePedIsIn(ped, false)
            if veh ~= 0 and GetPedInVehicleSeat(veh, -1) == ped then
                return exports.cbz_hotwire:startMinigame() or false
            end
        end
    end
```

That's it — lockpick and every other skill check keep using your normal one.

## Exports (client)

Standalone: any script can call it, wasabi is not required.

- `exports.cbz_hotwire:startMinigame(game, difficulty, isTest)` → `boolean` (blocking)
  - `game` = `"screw" | "spark" | "immo"` (nil ⇒ random from the vehicle category)
  - `difficulty` = `"easy" | "medium" | "hard"` (nil ⇒ the vehicle category's difficulty)
  - `isTest` = truthy to skip the server result + alarm (used by /hwtest)
- `exports.cbz_hotwire:stopMinigame()`

## Test commands (ESX staff groups)

- `/hwtest [easy|medium|hard] [screw|spark|immo]` — force a specific game/difficulty; no args = like a real hotwire (by category)
- `/hwstop` — force-close the minigame and release NUI focus
