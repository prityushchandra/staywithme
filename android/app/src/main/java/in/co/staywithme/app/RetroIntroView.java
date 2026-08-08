package in.co.staywithme.app;

import android.animation.ValueAnimator;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapShader;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Matrix;
import android.graphics.Paint;
import android.graphics.RadialGradient;
import android.graphics.Shader;
import android.graphics.Typeface;
import android.view.View;

/**
 * The retro 8-bit intro, drawn natively.
 *
 * <p>This used to be a second WebView loading {@code native/www/splash.html}. Android
 * runs every WebView in one shared renderer process, so the splash animation and the
 * site's own hydration fought over the same main thread — the animation dropped frames
 * for exactly as long as it mattered. Drawing it here keeps it on the UI/Render thread,
 * completely isolated from whatever the Capacitor WebView is doing behind it, and skips
 * the 100-300 ms it costs to spin up a WebView in the first place.
 *
 * <p>Geometry, timings and the seeded PRNG mirror {@code public/intro.js} so the web/iOS
 * and Android intros assemble identically. Change one, change the other.
 */
public class RetroIntroView extends View {

    // 13x12 pixel-art house. Rows 0-6 are the roof, 7-11 the walls + doorway.
    private static final String[] ART = {
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
    };

    private static final int COLS = 13;
    private static final int ROWS = 12;

    private static final int BG = 0xFF140F0D;
    private static final int GOLD = 0xFFE8A020;
    private static final int TERRA = 0xFFC8705E;
    private static final int TEXT_SHADOW = 0xFF7D3527;
    private static final int TEXT_COLOR = 0xFFFFF6EE;

    private static final float LAND_MS = 520f;
    private static final float ROW_STAGGER = 52f;
    private static final float IMPACT_MS = 340f;
    private static final String TEXT = "STAYWITHME";
    private static final float LETTER_MS = 62f;
    private static final float WORD_GAP_MS = 90f;
    private static final float LETTER_DROP_MS = 460f;
    private static final int BAR_CELLS = 12;
    private static final float BAR_TICK_MS = 110f;
    private static final float BAR_FADE_MS = 400f;
    private static final float BLINK_MS = 1050f;
    private static final float SCAN_ROLL_MS = 7000f;

    private static final class Block {
        int col;
        int row;
        float dx;
        float dy;
        float rot;
        float delay;
        int color;
    }

    /** Mirrors the cubic-bezier(.2,1.7,.38,1) used by the CSS wordmark keyframes. */
    private static final float EASE_X1 = 0.2f;
    private static final float EASE_Y1 = 1.7f;
    private static final float EASE_X2 = 0.38f;
    private static final float EASE_Y2 = 1f;

    private final Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint blockPaint = new Paint();
    private final Paint wordPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint tipPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint shaderPaint = new Paint();

    private final Block[] blocks;
    private final float settledMs;
    private final float restingMs;
    private final float wordEndMs;

    private final float density;
    private final boolean reduced;

    private long startedAt;
    private float px;
    private float houseLeft;
    private float houseTop;
    private float wordBaseline;
    private float barLeft;
    private float barTop;
    private float tipBaseline;

    private Shader gridShader;
    private Shader scanShader;
    private Shader vignetteShader;
    private int scanTilePx = 4;
    private final Matrix scanMatrix = new Matrix();

    private Bitmap houseCache;
    private int seed;

    public RetroIntroView(Context context) {
        super(context);
        density = context.getResources().getDisplayMetrics().density;
        reduced = !ValueAnimator.areAnimatorsEnabled();

        setClickable(true);
        setBackgroundColor(BG);

        Typeface mono = Typeface.create(Typeface.MONOSPACE, Typeface.BOLD);
        wordPaint.setTypeface(mono);
        tipPaint.setTypeface(mono);
        tipPaint.setLetterSpacing(0.34f);

        blocks = buildBlocks();

        float maxDelay = 0f;
        for (Block b : blocks) {
            if (b.delay > maxDelay) maxDelay = b.delay;
        }
        settledMs = maxDelay + LAND_MS;
        restingMs = settledMs + IMPACT_MS;
        wordEndMs = settledMs + WORD_GAP_MS + TEXT.length() * LETTER_MS;
    }

