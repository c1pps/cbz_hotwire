const RESOURCE = (typeof GetParentResourceName === "function") ? GetParentResourceName() : "cbz_hotwire";

var resultPosted = false

function postResult(ok) {
    if (resultPosted) return
    resultPosted = true
    $.post(`https://${RESOURCE}/result`, JSON.stringify({ result: ok }));
    if (typeof window.__onHwResult === "function") window.__onHwResult(ok); // dev harness hook (no-op in game)
}

function setHint(text) {
    $("#hintText").text(text)
}

/* ---- Synthesised sound effects (Web Audio, no files). Fully guarded so a
   missing/blocked AudioContext can never break the gameplay. ---- */
var _actx = null, sndOn = true, sndVol = 0.5
function audioCtx() {
    try {
        if (!_actx) { var C = window.AudioContext || window.webkitAudioContext; if (!C) return null; _actx = new C() }
        if (_actx.state === "suspended" && _actx.resume) _actx.resume()
        return _actx
    } catch (e) { return null }
}
function tone(f1, f2, dur, type, vol) {
    if (!sndOn) return
    var ctx = audioCtx(); if (!ctx) return
    try {
        var o = ctx.createOscillator(), g = ctx.createGain(), t0 = ctx.currentTime
        o.type = type || "square"
        o.frequency.setValueAtTime(f1, t0)
        if (f2) o.frequency.exponentialRampToValueAtTime(Math.max(1, f2), t0 + dur)
        var peak = Math.max(0.0001, (vol == null ? 0.4 : vol) * sndVol)
        g.gain.setValueAtTime(0.0001, t0)
        g.gain.exponentialRampToValueAtTime(peak, t0 + 0.008)
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
        o.connect(g); g.connect(ctx.destination)
        o.start(t0); o.stop(t0 + dur + 0.03)
    } catch (e) {}
}
function noiseBurst(dur, vol, hp) {
    if (!sndOn) return
    var ctx = audioCtx(); if (!ctx) return
    try {
        var n = Math.max(1, Math.floor(ctx.sampleRate * dur))
        var buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0)
        for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n)
        var s = ctx.createBufferSource(); s.buffer = buf
        var g = ctx.createGain(); g.gain.value = (vol == null ? 0.3 : vol) * sndVol
        var f = ctx.createBiquadFilter(); f.type = "highpass"; f.frequency.value = hp || 1200
        s.connect(f); f.connect(g); g.connect(ctx.destination)
        s.start()
    } catch (e) {}
}
function sfx(type) {
    if (!sndOn) return
    if (type === "good") tone(720, 1100, 0.09, "square", 0.32)
    else if (type === "lock") tone(320, 230, 0.05, "square", 0.4)
    else if (type === "zap") { noiseBurst(0.09, 0.32, 1500); tone(1400, 300, 0.09, "sawtooth", 0.28) }
    else if (type === "fail") { tone(180, 110, 0.42, "square", 0.4) }
    else if (type === "start") {
        tone(95, 55, 0.5, "sawtooth", 0.42); noiseBurst(0.4, 0.18, 500)
        setTimeout(function () { tone(660, 990, 0.14, "square", 0.32) }, 130)
    }
}

var inminigame = false
var pressedScrewdriver = false
var notstarted = true
var finished = false
var interval
var stopMinigameSlideTimeout
var stopMinigameResetTimeout
var currentGame = "screw"
var failOnMistake = true // a single wrong input fails the whole minigame
var GAME_EL = { screw: "#gameScrew", spark: "#gameSpark", immo: "#gameImmo" }

// Instantly fail the minigame (wrong input) → reports failure and closes.
function failNow(msg) {
    if (finished || !inminigame) return
    finished = true
    sfx("fail")
    setHint(msg || "Failed!")
    postResult(false)
    clearInterval(interval)
    stopMinigame()
}

const mouse = {
    x: 0,
    y: 0,
    ox: 0,
    oy: 0,
    down: false
};
["down", "up", "move"].forEach(name => document.addEventListener("mouse" + name, mouseEvents));

function mouseEvents(e) {
    if (!inminigame) return
    if (finished) return
    mouse.x = e.pageX;
    mouse.y = e.pageY;
    // Derive button state from the event itself (e.buttons bit 0 = LMB) so a
    // swallowed mouseup can never leave mouse.down stuck true in CEF.
    if (typeof e.buttons === "number") {
        mouse.down = (e.buttons & 1) === 1
    } else {
        mouse.down = e.type === "mousedown" ? true : e.type === "mouseup" ? false : mouse.down;
    }
    if (e.type === "mousedown") {
        // fresh grab: never accumulate an angle jump from the previous position
        mouse.ox = mouse.x;
        mouse.oy = mouse.y;
    }
    if (currentGame === "screw") {
        if (notstarted) return
        updateScrew()
    }
    // wires is click-based now — handled in the document click handler.
}

