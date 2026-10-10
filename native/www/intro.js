/**
 * Retro 8-bit intro, shared by the installed web app and the Capacitor
 * Android/iOS shells.
 *
 * Deliberately framework-free: `native/www/intro.js` is a copy of this file so
 * the native shells can play it from the app bundle before any network request
 * finishes. Run `npm run native:assets` after editing.
 *
 * The house is painted on ONE canvas instead of ~95 individually animated DOM
 * nodes. Ninety-five simultaneous compositor layers made low-end phones drop
 * frames; a single canvas draws the same thing in a few hundred fillRects.
 */
(function () {
  "use strict";

  // 13x12 pixel-art house. Rows 0-6 are the roof, 7-11 the walls + doorway.
  var ART = [
    "......X......",
    ".....XXX.....",
    "....XXXXX....",
    "...XXXXXXX...",
    "..XXXXXXXXX..",
    ".XXXXXXXXXXX.",
    "XXXXXXXXXXXXX",
    ".XXXXXXXXXXX.",
    ".XXXXXXXXXXX.",
    ".XXXX...XXXX.",
    ".XXXX...XXXX.",
    ".XXXX...XXXX."
  ];

  var COLS = 13;
  var ROWS = 12;
  var GOLD = "#e8a020";
  var TERRA = "#c8705e";

  /** Head-room around the house so blocks can fly in from off-canvas. */
  var PAD = 240;

  var LAND_MS = 520;
  var ROW_STAGGER = 52;
  var IMPACT_MS = 340;
  var TEXT = "STAYWITHME";
  var LETTER_MS = 62;
  var WORD_GAP_MS = 90;
  var BAR_CELLS = 12;
  var BAR_TICK_MS = 110;

  /** Matches the Android shell's minimum splash time. */
  var HOLD_MS = 2600;

  /* ---- hologram turntable ---------------------------------------------- */

  var TAU = Math.PI * 2;

  /** Angular velocity eases in over this long so the spin doesn't snap on. */
  var SPIN_RAMP_MS = 400;

  /** Perspective distance, in the same units as the block size. */
  var FOCAL = 900;

  /** Slab depth: one lit face plus two dim ghosts, so it reads as volume. */
  var SLICE_COUNT = 3;

  /** The plane never fully collapses edge-on; it keeps a bright sliver. */
  var EDGE_FLOOR = 0.2;

  /** Scan band sweep period. */
  var BAND_MS = 1600;

  // Odd count so the middle step is the untouched brand colour — that is what
  // the assembly hands over at, so the transition has nothing to pop.
  var SHADE_STEPS = 9;

  function mixHex(hex, target, f) {
    var r = parseInt(hex.slice(1, 3), 16);
    var g = parseInt(hex.slice(3, 5), 16);
    var b = parseInt(hex.slice(5, 7), 16);
    return (
      "rgb(" +
      Math.round(r + (target[0] - r) * f) +
      "," +
      Math.round(g + (target[1] - g) * f) +
      "," +
      Math.round(b + (target[2] - b) * f) +
      ")"
    );
  }

  /**
   * Depth shading, precomputed. The far side of the turntable darkens and the
   * near side blooms toward white, which is what sells the rotation — the brand
   * gold and terracotta stay recognisable at every step.
   */
  function buildShades(hex) {
    var out = [];
    for (var i = 0; i < SHADE_STEPS; i++) {
      var f = i / (SHADE_STEPS - 1);
      out.push(
        f < 0.5
          ? mixHex(hex, [18, 11, 9], (0.5 - f) * 1.15)
          : mixHex(hex, [255, 250, 240], (f - 0.5) * 0.75)
      );
    }
    return out;
  }

  var GOLD_SHADES = buildShades(GOLD);
  var TERRA_SHADES = buildShades(TERRA);

  /** Ramped spin so angular velocity starts at 0 and settles at 1. */
  function spinPhase(t) {
    if (t <= 0) return 0;
    return t < SPIN_RAMP_MS ? (t * t) / (2 * SPIN_RAMP_MS) : t - SPIN_RAMP_MS / 2;
  }

  var STYLE_ID = "swm-intro-style";

  var CSS =
    ".swm-intro{--swm-px:clamp(7px,2.6vmin,13px);position:fixed;inset:0;" +
    "z-index:2147483000;display:flex;flex-direction:column;align-items:center;" +
    "justify-content:center;gap:calc(var(--swm-px)*2.6);color-scheme:dark;" +
    "background-color:#140f0d;background-image:" +
    "linear-gradient(rgba(200,112,94,.07) 1px,transparent 1px)," +
    "linear-gradient(90deg,rgba(200,112,94,.07) 1px,transparent 1px);" +
    "background-size:calc(var(--swm-px)*2) calc(var(--swm-px)*2);" +
    "font-family:ui-monospace,'Courier New',Courier,monospace;overflow:hidden;" +
    "-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;" +
    "transition:opacity .42s ease}" +
    ".swm-intro--hiding{opacity:0;pointer-events:none}" +

    ".swm-intro__house{position:relative;width:calc(var(--swm-px)*13);" +
    "height:calc(var(--swm-px)*12)}" +
    ".swm-intro__house>canvas{position:absolute;left:-" + PAD + "px;top:-" + PAD + "px;" +
    "width:calc(var(--swm-px)*13 + " + PAD * 2 + "px);" +
    "height:calc(var(--swm-px)*12 + " + PAD * 2 + "px)}" +

    ".swm-intro__word{display:flex;gap:calc(var(--swm-px)*.22);" +
    "font-size:calc(var(--swm-px)*2.1);font-weight:900;letter-spacing:.06em;color:#fff6ee}" +
    ".swm-intro__word span{opacity:0;will-change:transform,opacity;" +
    "text-shadow:calc(var(--swm-px)*.22) calc(var(--swm-px)*.22) 0 #7d3527;" +
    "animation:swm-drop .46s cubic-bezier(.2,1.7,.38,1) forwards}" +
    ".swm-intro__word span.is-hi{color:" + GOLD + "}" +
    "@keyframes swm-drop{from{opacity:0;transform:translateY(calc(var(--swm-px)*-3.4)) scaleY(1.6) scaleX(.7)}" +
    "55%{opacity:1}70%{transform:translateY(0) scaleY(.72) scaleX(1.25)}" +
    "to{opacity:1;transform:translateY(0) scale(1)}}" +

    ".swm-intro__load{display:flex;flex-direction:column;align-items:center;" +
    "gap:calc(var(--swm-px)*.8);opacity:0;animation:swm-fadein .4s ease forwards}" +
    "@keyframes swm-fadein{to{opacity:1}}" +
    ".swm-intro__bar{display:flex;gap:calc(var(--swm-px)*.3);padding:calc(var(--swm-px)*.3);" +
    "border:calc(var(--swm-px)*.22) solid rgba(255,246,238,.32)}" +
    ".swm-intro__bar i{display:block;width:calc(var(--swm-px)*.9);" +
    "height:calc(var(--swm-px)*.72);background:rgba(255,246,238,.12)}" +
    ".swm-intro__bar i.is-on{background:" + GOLD + "}" +
    ".swm-intro__tip{font-size:calc(var(--swm-px)*.92);letter-spacing:.34em;" +
    "font-weight:700;color:rgba(255,246,238,.55);animation:swm-blink 1.05s steps(1) infinite}" +
    "@keyframes swm-blink{50%{opacity:.28}}" +

    /* Scanlines roll via transform only. Animating background-position forced a
       full-screen repaint every frame, which was most of the visible stutter. */
    ".swm-intro__scan{position:absolute;left:0;right:0;top:-4px;height:calc(100% + 8px);" +
    "pointer-events:none;z-index:9;will-change:transform;" +
    "background:repeating-linear-gradient(0deg,rgba(0,0,0,.28) 0 2px,transparent 2px 4px);" +
    "animation:swm-roll 7s linear infinite}" +
    "@keyframes swm-roll{to{transform:translate3d(0,4px,0)}}" +
    ".swm-intro__vig{position:absolute;inset:0;pointer-events:none;z-index:8;" +
    "background:radial-gradient(ellipse at center,transparent 45%,rgba(0,0,0,.65) 100%)}" +

    "@media (prefers-reduced-motion:reduce){" +
    ".swm-intro__word span{animation-duration:.01ms!important;opacity:1!important}" +
    ".swm-intro__scan,.swm-intro__tip{animation:none!important}}";

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  /** Seeded PRNG so every launch — and every platform — assembles identically. */
  function rng(seed) {
    return function () {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function buildBlocks() {
    var rand = rng(0x57414d);
    var blocks = [];
    var byCol = [];
    var maxDelay = 0;

    for (var i = 0; i < COLS; i++) byCol.push([]);

    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        if (ART[r].charAt(c) !== "X") continue;

        var angle = rand() * Math.PI * 2;
        var distance = 60 + rand() * 130;
        // Build top-down so the roof lands before the walls.
        var delay = r * ROW_STAGGER + rand() * 40;
        if (delay > maxDelay) maxDelay = delay;

        var block = {
          col: c,
          row: r,
          dx: Math.cos(angle) * distance,
          dy: Math.sin(angle) * distance - 40,
          rot: ((rand() * 200 - 100) * Math.PI) / 180,
          delay: delay,
          color: r <= 6 ? GOLD : TERRA
        };

        blocks.push(block);
        byCol[c].push(block);
      }
    }

    return { blocks: blocks, byCol: byCol, settled: maxDelay + LAND_MS };
  }

  /** Overshoot easing, the canvas equivalent of cubic-bezier(.18,1.5,.4,1). */
  function backOut(t) {
    var c1 = 1.70158;
    var c3 = c1 + 1;
    var u = t - 1;
    return 1 + c3 * u * u * u + c1 * u * u;
  }

  function paintBlock(ctx, x, y, size, bevel, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, size, size);
    // Chunky bevel: light top-left, dark bottom-right — classic 16-bit shading.
    ctx.fillStyle = "rgba(255,255,255,.28)";
    ctx.fillRect(x, y, size, bevel);
    ctx.fillRect(x, y, bevel, size);
    ctx.fillStyle = "rgba(0,0,0,.3)";
    ctx.fillRect(x, y + size - bevel, size, bevel);
    ctx.fillRect(x + size - bevel, y, bevel, size);
  }

  function mount(root, options) {
    options = options || {};
    var loop = options.loop !== false;
    var onDone = typeof options.onDone === "function" ? options.onDone : null;

    injectStyles();

    // classList.add, never `className =`: the web overlay also carries
    // `swm-intro-root`, and that class is what the stylesheet uses to hide the
    // element again once the intro is done. Clobbering it strands the app
    // behind a full-screen dark layer.
    root.classList.add("swm-intro");
    root.innerHTML =
      '<div class="swm-intro__house"><canvas></canvas></div>' +
      '<div class="swm-intro__word" role="img" aria-label="StayWithMe"></div>' +
      '<div class="swm-intro__load"><div class="swm-intro__bar"></div>' +
      '<div class="swm-intro__tip">LOADING</div></div>' +
      '<div class="swm-intro__scan"></div><div class="swm-intro__vig"></div>';

    var houseEl = root.children[0];
    var canvas = houseEl.children[0];
    var ctx = canvas.getContext("2d");
    var wordEl = root.children[1];
    var loadEl = root.children[2];
    var barEl = loadEl.children[0];

    var built = buildBlocks();
    var blocks = built.blocks;
    var byCol = built.byCol;
    var settled = built.settled;
    var wordEnd = settled + WORD_GAP_MS + TEXT.length * LETTER_MS;
    var restingAt = settled + IMPACT_MS;

    // Half a turn by the time the web overlay dismisses, so it hands over
    // facing forward. The house art is horizontally symmetric, so 180 degrees
    // reads the same as 0. Native shells keep spinning until the site loads.
    var spinPeriod = 2 * spinPhase(Math.max(HOLD_MS - restingAt, 600));

    var reduced = !!(
      window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );

    var px = 1;
    var cssW = 1;
    var cssH = 1;
    var glowGrad = null;
    var bandGrad = null;

    function measure() {
      px = houseEl.clientWidth / COLS || 10;
      cssW = COLS * px + PAD * 2;
      cssH = ROWS * px + PAD * 2;
      // Cap DPR: a 3x canvas costs real fill-rate on phones for no visible gain.
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Gradients are rebuilt only on resize; allocating them per frame would
      // churn the GC for no visual gain.
      var cx = PAD + (COLS * px) / 2;
      var cyMid = PAD + (ROWS * px) / 2;
      var glowR = COLS * px * 1.45;
      glowGrad = ctx.createRadialGradient(cx, cyMid, px, cx, cyMid, glowR);
      glowGrad.addColorStop(0, "rgba(232,160,32,0.34)");
      glowGrad.addColorStop(0.45, "rgba(200,112,94,0.13)");
      glowGrad.addColorStop(1, "rgba(200,112,94,0)");

      var bandH = px * 1.7;
      bandGrad = ctx.createLinearGradient(0, 0, 0, bandH);
      bandGrad.addColorStop(0, "rgba(255,214,140,0)");
      bandGrad.addColorStop(0.5, "rgba(255,226,170,0.30)");
      bandGrad.addColorStop(1, "rgba(255,214,140,0)");
    }

    function render(elapsed) {
      ctx.clearRect(0, 0, cssW, cssH);
      if (elapsed < restingAt) renderAssembly(elapsed);
      else renderHologram(elapsed - restingAt);
    }

    function renderAssembly(elapsed) {
      var shakeX = 0;
      var shakeY = 0;
      if (elapsed >= settled && elapsed < settled + IMPACT_MS) {
        var step = Math.floor((elapsed - settled) / (IMPACT_MS / 4));
        var amp = px * 0.18;
        if (step === 0) {
          shakeX = amp;
          shakeY = px * 0.3;
        } else if (step === 1) {
          shakeX = -amp;
        } else if (step === 2) {
          shakeY = amp;
        }
      }

      var bevel = Math.max(1, px * 0.18);

      for (var i = 0; i < blocks.length; i++) {
        var b = blocks[i];
        var x = PAD + b.col * px + shakeX;
        var y = PAD + b.row * px + shakeY;
        var p = (elapsed - b.delay) / LAND_MS;

        if (p <= 0) continue;

        if (p >= 1) {
          ctx.globalAlpha = 1;
          paintBlock(ctx, x, y, px, bevel, b.color);
          continue;
        }

        var eased = backOut(p);
        var remaining = 1 - eased;
        ctx.save();
        ctx.globalAlpha = Math.min(1, p / 0.6);
        ctx.translate(x + px / 2 + b.dx * remaining, y + px / 2 + b.dy * remaining);
        ctx.rotate(b.rot * remaining);
        var scale = 0.2 + 0.8 * eased;
        ctx.scale(scale, scale);
        paintBlock(ctx, -px / 2, -px / 2, px, bevel, b.color);
        ctx.restore();
      }

      ctx.globalAlpha = 1;
    }

    /**
     * Turntable: the settled house spins about its vertical axis as a projected
     * hologram. Columns are foreshortened by cos(angle) and pushed through a
     * perspective divide; three depth slices give the flat pixel art volume.
     */
    function renderHologram(t) {
      var angle = reduced ? 0 : (TAU * spinPhase(t)) / spinPeriod;
      var cosA = Math.cos(angle);
      var sinA = Math.sin(angle);
      var absCos = Math.abs(cosA);

      // Ease the projection treatment in, otherwise the glow and depth shading
      // pop the instant the last block lands.
      var holo = reduced ? 1 : Math.min(1, t / 280);

      var cx = PAD + (COLS * px) / 2;
      var cyMid = PAD + (ROWS * px) / 2;
      var glowR = COLS * px * 1.45;

      // Projection glow, pulsing gently.
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = holo * (reduced ? 0.8 : 0.72 + 0.28 * Math.sin(t / 420));
      ctx.fillStyle = glowGrad;
      ctx.fillRect(cx - glowR, cyMid - glowR, glowR * 2, glowR * 2);
      ctx.globalCompositeOperation = "source-over";

      // Slab thickness. At 0deg the ghosts hide exactly behind the lit face; as
      // the house turns they fan out, so edge-on still reads as a solid object
      // instead of the logo blinking out of existence.
      var slabD = px * 1.35;
      var spread = COLS * px * 2.2;
      // Projector flicker.
      var flicker = reduced ? 1 : 1 - holo * (0.07 - 0.07 * Math.sin(t / 37) * Math.cos(t / 71));

      for (var si = 0; si < SLICE_COUNT; si++) {
        // Walk slices back to front so the lit face lands on top.
        var k = cosA >= 0 ? SLICE_COUNT - 1 - si : si;
        var d = (k - 1) * slabD;
        var main = k === 1;
        var sliceAlpha = main ? flicker : 0.34 * holo * flicker;

        for (var ci = 0; ci < COLS; ci++) {
          // Columns also back to front; z is monotonic in x, so direction is enough.
          var c = sinA >= 0 ? ci : COLS - 1 - ci;
          var colBlocks = byCol[c];
          if (!colBlocks.length) continue;

          var xc = (c + 0.5 - COLS / 2) * px;
          var xr = xc * cosA + d * sinA;
          var z = d * cosA - xc * sinA;
          var sc = FOCAL / (FOCAL + z);
          var w = px * Math.max(absCos, EDGE_FLOOR) * sc;
          if (w < 0.35) continue;

          var left = cx + xr * sc - w / 2;
          var h = px * sc;
          var bevel = Math.max(1, w * 0.18);

          var lum = 0.5 + holo * (0.5 - z / spread - 0.5);
          var idx = lum <= 0 ? 0 : lum >= 1 ? SHADE_STEPS - 1 : (lum * SHADE_STEPS) | 0;

          for (var bi = 0; bi < colBlocks.length; bi++) {
            var b = colBlocks[bi];
            var top = cyMid + (PAD + b.row * px - cyMid) * sc;

            ctx.globalAlpha = sliceAlpha;
            ctx.fillStyle = (b.color === GOLD ? GOLD_SHADES : TERRA_SHADES)[idx];
            ctx.fillRect(left, top, w, h);

            if (!main) continue;

            ctx.fillStyle = "rgba(255,255,255,.3)";
            ctx.fillRect(left, top, w, bevel);
            ctx.fillRect(left, top, bevel, h);
            ctx.fillStyle = "rgba(0,0,0,.32)";
            ctx.fillRect(left, top + h - bevel, w, bevel);
            ctx.fillRect(left + w - bevel, top, bevel, h);
          }
        }
      }

      // Scan band sweeping down the projection.
      if (!reduced) {
        var bandH = px * 1.7;
        var span = ROWS * px + bandH * 2;
        var bandY = PAD - bandH + ((t % BAND_MS) / BAND_MS) * span;
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = holo;
        ctx.save();
        ctx.translate(cx - (COLS * px * 0.85) / 2, bandY);
        ctx.fillStyle = bandGrad;
        ctx.fillRect(0, 0, COLS * px * 0.85, bandH);
        ctx.restore();
        ctx.globalCompositeOperation = "source-over";
      }

      ctx.globalAlpha = 1;
    }

    measure();

    var start = performance.now();
    var frame = 0;
    var stopped = false;

    function tick(now) {
      if (stopped) return;
      render(now - start);
      frame = requestAnimationFrame(tick);
    }

    if (reduced) {
      render(restingAt);
    } else {
      frame = requestAnimationFrame(tick);
    }

    function onResize() {
      measure();
      render(reduced ? restingAt : performance.now() - start);
    }
    window.addEventListener("resize", onResize);

    // Wordmark bounces in once the house has landed.
    for (var i = 0; i < TEXT.length; i++) {
      var span = document.createElement("span");
      span.textContent = TEXT.charAt(i);
      // Highlight the S, W and M of Stay With Me.
      if (i === 0 || i === 4 || i === 8) span.className = "is-hi";
      span.style.animationDelay = settled + WORD_GAP_MS + i * LETTER_MS + "ms";
      wordEl.appendChild(span);
    }

    var cells = [];
    for (var k = 0; k < BAR_CELLS; k++) {
      var cell = document.createElement("i");
      barEl.appendChild(cell);
      cells.push(cell);
    }
    loadEl.style.animationDelay = wordEnd + "ms";

    // Stepped 8-bit progress bar. Only cells that actually change are touched,
    // so this stays off the style-recalc hot path.
    var filled = 0;
    var barTimer = setInterval(function () {
      filled = (filled + 1) % (BAR_CELLS + 4);
      for (var j = 0; j < BAR_CELLS; j++) {
        var want = j < filled;
        if (cells[j].classList.contains("is-on") !== want) {
          cells[j].classList.toggle("is-on", want);
        }
      }
    }, BAR_TICK_MS);

    var doneTimer = null;
    if (!loop && onDone) {
      doneTimer = setTimeout(onDone, reduced ? 900 : Math.max(HOLD_MS, wordEnd + 300));
    }

    return {
      destroy: function () {
        stopped = true;
        cancelAnimationFrame(frame);
        clearInterval(barTimer);
        if (doneTimer) clearTimeout(doneTimer);
        window.removeEventListener("resize", onResize);
      }
    };
  }

  window.StayWithMeIntro = { mount: mount };
})();
