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
    var maxDelay = 0;

    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        if (ART[r].charAt(c) !== "X") continue;

        var angle = rand() * Math.PI * 2;
        var distance = 60 + rand() * 130;
        // Build top-down so the roof lands before the walls.
        var delay = r * ROW_STAGGER + rand() * 40;
        if (delay > maxDelay) maxDelay = delay;

        blocks.push({
          col: c,
          row: r,
          dx: Math.cos(angle) * distance,
          dy: Math.sin(angle) * distance - 40,
          rot: ((rand() * 200 - 100) * Math.PI) / 180,
          delay: delay,
          color: r <= 6 ? GOLD : TERRA
        });
      }
    }

    return { blocks: blocks, settled: maxDelay + LAND_MS };
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
    var settled = built.settled;
    var wordEnd = settled + WORD_GAP_MS + TEXT.length * LETTER_MS;

    var reduced = !!(
      window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );

    var px = 1;
    var cssW = 1;
    var cssH = 1;

    function measure() {
      px = houseEl.clientWidth / COLS || 10;
      cssW = COLS * px + PAD * 2;
      cssH = ROWS * px + PAD * 2;
      // Cap DPR: a 3x canvas costs real fill-rate on phones for no visible gain.
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function render(elapsed) {
      ctx.clearRect(0, 0, cssW, cssH);

      var shakeX = 0;
      var shakeY = 0;
      if (!reduced && elapsed >= settled && elapsed < settled + IMPACT_MS) {
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
        var p = reduced ? 1 : (elapsed - b.delay) / LAND_MS;

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

    measure();

    var restingAt = settled + IMPACT_MS;
    var start = performance.now();
    var frame = 0;
    var stopped = false;

    function tick(now) {
      if (stopped) return;
      var elapsed = now - start;

      // Everything is static once the impact shake ends, so stop burning frames.
      if (elapsed >= restingAt) {
        render(restingAt);
        return;
      }

      render(elapsed);
      frame = requestAnimationFrame(tick);
    }

    if (reduced) {
      render(restingAt);
    } else {
      frame = requestAnimationFrame(tick);
    }

    function onResize() {
      measure();
      render(Math.min(performance.now() - start, restingAt));
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