/* ============================== SCREWDRIVER ============================== */

// Exact swept angle around the pivot between two cursor positions.
// atan2-based: never NaN, correct for any per-event angle (an asin
// cross-product version returns NaN on float rounding past ±1, which froze
// the dial permanently, and was wrong past 90° per mouse event).
function getAngleBetween(cx, cy, ox, oy, mx, my) {
    var a1 = Math.atan2(oy - cy, ox - cx);
    var a2 = Math.atan2(my - cy, mx - cx);
    var d = a2 - a1;
    if (d > Math.PI) d -= 2 * Math.PI;
    if (d < -Math.PI) d += 2 * Math.PI;
    return d;
}

var cw, ch;
var angle = 0
var seq = []
var stepIndex = 0
var SENSITIVITY = 1 // 1:1 — the dial follows the cursor's real angle around the keyhole
var TOL = 30        // catch-zone half-width in display degrees (set per difficulty)
var HOLD_MS = 400   // time the dial must be held inside the zone to lock the step
var zoneSince = null
var stepStartAngle = 0

function currentDisp() {
    return (angle * 180 / Math.PI) * SENSITIVITY
}

function flashGreen() {
    $("#rotatingCircle").css("-webkit-filter", "drop-shadow(0 0 0.55vw rgba(25, 219, 22, 1.0))")
    setTimeout(function() {
        $("#rotatingCircle").css("-webkit-filter", "drop-shadow(0 0 0.55vw rgba(255, 255, 255, 1.0))")
    }, 350)
}

function arrowForDir(dir) {
    $("#rotatingCircle").css("background-image", dir > 0 ? "url(\"./assets/Rotate-1.png\")" : "url(\"./assets/Rotate-2.png\")")
}

function slipFlash() {
    sfx("lock")
    $("#rotatingCircle").css("-webkit-filter", "drop-shadow(0 0 0.55vw rgba(230, 40, 40, 1.0))")
    setTimeout(function() {
        $("#rotatingCircle").css("-webkit-filter", "drop-shadow(0 0 0.55vw rgba(255, 255, 255, 1.0))")
    }, 350)
}

function lockStep() {
    stepIndex++
    zoneSince = null
    stepStartAngle = angle
    flashGreen()
    if (stepIndex >= seq.length) {
        finished = true
        setHint("Engine started!")
        stopMinigame()
    } else {
        sfx("good")
        arrowForDir(seq[stepIndex].dir)
        setHint("Now spin the other way! (" + (stepIndex + 1) + "/" + seq.length + ")")
    }
}

// The skill core: each step has an invisible catch zone around its target.
// Enter it slowly and HOLD for HOLD_MS to lock. Blow past it (fast spinning)
// and the lock slips: red flash, dial snaps back to the step's start.
function checkStep() {
    if (finished || notstarted || stepIndex >= seq.length) return
    var disp = currentDisp()
    var step = seq[stepIndex]
    var lo = step.target - TOL, hi = step.target + TOL
    var overshot = step.dir > 0 ? disp > hi : disp < lo
    if (overshot) {
        angle = stepStartAngle
        zoneSince = null
        $("#rotatingCircle").css("transform", "rotate(" + currentDisp() + "deg)")
        slipFlash()
        setHint("Slipped! Turn slowly… (" + (stepIndex + 1) + "/" + seq.length + ")")
        return
    }
    if (disp >= lo && disp <= hi) {
        if (zoneSince === null) {
            zoneSince = Date.now()
            $("#rotatingCircle").css("-webkit-filter", "drop-shadow(0 0 0.55vw rgba(25, 219, 22, 1.0))")
            setHint("Hold it!")
        } else if (Date.now() - zoneSince >= HOLD_MS) {
            lockStep()
        }
    } else if (zoneSince !== null) {
        zoneSince = null
        $("#rotatingCircle").css("-webkit-filter", "drop-shadow(0 0 0.55vw rgba(255, 255, 255, 1.0))")
        setHint("Spin following the arrow (" + (stepIndex + 1) + "/" + seq.length + ")")
    }
}