    /** How long the animation still needs before it is safe to fade the splash out. */
    public long getRemainingMs() {
        long total = reduced ? 900L : (long) Math.max(2600f, wordEndMs + 300f);
        if (startedAt == 0L) return total;
        return total - (System.nanoTime() - startedAt) / 1_000_000L;
    }

    /**
     * Same seeded PRNG as intro.js (mulberry32). Java int maths already wraps to 32 bits,
     * which is what Math.imul gives JavaScript.
     */
    private double rand() {
        seed = seed + 0x6d2b79f5;
        int t = (seed ^ (seed >>> 15)) * (1 | seed);
        t = (t + ((t ^ (t >>> 7)) * (61 | t))) ^ t;
        return ((long) (t ^ (t >>> 14)) & 0xFFFFFFFFL) / 4294967296.0;
    }

    private Block[] buildBlocks() {
        seed = 0x57414D;

        int count = 0;
        for (String row : ART) {
            for (int c = 0; c < COLS; c++) {
                if (row.charAt(c) == 'X') count++;
            }
        }

        Block[] out = new Block[count];
        int i = 0;
        for (int r = 0; r < ROWS; r++) {
            for (int c = 0; c < COLS; c++) {
                if (ART[r].charAt(c) != 'X') continue;

                // Call order must match intro.js exactly or the two assemble differently.
                double angle = rand() * Math.PI * 2;
                double distance = 60 + rand() * 130;
                double delay = r * ROW_STAGGER + rand() * 40;
                double rot = ((rand() * 200 - 100) * Math.PI) / 180;

                Block b = new Block();
                b.col = c;
                b.row = r;
                b.dx = (float) (Math.cos(angle) * distance);
                b.dy = (float) (Math.sin(angle) * distance - 40);
                b.rot = (float) rot;
                b.delay = (float) delay;
                b.color = r <= 6 ? GOLD : TERRA;
                out[i++] = b;
            }
        }
        return out;
    }

    /** Overshoot easing, the canvas equivalent of cubic-bezier(.18,1.5,.4,1). */
    private static float backOut(float t) {
        float c1 = 1.70158f;
        float c3 = c1 + 1f;
        float u = t - 1f;
        return 1f + c3 * u * u * u + c1 * u * u;
    }

    /**
     * CSS cubic-bezier() solved directly rather than via PathInterpolator, which
     * validates its Path and would take the whole app down at launch if it ever
     * disagreed about the overshooting control point.
     */
    private static float dropEase(float x) {
        if (x <= 0f) return 0f;
        if (x >= 1f) return 1f;

        float t = x;
        for (int i = 0; i < 8; i++) {
            float slope = bezierSlope(t, EASE_X1, EASE_X2);
            if (Math.abs(slope) < 1e-6f) break;
            float err = bezier(t, EASE_X1, EASE_X2) - x;
            if (Math.abs(err) < 1e-6f) break;
            t -= err / slope;
        }
        if (t < 0f) t = 0f;
        if (t > 1f) t = 1f;

        return bezier(t, EASE_Y1, EASE_Y2);
    }

    private static float bezier(float t, float a, float b) {
        float u = 1f - t;
        return 3f * u * u * t * a + 3f * u * t * t * b + t * t * t;
    }

    private static float bezierSlope(float t, float a, float b) {
        float u = 1f - t;
        return 3f * u * u * a + 6f * u * t * (b - a) + 3f * t * t * (1f - b);
    }

    @Override
    protected void onSizeChanged(int w, int h, int oldW, int oldH) {
        super.onSizeChanged(w, h, oldW, oldH);
        if (w == 0 || h == 0) return;

        // clamp(7px, 2.6vmin, 13px) from the shared stylesheet, in device pixels.
        float vmin = Math.min(w, h);
        px = Math.max(7f * density, Math.min(0.026f * vmin, 13f * density));

        wordPaint.setTextSize(px * 2.1f);
        tipPaint.setTextSize(px * 0.92f);

        float gap = px * 2.6f;
        float houseH = ROWS * px;
        float wordH = wordPaint.descent() - wordPaint.ascent();
        float tipH = tipPaint.descent() - tipPaint.ascent();
        float barH = barHeight();

        float total = houseH + gap + wordH + gap + barH + px * 0.8f + tipH;
        float top = (h - total) / 2f;

        houseLeft = (w - COLS * px) / 2f;
        houseTop = top;
        wordBaseline = top + houseH + gap - wordPaint.ascent();
        barTop = top + houseH + gap + wordH + gap;
        barLeft = (w - barWidth()) / 2f;
        tipBaseline = barTop + barH + px * 0.8f - tipPaint.ascent();

        buildShaders(w, h);

        if (houseCache != null) {
            houseCache.recycle();
            houseCache = null;
        }
    }