function updateScrew() {
    // Pivot on the keyhole (rotating circle center), not the screen center —
    // players naturally spin the mouse around the ignition graphic.
    var rect = rotatingCircle.getBoundingClientRect();
    cw = rect.left + rect.width / 2;
    ch = rect.top + rect.height / 2;
    var change = 0;
    if (mouse.down) {
        // Dead zone: angles are meaningless when the cursor crosses the pivot.
        var deadZone = rect.width * 0.35;
        var distNew = Math.hypot(mouse.x - cw, mouse.y - ch);
        var distOld = Math.hypot(mouse.ox - cw, mouse.oy - ch);
        if (distNew > deadZone && distOld > deadZone) {
            change = getAngleBetween(cw, ch, mouse.ox, mouse.oy, mouse.x, mouse.y);
            angle += change;
        }
    }

    var disp = (angle * 180 / Math.PI) * SENSITIVITY
    $("#rotatingCircle").css("transform", "rotate(" + disp + "deg)")

    mouse.ox = mouse.x;
    mouse.oy = mouse.y

    if (finished || stepIndex >= seq.length) return

    var step = seq[stepIndex]

    // screwdriver "pushed" sprite while turning in the required direction
    if (change * step.dir > 0.0025) {
        $("#smallScrewdriver").css("background-image", "url(\"./assets/Small-Screwdriver-2.png\")")
    } else {
        $("#smallScrewdriver").css("background-image", "url(\"./assets/Small-Screwdriver-1.png\")")
    }

    checkStep()
}

function initScrew(params) {
    params = params || {}
    var steps = Math.max(2, Math.min(8, params.steps || 3))
    TOL = params.tol || 30
    HOLD_MS = params.hold || 400
    // Randomized alternating sequence: spin one way, then back, then again…
    // each step a random 180-360 display-degrees (½ to 1 cursor turn) past
    // the previous target.
    seq = []
    var cum = 0
    for (var i = 0; i < steps; i++) {
        var dir = (i % 2 === 0) ? 1 : -1
        var amount = 180 + Math.floor(Math.random() * 181)
        cum += dir * amount
        seq.push({ target: cum, dir: dir })
    }
    stepIndex = 0
    stepStartAngle = 0
    zoneSince = null
    angle = 0
    arrowForDir(seq[0].dir)
    setHint("Click the screwdriver")
}

/* ============================== SPARK CONTACT (timing) ============================== */

// ---- Tap the stripped ignition wires together exactly when the current-gauge
// needle is inside the green zone. Several wires in a row; the zone shrinks and
// the needle speeds up each round. One miss = instant fail. Pure clicks.
var sparkState = null

function initSpark(params) {
    params = params || {}
    var rounds = Math.max(1, Math.min(8, params.rounds || 3))
    var baseZone = params.zone || 0.20
    var baseSpeed = params.speed || 0.95

    document.getElementById("spark").style.display = "none"
    $("#swireL, #swireR").removeClass("live")
    var pips = document.getElementById("sparkPips")
    pips.innerHTML = ""
    for (var i = 0; i < rounds; i++) {
        var d = document.createElement("div")
        d.className = "sparkpip"
        pips.appendChild(d)
    }

    sparkState = {
        rounds: rounds, round: 0,
        baseZone: baseZone, baseSpeed: baseSpeed,
        pos: Math.random(), dir: Math.random() < 0.5 ? 1 : -1,
        speed: baseSpeed, zoneStart: 0, zoneW: baseZone,
        lastTick: Date.now()
    }
    setupSparkRound()
}

function setupSparkRound() {
    var st = sparkState
    st.zoneW = Math.max(0.06, st.baseZone - st.round * 0.025)   // shrinks each round
    st.speed = st.baseSpeed + st.round * 0.14                   // faster each round
    st.zoneStart = 0.08 + Math.random() * (0.84 - st.zoneW)     // random position
    st.lastTick = Date.now()
    var zone = document.getElementById("sparkZone")
    zone.style.left = (st.zoneStart * 100) + "%"
    zone.style.width = (st.zoneW * 100) + "%"
    setHint("Tap when the needle hits the green — wire " + (st.round + 1) + "/" + st.rounds)
}

function sparkTick() {
    var st = sparkState
    if (!st || finished) return
    var now = Date.now()
    var dt = Math.min(0.05, (now - st.lastTick) / 1000)
    st.lastTick = now
    st.pos += st.dir * st.speed * dt
    if (st.pos >= 1) { st.pos = 1; st.dir = -1 }
    if (st.pos <= 0) { st.pos = 0; st.dir = 1 }
    document.getElementById("sparkNeedle").style.left = (st.pos * 100) + "%"
}