    private float barHeight() {
        return 2f * (px * 0.22f) + 2f * (px * 0.3f) + px * 0.72f;
    }

    private float barWidth() {
        return 2f * (px * 0.22f) + 2f * (px * 0.3f) + BAR_CELLS * (px * 0.9f) + (BAR_CELLS - 1) * (px * 0.3f);
    }

    /**
     * The grid, scanlines and vignette are shaders drawn as one rect each. As CSS they
     * were full-screen layers, and animating the scanline offset repainted the whole
     * screen every frame — that was most of the visible stutter.
     */
    private void buildShaders(int w, int h) {
        int tile = Math.max(2, Math.round(px * 2f));
        Bitmap grid = Bitmap.createBitmap(tile, tile, Bitmap.Config.ARGB_8888);
        Canvas gc = new Canvas(grid);
        Paint line = new Paint();
        line.setColor(Color.argb(18, 200, 112, 94));
        gc.drawRect(0, 0, tile, Math.max(1f, density), line);
        gc.drawRect(0, 0, Math.max(1f, density), tile, line);
        gridShader = new BitmapShader(grid, Shader.TileMode.REPEAT, Shader.TileMode.REPEAT);

        int scanTile = Math.max(4, Math.round(4f * density));
        scanTilePx = scanTile;
        Bitmap scan = Bitmap.createBitmap(1, scanTile, Bitmap.Config.ARGB_8888);
        Canvas sc = new Canvas(scan);
        Paint dark = new Paint();
        dark.setColor(Color.argb(71, 0, 0, 0));
        sc.drawRect(0, 0, 1, scanTile / 2f, dark);
        scanShader = new BitmapShader(scan, Shader.TileMode.REPEAT, Shader.TileMode.REPEAT);

        // radial-gradient(ellipse at center, transparent 45%, rgba(0,0,0,.65) 100%)
        float rx = (w / 2f) * 1.4142f;
        float ry = (h / 2f) * 1.4142f;
        RadialGradient vig = new RadialGradient(
            0f,
            0f,
            1000f,
            new int[] { Color.TRANSPARENT, Color.TRANSPARENT, Color.argb(166, 0, 0, 0) },
            new float[] { 0f, 0.45f, 1f },
            Shader.TileMode.CLAMP
        );
        Matrix m = new Matrix();
        m.setScale(rx / 1000f, ry / 1000f);
        m.postTranslate(w / 2f, h / 2f);
        vig.setLocalMatrix(m);
        vignetteShader = vig;
    }

    @Override
    protected void onDraw(Canvas canvas) {
        if (px <= 0f) return;

        // Clock starts at the first visible frame, not at construction, so a slow
        // cold start can't eat the front of the animation.
        if (startedAt == 0L) startedAt = System.nanoTime();

        float elapsed = reduced ? restingMs : (System.nanoTime() - startedAt) / 1_000_000f;
        int w = getWidth();
        int h = getHeight();

        // The solid field comes from setBackgroundColor(), already painted by View.draw().
        shaderPaint.setFilterBitmap(false);
        shaderPaint.setShader(gridShader);
        canvas.drawRect(0, 0, w, h, shaderPaint);

        drawHouse(canvas, elapsed);
        drawWord(canvas, elapsed);
        drawLoader(canvas, elapsed);

        // Scanlines roll by translating the shader, which costs nothing to re-record.
        // Filtering keeps the sub-pixel offset from shimmering as it scrolls.
        float roll = reduced ? 0f : (elapsed % SCAN_ROLL_MS) / SCAN_ROLL_MS * scanTilePx;
        scanMatrix.setTranslate(0f, roll);
        scanShader.setLocalMatrix(scanMatrix);
        shaderPaint.setFilterBitmap(true);
        shaderPaint.setShader(scanShader);
        canvas.drawRect(0, 0, w, h, shaderPaint);

        shaderPaint.setShader(vignetteShader);
        canvas.drawRect(0, 0, w, h, shaderPaint);

        shaderPaint.setShader(null);

        if (!reduced) postInvalidateOnAnimation();
    }

    private void drawHouse(Canvas canvas, float elapsed) {
        float bevel = Math.max(1f, px * 0.18f);

        // Nothing about the house moves once the impact shake ends, so bake it once.
        if (elapsed >= restingMs) {
            if (houseCache == null) {
                int cw = Math.max(1, Math.round(COLS * px));
                int ch = Math.max(1, Math.round(ROWS * px));
                houseCache = Bitmap.createBitmap(cw, ch, Bitmap.Config.ARGB_8888);
                Canvas hc = new Canvas(houseCache);
                blockPaint.setAntiAlias(false);
                for (Block bl : blocks) {
                    paintSettled(hc, 0f, 0f, bl, bevel);
                }
            }
            canvas.drawBitmap(houseCache, houseLeft, houseTop, null);
            return;
        }

        float shakeX = 0f;
        float shakeY = 0f;
        if (elapsed >= settledMs) {
            int step = (int) ((elapsed - settledMs) / (IMPACT_MS / 4f));
            // Whole pixels only, so the snapped blocks keep tiling during the shake.
            float amp = Math.round(px * 0.18f);
            if (step == 0) {
                shakeX = amp;
                shakeY = Math.round(px * 0.3f);
            } else if (step == 1) {
                shakeX = -amp;
            } else if (step == 2) {
                shakeY = amp;
            }
        }

        for (Block b : blocks) {
            float p = (elapsed - b.delay) / LAND_MS;
            if (p <= 0f) continue;

            if (p >= 1f) {
                // Snapped to whole pixels so neighbours tile without seams or gaps.
                blockPaint.setAntiAlias(false);
                paintSettled(canvas, houseLeft + shakeX, houseTop + shakeY, b, bevel);
                continue;
            }

            float eased = backOut(p);
            float remaining = 1f - eased;
            float scale = 0.2f + 0.8f * eased;
            float x = houseLeft + b.col * px + shakeX;
            float y = houseTop + b.row * px + shakeY;

            blockPaint.setAntiAlias(true);
            canvas.save();
            canvas.translate(
                x + px / 2f + b.dx * density * remaining,
                y + px / 2f + b.dy * density * remaining
            );
            canvas.rotate((float) Math.toDegrees(b.rot * remaining));
            canvas.scale(scale, scale);
            paintBlock(canvas, -px / 2f, -px / 2f, px / 2f, px / 2f, bevel, b.color, Math.min(1f, p / 0.6f));
            canvas.restore();
        }
    }

    private void paintSettled(Canvas canvas, float originX, float originY, Block b, float bevel) {
        paintBlock(
            canvas,
            originX + Math.round(b.col * px),
            originY + Math.round(b.row * px),
            originX + Math.round((b.col + 1) * px),
            originY + Math.round((b.row + 1) * px),
            bevel,
            b.color,
            1f
        );
    }

    /** Chunky bevel: light top-left, dark bottom-right — classic 16-bit shading. */
    private void paintBlock(Canvas canvas, float l, float t, float r, float b, float bevel, int color, float alpha) {
        int a = Math.round(alpha * 255f);

        blockPaint.setColor(color);
        blockPaint.setAlpha(a);
        canvas.drawRect(l, t, r, b, blockPaint);

        blockPaint.setColor(Color.WHITE);
        blockPaint.setAlpha(Math.round(0.28f * a));
        canvas.drawRect(l, t, r, t + bevel, blockPaint);
        canvas.drawRect(l, t, l + bevel, b, blockPaint);

        blockPaint.setColor(Color.BLACK);
        blockPaint.setAlpha(Math.round(0.3f * a));
        canvas.drawRect(l, b - bevel, r, b, blockPaint);
        canvas.drawRect(r - bevel, t, r, b, blockPaint);
    }