function sparkFlash() {
    $("#swireL, #swireR").addClass("live")
    setTimeout(function() { $("#swireL, #swireR").removeClass("live") }, 220)
    var pr = document.getElementById("wpanel").getBoundingClientRect()
    var gap = document.getElementById("swireGap").getBoundingClientRect()
    var sp = document.getElementById("spark")
    sp.style.left = (gap.left + gap.width / 2 - pr.left) + "px"
    sp.style.top = (gap.top + gap.height / 2 - pr.top) + "px"
    sp.style.display = "block"
    setTimeout(function() { sp.style.display = "none" }, 240)
}

function sparkTap() {
    var st = sparkState
    if (!st || finished) return
    if (st.pos >= st.zoneStart && st.pos <= st.zoneStart + st.zoneW) {
        sfx("zap")
        sparkFlash()
        document.getElementById("sparkPips").children[st.round].classList.add("done")
        st.round++
        if (st.round >= st.rounds) {
            finished = true
            setHint("Engine started!")
            stopMinigame()
        } else {
            setupSparkRound()
        }
    } else {
        if (failOnMistake) {
            failNow("Missed the contact — alarm tripped!")
        } else {
            setHint("Missed! Time it better")
        }
    }
}

/* ============================== IMMOBILISER ============================== */

var immoState = null

function initImmo(params) {
    params = params || {}
    var cycle = params.cycleMs || 110
    var digits = Math.max(3, Math.min(8, params.digits || 5))
    var penalty = params.penalty || 0.90
    var code = []
    for (var i = 0; i < digits; i++) code.push(Math.floor(Math.random() * 10))
    document.getElementById("immoTarget").textContent = "CODE " + code.join(" ")
    var slots = document.getElementById("immoSlots")
    slots.innerHTML = ""
    for (var k = 0; k < digits; k++) {
        var s = document.createElement("div")
        s.className = "islot"
        s.textContent = "–"
        slots.appendChild(s)
    }
    immoState = {
        code: code,
        idx: 0,
        digit: Math.floor(Math.random() * 10),
        cycleMs: cycle,
        penalty: penalty,
        lastTick: Date.now()
    }
    renderImmo()
    setHint("Click when the digit matches the code")
}

function renderImmo() {
    var st = immoState
    if (!st) return
    var slots = document.getElementById("immoSlots").children
    for (var i = 0; i < slots.length; i++) {
        if (i < st.idx) { slots[i].textContent = st.code[i]; slots[i].className = "islot locked" }
        else if (i === st.idx) { slots[i].textContent = st.digit; slots[i].className = "islot" }
        else { slots[i].textContent = "–"; slots[i].className = "islot" }
    }
}

function immoTick() {
    var st = immoState
    if (!st || finished) return
    if (Date.now() - st.lastTick >= st.cycleMs) {
        st.lastTick = Date.now()
        st.digit = (st.digit + 1) % 10
        renderImmo()
    }
}

function immoLockAttempt() {
    var st = immoState
    if (!st || finished) return
    if (st.digit === st.code[st.idx]) {
        st.idx++
        if (st.idx >= st.code.length) {
            renderImmo()
            finished = true
            setHint("Access granted — engine started!")
            stopMinigame()
            return
        }
        sfx("good")
        st.digit = Math.floor(Math.random() * 10)
        st.lastTick = Date.now()
        renderImmo()
        setHint("Next digit… (" + (st.idx + 1) + "/" + st.code.length + ")")
    } else {
        var slot = document.getElementById("immoSlots").children[st.idx]
        slot.classList.add("err")
        if (failOnMistake) {
            failNow("Wrong code — alarm tripped!")
        } else {
            setTimeout(function() { slot.classList.remove("err") }, 300)
            st.cycleMs = Math.max(50, Math.round(st.cycleMs * st.penalty))
            setHint("Wrong digit! It cycles faster now…")
        }
    }
}

/* ============================== SHARED FLOW ============================== */