    private void drawWord(Canvas canvas, float elapsed) {
        float tracking = wordPaint.getTextSize() * 0.06f + px * 0.22f;

        float totalW = 0f;
        for (int i = 0; i < TEXT.length(); i++) {
            totalW += wordPaint.measureText(TEXT, i, i + 1) + tracking;
        }
        totalW -= tracking;

        float cursor = (getWidth() - totalW) / 2f;
        float glyphMid = (wordPaint.ascent() + wordPaint.descent()) / 2f;
        float shadow = px * 0.22f;

        for (int i = 0; i < TEXT.length(); i++) {
            String ch = TEXT.substring(i, i + 1);
            float cw = wordPaint.measureText(ch);
            float t = (elapsed - (settledMs + WORD_GAP_MS + i * LETTER_MS)) / LETTER_DROP_MS;

            if (t <= 0f) {
                cursor += cw + tracking;
                continue;
            }
            if (t > 1f) t = 1f;

            // CSS eases each keyframe segment separately: opacity 0->55%, transform 0->70%->100%.
            float alpha = t >= 0.55f ? 1f : dropEase(t / 0.55f);
            alpha = Math.max(0f, Math.min(1f, alpha));

            float ty;
            float sx;
            float sy;
            if (t < 0.7f) {
                float e = dropEase(t / 0.7f);
                ty = (-3.4f * px) * (1f - e);
                sy = 1.6f + (0.72f - 1.6f) * e;
                sx = 0.7f + (1.25f - 0.7f) * e;
            } else {
                float e = dropEase((t - 0.7f) / 0.3f);
                ty = 0f;
                sy = 0.72f + (1f - 0.72f) * e;
                sx = 1.25f + (1f - 1.25f) * e;
            }

            canvas.save();
            canvas.translate(cursor + cw / 2f, wordBaseline + glyphMid + ty);
            canvas.scale(sx, sy);

            wordPaint.setColor(TEXT_SHADOW);
            wordPaint.setAlpha(Math.round(alpha * 255f));
            canvas.drawText(ch, -cw / 2f + shadow, -glyphMid + shadow, wordPaint);

            // Highlight the S, W and M of Stay With Me.
            wordPaint.setColor(i == 0 || i == 4 || i == 8 ? GOLD : TEXT_COLOR);
            wordPaint.setAlpha(Math.round(alpha * 255f));
            canvas.drawText(ch, -cw / 2f, -glyphMid, wordPaint);

            canvas.restore();
            cursor += cw + tracking;
        }
    }

    private void drawLoader(Canvas canvas, float elapsed) {
        float alpha = (elapsed - wordEndMs) / BAR_FADE_MS;
        if (alpha <= 0f) return;
        if (alpha > 1f) alpha = 1f;

        float border = px * 0.22f;
        float pad = px * 0.3f;
        float cellW = px * 0.9f;
        float cellH = px * 0.72f;
        float gap = px * 0.3f;
        float barW = barWidth();
        float barH = barHeight();

        fill.setStyle(Paint.Style.STROKE);
        fill.setStrokeWidth(border);
        fill.setColor(Color.argb(Math.round(0.32f * alpha * 255f), 255, 246, 238));
        canvas.drawRect(
            barLeft + border / 2f,
            barTop + border / 2f,
            barLeft + barW - border / 2f,
            barTop + barH - border / 2f,
            fill
        );
        fill.setStyle(Paint.Style.FILL);

        // Stepped 8-bit progress bar: fills, overruns by 4 ticks, restarts.
        int filled = reduced ? BAR_CELLS : (int) (elapsed / BAR_TICK_MS) % (BAR_CELLS + 4);
        float cellY = barTop + border + pad;

        for (int j = 0; j < BAR_CELLS; j++) {
            float cellX = barLeft + border + pad + j * (cellW + gap);
            if (j < filled) {
                fill.setColor(GOLD);
                fill.setAlpha(Math.round(alpha * 255f));
            } else {
                fill.setColor(Color.argb(Math.round(0.12f * alpha * 255f), 255, 246, 238));
            }
            canvas.drawRect(cellX, cellY, cellX + cellW, cellY + cellH, fill);
        }

        float blink = reduced || (elapsed % BLINK_MS) < BLINK_MS / 2f ? 1f : 0.28f;
        tipPaint.setColor(Color.argb(Math.round(0.55f * alpha * blink * 255f), 255, 246, 238));
        float tipW = tipPaint.measureText("LOADING");
        canvas.drawText("LOADING", (getWidth() - tipW) / 2f, tipBaseline, tipPaint);
    }

    @Override
    protected void onDetachedFromWindow() {
        super.onDetachedFromWindow();
        if (houseCache != null) {
            houseCache.recycle();
            houseCache = null;
        }
    }
}