function hardReset() {
    clearInterval(interval)
    clearTimeout(stopMinigameSlideTimeout)
    clearTimeout(stopMinigameResetTimeout)
    $("#rotatingCircle").stop(true, true).hide()
    $("#main").css("right", "-40vw")
    pressedScrewdriver = false
    $("#gameScrew").css("background-image", "")
    $("#rotatingCircle").css("background-image", "url(\"./assets/Rotate-1.png\")")
    $("#bigScrewdriver").css("filter", "drop-shadow(0 0 0.55vw rgba(255, 255, 255, 1.0))")
    $("#bigScrewdriver").css("top", "14vw")
    $("#bigScrewdriver").css("left", "-3.5vw")
    $("#bigScrewdriver").css("pointer-events", "all")
    $("#timerBar").css("transition", "none")
    $("#timerBar").css("width", "0%")
    $("#bigScrewdriver").show()
    $("#smallScrewdriver").hide()
    $("#crackedKeyHole").hide()
    $(".game").hide()
    document.getElementById("spark").style.display = "none"
    $("#swireL, #swireR").removeClass("live")
    document.getElementById("sparkPips").innerHTML = ""
    document.getElementById("sparkNeedle").style.left = "0%"
    document.getElementById("immoSlots").innerHTML = ""
    document.getElementById("immoTarget").textContent = ""
    sparkState = null
    immoState = null
    notstarted = true
    finished = false
    inminigame = false
    angle = 0
    seq = []
    stepIndex = 0
    stepStartAngle = 0
    zoneSince = null
    mouse.down = false
    resultPosted = false
    setHint("")
}

function startGame(ms, game, params) {
    if (inminigame) return
    inminigame = true
    resultPosted = false
    currentGame = (game === "spark" || game === "immo") ? game : "screw"
    $(".game").hide()
    $(GAME_EL[currentGame]).show()
    $("#main").css("right", "0vw")
    if (currentGame === "screw") {
        initScrew(params) // notstarted stays true until the screwdriver is clicked
    } else if (currentGame === "spark") {
        notstarted = false
        initSpark(params)
    } else {
        notstarted = false
        initImmo(params)
    }
    $("#timerBar").css("transition", "width " + ms + "ms linear")
    $("#timerBar").css("width", "100%")
    interval = setInterval(function() {
        if (currentGame === "screw") checkStep() // hold-to-lock must complete even when the mouse is still
        else if (currentGame === "spark") sparkTick()
        else if (currentGame === "immo") immoTick()
        if ((100 * Number($("#timerBar").css("width").replace('px',"")) / window.innerWidth) >= 23.45) {
            sfx("fail")
            postResult(false)
            setHint("Too slow!")
            stopMinigame()
            clearInterval(interval)
            console.log("failed")
        }
        if (finished) {
            if (currentGame === "screw") $("#gameScrew").css("background-image","url(./assets/LitUpDashboard.png)")
            sfx("start")
            postResult(true)
            clearInterval(interval)
            console.log("finished")
        }
    }, 10)
}

function stopMinigame() {
    $("#rotatingCircle").fadeOut(250)
    stopMinigameSlideTimeout = setTimeout(function() {
        $("#main").css("right", "-40vw")
    }, 500)
    stopMinigameResetTimeout = setTimeout(function() {
        hardReset()
    }, 1000)
}

document.addEventListener("keydown", function (e) {
    if (!inminigame || finished) return;
    if (e.key === "Escape") {
        clearInterval(interval);
        postResult(false);
        stopMinigame();
    }
});

$(document).click(function(event) {
    audioCtx() // a click is a user gesture — lets the audio context start
    var targetID = event.target.id
    if (currentGame === "screw" && targetID == "bigScrewdriver" && !pressedScrewdriver) {
        pressedScrewdriver = true
        setHint("Hold click & spin following the arrow (1/" + seq.length + ")")
        $("#bigScrewdriver").css("filter", "none")
        $("#bigScrewdriver").css("top", "12.25vw")
        $("#bigScrewdriver").css("left", "0.4vw")
        setTimeout(function() {
            $("#bigScrewdriver").hide()
            $("#bigScrewdriver").css("pointer-events", "none")
            $("#smallScrewdriver").show()
            $("#crackedKeyHole").show()
            $("#rotatingCircle").fadeIn(150)
            notstarted = false
        }, 150)
    } else if (currentGame === "spark" && inminigame && !finished && sparkState) {
        if (event.target && event.target.closest && event.target.closest(".devbar")) return
        sparkTap()
    } else if (currentGame === "immo" && inminigame && !finished && immoState) {
        if (event.target && event.target.closest && event.target.closest(".devbar")) return
        immoLockAttempt()
    }
})

$(document).ready(function() {
    window.addEventListener('message', function(event) {
        var data = event.data
        if (data.type == "start"){
            hardReset()
            failOnMistake = (data.failOnMistake !== false) // default true
            if (data.sound) { sndOn = data.sound.enabled !== false; sndVol = (typeof data.sound.volume === "number") ? data.sound.volume : 0.5 }
            audioCtx() // warm up / resume the audio context
            startGame(data.duration, data.game, data.params)
        }
        if (data.type == "stop"){
            stopMinigame()
        }
    });
});
