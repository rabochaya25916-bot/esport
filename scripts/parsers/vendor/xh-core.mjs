// Ядро разбора и отрисовки кодов прицелов CS2 (формат CS… и CSGO-…).

export const PIXEL_STYLE_NAMES = Object.freeze({
    0: 'Dynamic Cross',
    1: 'Dynamic Circle',
    2: 'Dynamic Cross (Legacy)',
    3: 'Static Circle',
    4: 'Static Cross',
    5: 'Static Cross (Shot Feedback)',
    6: 'Dot Only',
    7: 'Dynamic Quad',
    8: 'Static Square',
    9: 'Static Quadrant'
});

const DYNAMIC_PIXEL_STYLES = new Set([0, 1, 2, 5, 7]);
const CROSS_ARM_STYLES = new Set([0, 2, 4, 5, 7]);
const CIRCLE_STYLES = new Set([1, 3]);
const LEGACY_STYLE_MAP = Object.freeze({0:0, 1:4, 2:2, 3:0, 4:4, 5:5});
const SHARE_ALPHABET = 'ABCDEFGHJKLMNOPQRSTUVWXYZabcdefhijkmnopqrstuvwxyz23456789';
const SHARE_BASE = BigInt(SHARE_ALPHABET.length);

function clampPixel(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function u16le(bytes, offset) {
    return bytes[offset] | (bytes[offset + 1] << 8);
}

function u32le(bytes, offset) {
    return ((bytes[offset]) | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

function parseConfigValues(text) {
    const values = Object.create(null);
    const source = String(text ?? '').replace(/\/\/[^\r\n]*/g, '');
    const re = /(?:^|[\s;{}])"?(cl_[a-z0-9_]+)"?\s+"?(true|false|[-+]?(?:\d+(?:\.\d*)?|\.\d+))"?(?=\s|;|}|$)/gi;
    for (const m of source.matchAll(re)) values[m[1].toLowerCase()] = m[2].toLowerCase();
    return values;
}

const LEGACY_COLOR_PRESETS = Object.freeze([
    [255, 0, 0], [0, 255, 0], [255, 255, 0], [0, 0, 255], [0, 255, 255]
]);

// x64 cvtss2si uses round-to-nearest-even with the normal MXCSR mode.
function bankersRound(value) {
    const floor = Math.floor(value);
    const fraction = value - floor;
    if (Math.abs(fraction - 0.5) < 1e-9) return floor % 2 ? floor + 1 : floor;
    return Math.round(value);
}

function nativeThicknessInfo(value) {
    const thickness = Math.max(1, bankersRound(Math.max(0, Number(value) || 0)));
    return {
        thickness,
        ceilHalf: Math.ceil(thickness / 2),
        floorHalf: Math.floor(thickness / 2),
        even: thickness % 2 === 0
    };
}

function legacyPixelsAtHeight(crosshair, height) {
    const h = Math.max(1, Number(height) || 960);
    const scale = h / 480;
    return {
        length: bankersRound(Math.max(0, Number(crosshair.size) || 0) * scale),
        thickness: Math.max(1, bankersRound(Math.max(0, Number(crosshair.thickness) || 0) * scale)),
        gap: Math.trunc(4 + (Number.isFinite(Number(crosshair.gap)) ? Number(crosshair.gap) : 0))
    };
}

function resolveLegacyRgb(crosshair) {
    const preset = Math.trunc(Number(crosshair.color));
    if (preset >= 0 && preset <= 4) return [...LEGACY_COLOR_PRESETS[preset]];
    return [
        clampPixel(Math.round(Number(crosshair.color_r) || 0), 0, 255),
        clampPixel(Math.round(Number(crosshair.color_g) || 0), 0, 255),
        clampPixel(Math.round(Number(crosshair.color_b) || 0), 0, 255)
    ];
}

export function migrateLegacyCrosshairV1(crosshair = {}, options = {}) {
    const legacyStyle = clampPixel(Math.trunc(Number(crosshair.style) || 0), 0, 5);
    const style = LEGACY_STYLE_MAP[legacyStyle] ?? 4;
    const sourceHeight = Math.max(1, Number(options.sourceHeight ?? 960) || 960);
    const targetHeight = Math.max(1, Number(options.targetHeight ?? 960) || 960);
    const px = legacyPixelsAtHeight(crosshair, sourceHeight);
    const scaleToTarget = targetHeight / sourceHeight;
    const rgb = resolveLegacyRgb(crosshair);
    const drawOutline = crosshair.outline_draw === true || Number(crosshair.outline_draw) === 1;
    const oldOutline = Math.max(0, Number(crosshair.outline) || 0);
    const useAlpha = crosshair.usealpha === true || Number(crosshair.usealpha) === 1;
    const useWeaponGap = crosshair.deployedWeaponGapEnabled === true || Number(crosshair.deployedWeaponGapEnabled) === 1;
    const warnings = [];

    if (legacyStyle === 0 || legacyStyle === 1) warnings.push(`legacy style ${legacyStyle} has no exact current equivalent; mapped to style ${style}`);
    if (useWeaponGap) warnings.push('legacy weapon-dependent gap no longer exists; fixed gap is preserved');
    if (drawOutline && oldOutline > 1) warnings.push(`legacy outline ${oldOutline}px is represented by current Full outline`);

    const migratedLength = clampPixel(Math.round(px.length * scaleToTarget), 0, 255);
    const migratedThickness = clampPixel(Math.round(px.thickness * scaleToTarget), 1, 31);

    // Legacy and modern CS2 measure the gap from different reference points.
    // In the legacy renderer `gap + 4` starts AFTER half of the crosshair thickness,
    // while the modern pixel renderer measures cl_crosshair_gap from the centre axis
    // to the INNER EDGE of each arm. Without compensating for half-thickness, small
    // legacy crosses collapse into a dot when converted (for example old gap -4).
    const migratedGap = clampPixel(
        Math.round(px.gap * scaleToTarget) + Math.ceil(migratedThickness / 2),
        0,
        255
    );

    return {
        format: 'csconfig-pixels',
        source: 'legacy-v1-migrated',
        migratedFromLegacy: true,
        legacyStyle,
        style,
        styleKnown: true,
        styleName: PIXEL_STYLE_NAMES[style],
        length: migratedLength,
        gap: migratedGap,
        thickness: migratedThickness,
        rgb,
        alpha: useAlpha ? clampPixel(Math.round(Number(crosshair.alpha) || 0), 0, 255) : 255,
        outlineMode: drawOutline ? 1 : 0,
        outlineEnabled: drawOutline,
        outlineThickness: drawOutline ? 1 : 0,
        outline: drawOutline ? 1 : 0,
        dot: crosshair.dot === true || Number(crosshair.dot) === 1,
        tStyle: crosshair.crosshair_t === true || Number(crosshair.crosshair_t) === 1,
        recoil: crosshair.recoil === true || Number(crosshair.recoil) === 1,
        splitDistance: clampPixel(Math.round(Number(crosshair.splitDistance ?? 3)), 0, 127),
        innerSplitAlpha: clampPixel(Number(crosshair.innerSplitAlpha ?? 0), 0, 1),
        outerSplitAlpha: clampPixel(Number(crosshair.outerSplitAlpha ?? 1), 0.3, 1),
        splitSizeRatio: clampPixel(Number(crosshair.splitSizeRatio ?? 1), 0, 1.27),
        sniperWidth: Number.isFinite(Number(crosshair.sniperWidth)) ? Number(crosshair.sniperWidth) : undefined,
        screenHeight: targetHeight,
        dynamicSpreadLimit: 255,
        lengthKnown: true,
        thicknessKnown: true,
        gapKnown: true,
        alphaKnown: true,
        migrationExact: warnings.length === 0,
        migrationWarnings: warnings
    };
}

export function modernCrosshairToCommands(crosshair = {}) {
    const c = crosshair.format === 'csconfig-pixels' ? crosshair : migrateLegacyCrosshairV1(crosshair);
    const bool = (value) => value ? 1 : 0;
    const outlineMode = clampPixel(Math.trunc(Number(c.outlineMode ?? c.outline ?? (c.outlineEnabled ? 1 : 0)) || 0), 0, 2);
    const commands = [
        ['cl_crosshairstyle', clampPixel(Math.trunc(Number(c.style) || 0), 0, c.schema === 'CS32' ? 9 : 8)],
        ['cl_crosshair_length', clampPixel(Math.round(Number(c.length) || 0), 0, 255)],
        ['cl_crosshair_gap', clampPixel(Math.round(Number(c.gap) || 0), c.schema === 'CS32' ? -3840 : 0, c.schema === 'CS32' ? 3840 : 255)],
        ['cl_crosshair_thickness', clampPixel(Math.round(Number(c.thickness) || 0), c.schema === 'CS32' ? 0 : 1, c.schema === 'CS32' ? 32 : 31)],
        ['cl_crosshairdot', bool(c.dot)],
        ['cl_crosshair_t', bool(c.tStyle)],
        ['cl_crosshair_drawoutline', outlineMode],
        ['cl_crosshaircolor_r', clampPixel(Math.round(c.rgb?.[0] ?? 0), 0, 255)],
        ['cl_crosshaircolor_g', clampPixel(Math.round(c.rgb?.[1] ?? 255), 0, 255)],
        ['cl_crosshaircolor_b', clampPixel(Math.round(c.rgb?.[2] ?? 0), 0, 255)],
        ['cl_crosshaircolor_a', clampPixel(Math.round(c.alpha ?? 255), 0, 255)],
        ['cl_crosshair_recoil', bool(c.recoil)],
        ['cl_crosshair_screen_height', clampPixel(Math.round(Number(c.screenHeight ?? 960)), 1, 65535)],
        ['cl_crosshair_dynamic_spread_limit', clampPixel(Math.round(Number(c.dynamicSpreadLimit ?? 255)), 0, 255)]
    ];
    if (Math.trunc(Number(c.style)) === 2) {
        commands.push(
            ['cl_crosshair_dynamic_splitdist', clampPixel(Math.round(Number(c.splitDistance ?? 3)), 0, 127)],
            ['cl_crosshair_dynamic_splitalpha_innermod', clampPixel(Number(c.innerSplitAlpha ?? 0), 0, 1)],
            ['cl_crosshair_dynamic_splitalpha_outermod', clampPixel(Number(c.outerSplitAlpha ?? 1), 0.3, 1)],
            ['cl_crosshair_dynamic_maxdist_splitratio', clampPixel(Number(c.splitSizeRatio ?? 1), 0, 1.27)]
        );
    }
    if (c.schema === 'CS32') {
        for (const [i, channel] of ['r','g','b'].entries()) commands.push(['cl_crosshairoutline_' + channel, c.outlineRgb?.[i] ?? 0]);
        commands.push(['cl_crosshairoutline_a', c.outlineAlpha ?? 255], ['cl_ironsight_dot_scale', c.ironsightDotScale ?? 1], ['cl_ironsight_usecrosshaircolor', bool(c.ironsightUseCrosshairColor)]);
    }
    if (Number.isFinite(Number(c.sniperWidth))) commands.push(['cl_crosshair_sniper_width', Number(c.sniperWidth)]);
    return commands.map(([key, value]) => `${key} ${value}`).join('; ');
}

export function parsePixelConfig(text, force = false) {
    const values = parseConfigValues(text);
    const numberValue = (names, fallback) => {
        for (const key of names.split('|')) {
            if (!(key in values)) continue;
            const raw = values[key];
            const value = raw === 'true' ? 1 : raw === 'false' ? 0 : Number(raw);
            if (Number.isFinite(value)) return value;
        }
        return fallback;
    };
    const byte = (names, fallback) => clampPixel(Math.round(numberValue(names, fallback)), 0, 255);
    const styleCandidate = Math.trunc(numberValue('cl_crosshairstyle', 4));
    const modernKeys = [
        'cl_crosshair_length', 'cl_crosshair_thickness', 'cl_crosshair_gap', 'cl_crosshaircolor_a',
        'cl_crosshair_screen_height', 'cl_crosshair_dynamic_spread_limit', 'cl_crosshairoutline_r', 'cl_crosshairoutline_g', 'cl_crosshairoutline_b', 'cl_crosshairoutline_a'
    ];
    const modern = modernKeys.some((key) => key in values) || styleCandidate >= 6;
    if (!force && !modern) return null;

    const preset = Math.trunc(numberValue('cl_crosshaircolor', 5));
    const hasExplicitRgb = ['cl_crosshaircolor_r','cl_crosshaircolor_g','cl_crosshaircolor_b'].some((key) => key in values);
    const rgb = !hasExplicitRgb && LEGACY_COLOR_PRESETS[preset]
        ? [...LEGACY_COLOR_PRESETS[preset]]
        : [byte('cl_crosshaircolor_r', 0), byte('cl_crosshaircolor_g', 255), byte('cl_crosshaircolor_b', 0)];
    const outlineMode = clampPixel(Math.trunc(numberValue('cl_crosshair_drawoutline', 0)), 0, 2);
    const style = clampPixel(styleCandidate, 0, modern ? 9 : 8);

    return {
        format: 'csconfig-pixels',
        source: 'cfg',
        ...(modern ? {schema: 'CS32'} : {}),
        length: clampPixel(Math.round(numberValue('cl_crosshair_length|cl_crosshairsize', 8)), 0, 255),
        thickness: clampPixel(numberValue('cl_crosshair_thickness|cl_crosshairthickness', 2), modern ? 0 : 1, modern ? 32 : 31),
        gap: clampPixel(Math.round(numberValue('cl_crosshair_gap|cl_crosshairgap', 4)), modern ? -3840 : 0, modern ? 3840 : 255),
        style,
        styleKnown: true,
        styleName: PIXEL_STYLE_NAMES[style],
        rgb,
        alpha: 'cl_crosshaircolor_a' in values
            ? byte('cl_crosshaircolor_a', 255)
            : numberValue('cl_crosshairusealpha', 1) !== 0 ? byte('cl_crosshairalpha', 255) : 255,
        outlineRgb: [byte('cl_crosshairoutline_r', 0), byte('cl_crosshairoutline_g', 0), byte('cl_crosshairoutline_b', 0)],
        outlineAlpha: byte('cl_crosshairoutline_a', 255),
        ironsightUseCrosshairColor: numberValue('cl_ironsight_usecrosshaircolor', 0) !== 0,
        ironsightDotScale: clampPixel(numberValue('cl_ironsight_dot_scale', 1), 0.1, 2),
        outlineMode,
        outline: outlineMode,
        outlineEnabled: outlineMode !== 0,
        outlineThickness: outlineMode !== 0 ? 1 : 0,
        dot: numberValue('cl_crosshairdot', 0) !== 0,
        tStyle: numberValue('cl_crosshair_t', 0) !== 0,
        recoil: numberValue('cl_crosshair_recoil', 0) !== 0,
        splitDistance: clampPixel(Math.round(numberValue('cl_crosshair_dynamic_splitdist', 3)), 0, 127),
        innerSplitAlpha: clampPixel(numberValue('cl_crosshair_dynamic_splitalpha_innermod', 0), 0, 1),
        outerSplitAlpha: clampPixel(numberValue('cl_crosshair_dynamic_splitalpha_outermod', 1), 0.3, 1),
        splitSizeRatio: clampPixel(numberValue('cl_crosshair_dynamic_maxdist_splitratio', 1), 0, modern ? 1 : 1.27),
        sniperWidth: 'cl_crosshair_sniper_width' in values ? numberValue('cl_crosshair_sniper_width', 1) : undefined,
        screenHeight: Math.max(modern ? 240 : 1, Math.round(numberValue('cl_crosshair_screen_height', 960))),
        dynamicSpreadLimit: clampPixel(Math.round(numberValue('cl_crosshair_dynamic_spread_limit', 255)), 0, 255),
        lengthKnown: true,
        thicknessKnown: true,
        gapKnown: true,
        alphaKnown: true
    };
}

function nativeCrossRects(cx, cy, gap, length, thickness, tStyle) {
    const info = nativeThicknessInfo(thickness);
    const t = info.thickness;
    const len = Math.max(0, Number(length) || 0);
    const g = Math.max(0, Number(gap) || 0);
    if (len <= 0) return [];

    // Reconstructed from client.dll 0x180da3700. Important: gap is measured from
    // the center axis to the INNER EDGE of each arm, not after half-thickness.
    const leftAnchor = Math.floor(cx - g);
    const rightAnchor = Math.ceil(cx + g) + (info.even ? 0 : -1);
    const x0 = cx - info.ceilHalf;
    const x1 = cx + info.floorHalf;
    const y0 = cy - info.ceilHalf;
    const y1 = cy + info.floorHalf;
    const topAnchor = Math.floor(cy - g - len);
    const bottomAnchor = Math.ceil(cy + g) + (info.even ? 0 : -1);
    const rects = [
        [leftAnchor - len, y0, len, t],
        [rightAnchor, y0, len, t],
        [x0, bottomAnchor, t, len]
    ];
    if (!tStyle) rects.push([x0, topAnchor, t, len]);
    return rects;
}

function nativeDotRect(cx, cy, thickness) {
    const info = nativeThicknessInfo(thickness);
    return [cx - info.ceilHalf, cy - info.ceilHalf, info.thickness, info.thickness];
}

function nativeSquareRects(cx, cy, gap, thickness, dotEnabled = false) {
    const info = nativeThicknessInfo(thickness);
    const t = info.thickness;
    const g = Math.max(0, Number(gap) || 0);
    // client.dll style 8 (0x180da4270): odd thickness + visible center dot shifts the
    // negative sides by one pixel; otherwise offset is zero.
    const oddDotOffset = dotEnabled && !info.even ? -1 : 0;
    const xLeft = Math.floor(cx - g - t + oddDotOffset);
    const xRight = Math.floor(cx + g);
    const yTop = Math.floor(cy - g - t + oddDotOffset);
    const yBottom = Math.floor(cy + g);
    const spanX = (xRight - xLeft) + t;
    const spanY = (yBottom - yTop) + t;
    return [
        [xLeft, yTop, spanX, t],
        [xLeft, yBottom, spanX, t],
        [xLeft, yTop, t, spanY],
        [xRight, yTop, t, spanY]
    ];
}

function nativeCircle(cx, cy, gap, thickness) {
    const info = nativeThicknessInfo(thickness);
    const g = Math.max(1, Number(gap) || 0);
    // Static-circle wrapper in client.dll passes max(1,gap) and thickness to 0x180da3570.
    // That helper uses radius-like extent = gap + thickness and ring width=max(1,t-1),
    // with a half-pixel center correction for odd thickness.
    return {
        cx: cx - (info.even ? 0 : 0.5),
        cy: cy - (info.even ? 0 : 0.5),
        radius: g + info.thickness,
        lineWidth: Math.max(1, info.thickness - 1),
        sourceThickness: info.thickness
    };
}

function quadCornerRects(cx, cy, gap, length, thickness) {
    // Dynamic Quad has weapon-state-dependent animation in client.dll. For a deterministic
    // web preview we render its idle/base corner markers plus the exact native cross component.
    const info = nativeThicknessInfo(thickness);
    const t = info.thickness;
    const distance = Math.max(2, Number(gap) + Number(length));
    const seg = Math.max(2, t + 1);
    const out = [];
    for (const [sx, sy] of [[-1,-1],[1,-1],[-1,1],[1,1]]) {
        const ox = sx < 0 ? Math.floor(cx - distance - t) : Math.ceil(cx + distance);
        const oy = sy < 0 ? Math.floor(cy - distance - t) : Math.ceil(cy + distance);
        out.push(
            [sx < 0 ? ox : ox - seg + t, oy, seg, t],
            [ox, sy < 0 ? oy : oy - seg + t, t, seg]
        );
    }
    return out;
}

function centeredQuadCrossRects(cx, cy, gap, length, thickness, tStyle = false) {
    // Dynamic Quad only.
    //
    // Important: do NOT mix a half-pixel centre (49.5) with arm anchors based on 50.
    // That makes the 1px centre cross asymmetric after snapping to the raster.
    //
    // Build all four arms from the same integer centre block:
    //   left arm | centre block | right arm
    // and
    //   top arm
    //   centre block
    //   bottom arm
    //
    // This removes Canvas sub-pixel antialiasing while keeping the cross itself straight.
    // The real share-code alpha is still applied later by ctx.globalAlpha.
    const info = nativeThicknessInfo(thickness);
    const t = info.thickness;
    const len = Math.max(0, bankersRound(Number(length) || 0));
    const g = Math.max(0, bankersRound(Number(gap) || 0));
    if (len <= 0) return [];

    const x0 = Math.floor(cx - t / 2);
    const y0 = Math.floor(cy - t / 2);

    const leftX = x0 - g - len;
    const rightX = x0 + t + g;
    const topY = y0 - g - len;
    const bottomY = y0 + t + g;

    const rects = [
        [leftX, y0, len, t],
        [rightX, y0, len, t],
        [x0, bottomY, t, len]
    ];

    if (!tStyle) rects.push([x0, topY, t, len]);
    return rects;
}

function centeredQuadDotRect(cx, cy, thickness) {
    // Same integer centre block as the Dynamic Quad cross.
    const t = nativeThicknessInfo(thickness).thickness;
    return [
        Math.floor(cx - t / 2),
        Math.floor(cy - t / 2),
        t,
        t
    ];
}

export function getPixelGeometry(crosshair, width = 100, height = 100) {
    if (crosshair?.schema === 'CS32') return getCS32Geometry(crosshair, width, height);
    const style = clampPixel(Math.trunc(Number(crosshair?.style) || 0), 0, 8);
    const authoredScreenHeight = Math.max(1, Number(crosshair?.screenHeight) || 960);
    // CS-CONFIG uses one normalized preview reference for every crosshair: 1280x960.
    // The share-code keeps the height at which its pixel settings were authored; only the web
    // Crosshair size is height-based in CS2, so the reference scale uses 960 px height.
    const previewScreenHeight = 960;
    const renderScale = previewScreenHeight / authoredScreenHeight;
    const thickness = clampPixel((Number(crosshair?.thickness) || 1) * renderScale, 1, 31);
    const length = clampPixel((Number(crosshair?.length) || 0) * renderScale, 0, 255);
    const gap = clampPixel((Number(crosshair?.gap) || 0) * renderScale, 0, 255);
    // Keep the native panel origin centred. Do not shift the whole geometry by +1px
    // for odd thickness: that moves Dynamic Quad off-centre. Style 7 gets its own
    // optical centring for the small cross component below.
    const cx = Math.ceil(width / 2);
    const cy = Math.ceil(height / 2);
    const rects = [];
    const circles = [];
    let approximateDynamic = false;

    if (style === 7) {
        // Dynamic Quad keeps the native outer markers, but its centre cross is
        // rasterized from one integer centre block so it stays straight and crisp.
        rects.push(...centeredQuadCrossRects(width / 2, height / 2, gap, length, thickness, Boolean(crosshair?.tStyle)));
        rects.push(...quadCornerRects(cx, cy, gap, length, thickness));
        approximateDynamic = true;
    } else if (CROSS_ARM_STYLES.has(style)) {
        rects.push(...nativeCrossRects(cx, cy, gap, length, thickness, Boolean(crosshair?.tStyle)));
    }

    if (style === 8) rects.push(...nativeSquareRects(cx, cy, gap, thickness, Boolean(crosshair?.dot)));

    if (CIRCLE_STYLES.has(style)) {
        circles.push(nativeCircle(cx, cy, gap, thickness));
        if (style === 1) approximateDynamic = true;
    }

    if (style === 0 || style === 2 || style === 5) approximateDynamic = true;

    if (crosshair?.dot || style === 6) {
        if (style === 7) rects.push(centeredQuadDotRect(width / 2, height / 2, thickness));
        else rects.push(nativeDotRect(cx, cy, thickness));
    }

    return {style, thickness, length, gap, cx, cy, rects, circles, approximateDynamic, authoredScreenHeight, previewScreenHeight, previewScreenWidth: 1280, renderScale};
}

function drawRectOutlineLayer(ctx, rect, outlineMode, alpha) {
    const [x, y, w, h] = rect;
    if (w <= 0 || h <= 0 || outlineMode === 0) return;
    ctx.globalAlpha = alpha * 0.67;
    ctx.fillStyle = '#000000';
    if (outlineMode === 1) {
        ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    } else if (outlineMode === 2) {
        // Current "Half" mode: one-pixel top/left outline.
        ctx.fillRect(x - 1, y - 1, w + 1, 1);
        ctx.fillRect(x - 1, y, 1, h);
    }
}

function drawRectColorLayer(ctx, rect, color, alpha) {
    const [x, y, w, h] = rect;
    if (w <= 0 || h <= 0) return;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
}

function drawCircleWithOutline(ctx, circle, color, outlineMode, alpha) {
    const {cx, cy, radius, lineWidth} = circle;
    if (!(radius > 0)) return;
    if (outlineMode === 1) {
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = lineWidth + 2;
        ctx.globalAlpha = alpha * 0.53;
        ctx.stroke();
    } else if (outlineMode === 2) {
        ctx.beginPath();
        ctx.arc(cx, cy, radius, Math.PI, Math.PI * 1.5);
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = lineWidth + 2;
        ctx.globalAlpha = alpha * 0.53;
        ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.globalAlpha = alpha;
    ctx.stroke();
}

export function drawPixelCrosshair(crosshair, canvas) {
    if (crosshair?.schema === 'CS32') {
        if (!canvas) return;
        canvas.style.backgroundColor = '#444444';
        canvas.dataset.crosshairBackground = '68,68,68';
        return drawCS32(crosshair, canvas);
    }
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const geometry = getPixelGeometry(crosshair, canvas.width, canvas.height);
    const alpha = clampPixel(Number(crosshair?.alpha ?? 255), 0, 255) / 255;
    const rgb = Array.isArray(crosshair?.rgb)
        ? crosshair.rgb.map((value) => clampPixel(Math.round(Number(value) || 0), 0, 255))
        : [0, 255, 0];
    const color = `rgb(${rgb.join(',')})`;
    const outlineMode = clampPixel(Math.trunc(Number(crosshair?.outlineMode ?? crosshair?.outline ?? (crosshair?.outlineEnabled ? 1 : 0)) || 0), 0, 2);

    ctx.save();
    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.imageSmoothingEnabled = false;
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'miter';
    canvas.style.backgroundColor = '#444444';

    for (const circle of geometry.circles) drawCircleWithOutline(ctx, circle, color, outlineMode, alpha);

    // Native CS2 treats the outline and colored pips as separate visual layers.
    // Drawing outline+color arm-by-arm is wrong for touching arms (gap 0): the black
    // outline of the next arm overwrites the color of the previous arm. Build the full
    // black mask first, then paint every colored arm over it.
    for (const rect of geometry.rects) drawRectOutlineLayer(ctx, rect, outlineMode, alpha);
    for (const rect of geometry.rects) drawRectColorLayer(ctx, rect, color, alpha);
    ctx.restore();

    const dynamic = DYNAMIC_PIXEL_STYLES.has(geometry.style);
    canvas.dataset.crosshairRenderer = `cs2-native-test12-14-style-${geometry.style}`;
    canvas.dataset.crosshairStyle = String(geometry.style);
    canvas.dataset.crosshairDynamic = dynamic ? '1' : '0';
    canvas.dataset.crosshairOutlineMode = String(outlineMode);
    canvas.dataset.crosshairSourceVersion = String(crosshair?.sourceVersion ?? 'cfg');
    canvas.dataset.crosshairGeometry = geometry.approximateDynamic ? 'native-static-base' : 'native-static';
    canvas.dataset.crosshairPreviewScreenHeight = String(geometry.previewScreenHeight);
    canvas.dataset.crosshairPreviewScreenWidth = String(geometry.previewScreenWidth);
    canvas.dataset.crosshairPreviewResolution = `${geometry.previewScreenWidth}x${geometry.previewScreenHeight}`;
    canvas.dataset.crosshairAuthoredScreenHeight = String(geometry.authoredScreenHeight);
    const label = PIXEL_STYLE_NAMES[geometry.style] || `Style ${geometry.style}`;
    const notes = [];
    if (geometry.approximateDynamic) notes.push('для динамического стиля показан базовый/idle кадр без состояния оружия');
    canvas.removeAttribute('title');
}

function svgEscape(value) {
    return String(value).replace(/[&<>"']/g, (ch) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[ch]));
}

export function crosshairToSVG(crosshair, width = 100, height = 100) {
    width = Math.max(1, Math.round(Number(width) || 100));
    height = Math.max(1, Math.round(Number(height) || 100));
    if (crosshair?.schema === 'CS32') {
        if (typeof document === 'undefined') throw new Error('Экспорт CS32 SVG требует Canvas в браузере');
        const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
        drawPixelCrosshair(crosshair, canvas);
        return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><image width="${width}" height="${height}" href="${canvas.toDataURL('image/png')}"/></svg>`;
    }
    const geometry = getPixelGeometry(crosshair, width, height);
    const rgb = Array.isArray(crosshair?.rgb)
        ? crosshair.rgb.map((value) => clampPixel(Math.round(Number(value) || 0), 0, 255))
        : [0,255,0];
    const color = `rgb(${rgb.join(',')})`;
    const alpha = clampPixel(Number(crosshair?.alpha ?? 255), 0, 255) / 255;
    const outlineMode = clampPixel(Math.trunc(Number(crosshair?.outlineMode ?? crosshair?.outline ?? (crosshair?.outlineEnabled ? 1 : 0)) || 0), 0, 2);
    const items = [];
    for (const circle of geometry.circles) {
        const {cx,cy,radius,lineWidth} = circle;
        if (outlineMode === 1) items.push(`<circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="#000" stroke-opacity="0.53" stroke-width="${lineWidth+2}"/>`);
        else if (outlineMode === 2) items.push(`<path d="M ${cx-radius} ${cy} A ${radius} ${radius} 0 0 1 ${cx} ${cy-radius}" fill="none" stroke="#000" stroke-opacity="0.53" stroke-width="${lineWidth+2}"/>`);
        items.push(`<circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="${svgEscape(color)}" stroke-width="${lineWidth}"/>`);
    }
    // Same two-pass layering as the Canvas renderer: all outline geometry first,
    // then all colored pips. This is essential for gap=0 micro-crosses.
    for (const [x,y,w,h] of geometry.rects) {
        if (outlineMode === 1) items.push(`<rect x="${x-1}" y="${y-1}" width="${w+2}" height="${h+2}" fill="#000" fill-opacity="0.67"/>`);
        else if (outlineMode === 2) {
            items.push(`<rect x="${x-1}" y="${y-1}" width="${w+1}" height="1" fill="#000" fill-opacity="0.67"/>`);
            items.push(`<rect x="${x-1}" y="${y}" width="1" height="${h}" fill="#000" fill-opacity="0.67"/>`);
        }
    }
    for (const [x,y,w,h] of geometry.rects) {
        items.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${svgEscape(color)}"/>`);
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" shape-rendering="crispEdges"><g opacity="${alpha}">${items.join('')}</g></svg>`;
}

// Decode and validate the 18-byte share-code envelope.
export function inspectShareCode(value) {
  const code=String(value??'').trim();
  if(/^CS[ABCDEFGHJKLMNOPQRSTUVWXYZabcdefhijkmnopqrstuvwxyz23456789]{44}$/.test(code)){
    let total=0n;
    for(const ch of code.slice(2).split('').reverse())total=total*SHARE_BASE+BigInt(SHARE_ALPHABET.indexOf(ch));
    if(total>=1n<<256n)throw new Error('Новый код превышает 32 байта');
    const bytes=new Uint8Array(32);
    for(let i=31;i>=0;i--){bytes[i]=Number(total&255n);total>>=8n;}
    if(bytes[0]!== (bytes.slice(1).reduce((a,b)=>a+b,0)&255))throw new Error('Неверная контрольная сумма нового кода');
    if(bytes[1]!==1)throw new Error('Неподдерживаемая версия нового формата CS: '+bytes[1]);
    if(!u16le(bytes,2))throw new Error('В новом коде не указана высота экрана');
    return {code,version:bytes[1],schema:'CS32',bytes};
  }
  // The supplied legacy decoder checks all 17 trailing bytes; modern checks 1..15.
  const alphabet=SHARE_ALPHABET;
  if(!/^CSGO(?:-[ABCDEFGHJKLMNOPQRSTUVWXYZabcdefhijkmnopqrstuvwxyz23456789]{5}){5}$/.test(code))throw new Error('Неверный формат кода прицела');
  let total=0n;
  for(const ch of code.slice(5).replaceAll('-','').split('').reverse())total=total*SHARE_BASE+BigInt(alphabet.indexOf(ch));
  if(total>=1n<<144n)throw new Error('Код превышает 18 байт');
  const bytes=new Uint8Array(18);
  for(let i=17;i>=0;i--){bytes[i]=Number(total&255n);total>>=8n;}
  const version=bytes[1];
  if(![1,3,4].includes(version))throw new Error('Неподдерживаемая версия прицела: '+version);
  const sum=bytes.slice(1,version===1?18:16).reduce((a,b)=>a+b,0)&255;
  if(bytes[0]!==sum)throw new Error('Неверная контрольная сумма');
  return {code,version,bytes};
}

export function decodeModernShareCode(parsedOrCode) {
    const parsed = typeof parsedOrCode === 'string' ? inspectShareCode(parsedOrCode) : parsedOrCode;
    if (parsed?.schema === 'CS32' || parsed?.bytes?.length === 32) return decodeCS32(parsed);
    if (!parsed || parsed.version < 3) throw new Error(`Ожидался современный share-code версии >=3, получена версия ${parsed?.version}`);
    const b = parsed.bytes;
    const flags = b[2];
    const style = flags & 0x0f;
    const styleKnown = style >= 0 && style <= 8;
    const packed = u32le(b, 10);
    const splitQ = packed & 0x7f;
    const innerQ = (packed >>> 7) & 0x1f;
    const outerQ = (packed >>> 12) & 0x0f;
    const ratioQ = (packed >>> 16) & 0x7f;
    const thickness = Math.max(1, (packed >>> 23) & 0x1f);
    const outlineMode = parsed.version === 3 ? ((flags & 0x20) ? 1 : 0) : clampPixel((packed >>> 28) & 0x03, 0, 2);

    return {
        format: 'csconfig-pixels',
        source: `share-v${parsed.version}`,
        sourceVersion: parsed.version,
        experimental: false,
        style: styleKnown ? style : 4,
        styleKnown,
        styleRaw: flags,
        styleName: PIXEL_STYLE_NAMES[styleKnown ? style : 4],
        recoil: Boolean(flags & 0x10),
        outlineMode,
        outline: outlineMode,
        outlineEnabled: outlineMode !== 0,
        outlineThickness: outlineMode !== 0 ? 1 : 0,
        dot: Boolean(flags & 0x40),
        tStyle: Boolean(flags & 0x80),
        rgb: [b[3], b[4], b[5]],
        alpha: b[6],
        gap: b[7],
        length: b[8],
        dynamicSpreadLimit: b[9],
        splitDistance: splitQ,
        innerSplitAlpha: clampPixel(innerQ * 0.05, 0, 1),
        outerSplitAlpha: clampPixel(0.3 + outerQ * 0.05, 0.3, 1),
        splitSizeRatio: clampPixel(ratioQ * 0.01, 0, 1.27),
        thickness,
        screenHeight: u16le(b, 14),
        reserved: [b[16], b[17]],
        rawPacked: packed,
        rawBytes: Array.from(b),
        lengthKnown: true,
        thicknessKnown: true,
        gapKnown: true,
        alphaKnown: true
    };
}

export function decodePixelShareCodeV3(parsed) {
    if (parsed.version !== 3) throw new Error('Ожидалась версия 3');
    return decodeModernShareCode(parsed);
}

export function decodePixelShareCodeV4(parsed) {
    if (parsed.version !== 4) throw new Error('Ожидалась версия 4');
    return decodeModernShareCode(parsed);
}

function bytesToShareCode(bytes) {
    let total = 0n;
    for (const byte of bytes) total = (total << 8n) | BigInt(byte & 0xff);
    let chars = '';
    for (let i=0; i<25; i++) {
        const rem = total % SHARE_BASE;
        chars += SHARE_ALPHABET[Number(rem)];
        total /= SHARE_BASE;
    }
    return `CSGO-${chars.slice(0,5)}-${chars.slice(5,10)}-${chars.slice(10,15)}-${chars.slice(15,20)}-${chars.slice(20,25)}`;
}

function quantizeFloor(value, min, max, step, offset = 0) {
    const v = clampPixel(Number(value), min, max);
    return Math.floor(((v - offset) / step) + 1e-6);
}

export function encodeModernShareCode(crosshair = {}, options = {}) {
    const c = crosshair.format === 'csconfig-pixels' ? crosshair : parsePixelConfig(String(crosshair ?? ''), true);
    if (!c) throw new Error('Не удалось получить современные параметры прицела');
    const version = clampPixel(Math.trunc(Number(options.version ?? 3) || 3), 3, 4);
    const style = clampPixel(Math.trunc(Number(c.style) || 0), 0, version >= 4 ? 8 : 7);
    const outlineMode = clampPixel(Math.trunc(Number(c.outlineMode ?? c.outline ?? (c.outlineEnabled ? 1 : 0)) || 0), 0, 2);
    if (version === 3 && outlineMode === 2) throw new Error('Share-code v3 не поддерживает Half outline; используйте v4');

    const bytes = new Uint8Array(18);
    bytes[1] = version;
    bytes[2] = style
        | (c.recoil ? 0x10 : 0)
        | (version === 3 && outlineMode ? 0x20 : 0)
        | (c.dot ? 0x40 : 0)
        | (c.tStyle ? 0x80 : 0);
    bytes[3] = clampPixel(Math.round(Number(c.rgb?.[0] ?? 0)), 0, 255);
    bytes[4] = clampPixel(Math.round(Number(c.rgb?.[1] ?? 255)), 0, 255);
    bytes[5] = clampPixel(Math.round(Number(c.rgb?.[2] ?? 0)), 0, 255);
    bytes[6] = clampPixel(Math.round(Number(c.alpha ?? 255)), 0, 255);
    bytes[7] = clampPixel(Math.round(Number(c.gap) || 0), 0, 255);
    bytes[8] = clampPixel(Math.round(Number(c.length) || 0), 0, 255);
    bytes[9] = clampPixel(Math.round(Number(c.dynamicSpreadLimit ?? 255)), 0, 255);

    const splitQ = clampPixel(Math.round(Number(c.splitDistance ?? 3)), 0, 127);
    const innerQ = clampPixel(quantizeFloor(c.innerSplitAlpha ?? 0, 0, 1, 0.05), 0, 31);
    const outerQ = clampPixel(quantizeFloor(c.outerSplitAlpha ?? 1, 0.3, 1, 0.05, 0.3), 0, 15);
    const ratioQ = clampPixel(quantizeFloor(c.splitSizeRatio ?? 1, 0, 1.27, 0.01), 0, 127);
    const thickness = clampPixel(bankersRound(Number(c.thickness) || 1), 1, 31);
    let packed = (splitQ & 0x7f)
        | ((innerQ & 0x1f) << 7)
        | ((outerQ & 0x0f) << 12)
        | ((ratioQ & 0x7f) << 16)
        | ((thickness & 0x1f) << 23);
    if (version >= 4) packed |= (outlineMode & 0x03) << 28;
    packed >>>= 0;
    bytes[10] = packed & 0xff;
    bytes[11] = (packed >>> 8) & 0xff;
    bytes[12] = (packed >>> 16) & 0xff;
    bytes[13] = (packed >>> 24) & 0xff;

    const screenHeight = clampPixel(Math.round(Number(options.screenHeight ?? c.screenHeight ?? 960) || 960), 1, 65535);
    bytes[14] = screenHeight & 0xff;
    bytes[15] = (screenHeight >>> 8) & 0xff;
    bytes[16] = 0;
    bytes[17] = 0;
    bytes[0] = bytes.slice(1,16).reduce((sum, value) => sum + value, 0) & 0xff;
    return bytesToShareCode(bytes);
}

export function encodePixelShareCodeV4(crosshair = {}, options = {}) {
    return encodeModernShareCode(crosshair, {...options, version: 4});
}

// Backwards-compatible export name used by earlier site modules. It now encodes the exact
// modern format; pass {version:3} only when a literal v3 code is required.
export function encodePixelShareCodeV3(crosshair = {}, options = {}) {
    return encodeModernShareCode(crosshair, {...options, version: Number(options.version ?? 3)});
}

export function pixelConfigToShareCodeV3(text, options = {}) {
    const modern = parsePixelConfig(text, true);
    if (!modern) throw new Error('Современный конфиг прицела не распознан');
    return encodeModernShareCode(modern, {...options, version: Number(options.version ?? 3)});
}

export function drawCrosshairError(canvas, message) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    ctx.save(); ctx.setTransform(1,0,0,1,0,0); ctx.globalAlpha = 1;
    ctx.clearRect(0,0,canvas.width,canvas.height); ctx.fillStyle = '#ddd';
    ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('Ошибка кода', canvas.width/2, canvas.height/2, Math.max(1, canvas.width-8));
    ctx.restore(); canvas.removeAttribute('title'); canvas.dataset.crosshairRenderer = 'error';
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function normalizeCrosshair(raw = {}) {
    const crosshair = { ...raw };

    crosshair.cl_crosshairgap = Number.isFinite(crosshair.cl_crosshairgap)
        ? crosshair.cl_crosshairgap
        : Number.isFinite(crosshair.gap)
            ? crosshair.gap
            : 0;

    crosshair.cl_crosshair_outlinethickness = Number.isFinite(crosshair.cl_crosshair_outlinethickness)
        ? crosshair.cl_crosshair_outlinethickness
        : Number.isFinite(crosshair.outline)
            ? crosshair.outline
            : 0;

    crosshair.cl_crosshaircolor_r = Number.isFinite(crosshair.cl_crosshaircolor_r)
        ? crosshair.cl_crosshaircolor_r
        : Number.isFinite(crosshair.color_r)
            ? crosshair.color_r
            : 0;

    crosshair.cl_crosshaircolor_g = Number.isFinite(crosshair.cl_crosshaircolor_g)
        ? crosshair.cl_crosshaircolor_g
        : Number.isFinite(crosshair.color_g)
            ? crosshair.color_g
            : 255;

    crosshair.cl_crosshaircolor_b = Number.isFinite(crosshair.cl_crosshaircolor_b)
        ? crosshair.cl_crosshaircolor_b
        : Number.isFinite(crosshair.color_b)
            ? crosshair.color_b
            : 0;

    crosshair.cl_crosshairalpha = Number.isFinite(crosshair.cl_crosshairalpha)
        ? crosshair.cl_crosshairalpha
        : Number.isFinite(crosshair.alpha)
            ? crosshair.alpha
            : 255;

    crosshair.cl_crosshair_dynamic_splitdist = Number.isFinite(crosshair.cl_crosshair_dynamic_splitdist)
        ? crosshair.cl_crosshair_dynamic_splitdist
        : Number.isFinite(crosshair.splitDistance)
            ? crosshair.splitDistance
            : 7;

    crosshair.cl_fixedcrosshairgap = Number.isFinite(crosshair.cl_fixedcrosshairgap)
        ? crosshair.cl_fixedcrosshairgap
        : Number.isFinite(crosshair.fixedCrosshairGap)
            ? crosshair.fixedCrosshairGap
            : 0;

    crosshair.cl_crosshaircolor = Number.isFinite(crosshair.cl_crosshaircolor)
        ? crosshair.cl_crosshaircolor
        : Number.isFinite(crosshair.color)
            ? crosshair.color
            : 5;

    crosshair.cl_crosshair_drawoutline = typeof crosshair.cl_crosshair_drawoutline === 'boolean'
        ? crosshair.cl_crosshair_drawoutline
        : typeof crosshair.outline_draw === 'boolean'
            ? crosshair.outline_draw
            : Number(crosshair.outline_draw) === 1;

    crosshair.cl_crosshair_dynamic_splitalpha_innermod = Number.isFinite(crosshair.cl_crosshair_dynamic_splitalpha_innermod)
        ? crosshair.cl_crosshair_dynamic_splitalpha_innermod
        : Number.isFinite(crosshair.innerSplitAlpha)
            ? crosshair.innerSplitAlpha
            : 1;

    crosshair.cl_crosshair_dynamic_splitalpha_outermod = Number.isFinite(crosshair.cl_crosshair_dynamic_splitalpha_outermod)
        ? crosshair.cl_crosshair_dynamic_splitalpha_outermod
        : Number.isFinite(crosshair.outerSplitAlpha)
            ? crosshair.outerSplitAlpha
            : 0.3;

    crosshair.cl_crosshair_dynamic_maxdist_splitratio = Number.isFinite(crosshair.cl_crosshair_dynamic_maxdist_splitratio)
        ? crosshair.cl_crosshair_dynamic_maxdist_splitratio
        : Number.isFinite(crosshair.splitSizeRatio)
            ? crosshair.splitSizeRatio
            : 0.35;

    crosshair.cl_crosshairthickness = Number.isFinite(crosshair.cl_crosshairthickness)
        ? crosshair.cl_crosshairthickness
        : Number.isFinite(crosshair.thickness)
            ? crosshair.thickness
            : 1;

    crosshair.cl_crosshairdot = typeof crosshair.cl_crosshairdot === 'boolean'
        ? crosshair.cl_crosshairdot
        : typeof crosshair.dot === 'boolean'
            ? crosshair.dot
            : Number(crosshair.dot) === 1;

    crosshair.cl_crosshairgap_useweaponvalue = typeof crosshair.cl_crosshairgap_useweaponvalue === 'boolean'
        ? crosshair.cl_crosshairgap_useweaponvalue
        : typeof crosshair.deployedWeaponGapEnabled === 'boolean'
            ? crosshair.deployedWeaponGapEnabled
            : Number(crosshair.deployedWeaponGapEnabled) === 1;

    crosshair.cl_crosshairusealpha = typeof crosshair.cl_crosshairusealpha === 'boolean'
        ? crosshair.cl_crosshairusealpha
        : typeof crosshair.usealpha === 'boolean'
            ? crosshair.usealpha
            : Number(crosshair.usealpha) === 1;

    crosshair.cl_crosshair_t = typeof crosshair.cl_crosshair_t === 'boolean'
        ? crosshair.cl_crosshair_t
        : typeof crosshair.crosshair_t === 'boolean'
            ? crosshair.crosshair_t
            : Number(crosshair.crosshair_t) === 1;

    crosshair.cl_crosshairstyle = Number.isFinite(crosshair.cl_crosshairstyle)
        ? crosshair.cl_crosshairstyle
        : Number.isFinite(crosshair.style)
            ? crosshair.style
            : 4;

    crosshair.cl_crosshairsize = Number.isFinite(crosshair.cl_crosshairsize)
        ? crosshair.cl_crosshairsize
        : Number.isFinite(crosshair.size)
            ? crosshair.size
            : 4;

    crosshair.cl_crosshair_recoil = typeof crosshair.cl_crosshair_recoil === 'boolean'
        ? crosshair.cl_crosshair_recoil
        : false;

    crosshair.cl_crosshairgap = clamp(crosshair.cl_crosshairgap, -100, 100);
    crosshair.cl_crosshairalpha = clamp(crosshair.cl_crosshairalpha, 0, 255);
    crosshair.cl_crosshaircolor = clamp(crosshair.cl_crosshaircolor, 0, 5);
    crosshair.cl_crosshairsize = Math.max(0, crosshair.cl_crosshairsize);
    crosshair.cl_crosshairthickness = Math.max(0.5, crosshair.cl_crosshairthickness);
    crosshair.cl_crosshair_outlinethickness = clamp(crosshair.cl_crosshair_outlinethickness, 0, 3);

    return crosshair;
}

function applyColorPreset(crosshair) {
    const presets = [
        [255, 0, 0],
        [0, 255, 0],
        [255, 255, 0],
        [0, 0, 255],
        [0, 255, 255]
    ];

    if (crosshair.cl_crosshaircolor >= 0 && crosshair.cl_crosshaircolor <= 4) {
        const preset = presets[crosshair.cl_crosshaircolor];
        crosshair.cl_crosshaircolor_r = preset[0];
        crosshair.cl_crosshaircolor_g = preset[1];
        crosshair.cl_crosshaircolor_b = preset[2];
    }

    return crosshair;
}

function drawBlock(ctx, x, y, w, h, outline, outlineEnabled) {
    ctx.fillRect(x, y, w, h);

    if (outlineEnabled && outline > 0) {
        if (outline < 1) {
            const half = 0.5 * Math.max(1, Math.floor(outline));
            ctx.beginPath();
            ctx.moveTo(x - half, y + h);
            ctx.lineTo(x - half, y - half);
            ctx.lineTo(x + w, y - half);
            ctx.stroke();
        } else {
            const n = Math.max(1, Math.floor(outline));
            const xy = 0.5 * n;
            const wh = 1 * n;
            ctx.strokeRect(x - xy, y - xy, w + wh, h + wh);
        }
    }
}

function renderCrosshairToCanvas(crosshair, canvas, isPreviewWeapon = false) {
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const data = applyColorPreset(normalizeCrosshair(crosshair));
    const center = canvas.width / 2;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    canvas.style.backgroundColor = '#444444';

    ctx.strokeStyle = '#000000';
    ctx.fillStyle = `rgb(${data.cl_crosshaircolor_r}, ${data.cl_crosshaircolor_g}, ${data.cl_crosshaircolor_b})`;
    ctx.globalAlpha = (data.cl_crosshairusealpha ? data.cl_crosshairalpha : 255) / 255;

    const outlineEnabled = data.cl_crosshair_drawoutline;
    const outlineThickness = data.cl_crosshair_outlinethickness;
    const strokeWidth = Math.max(1, Math.floor(outlineThickness));
    ctx.lineWidth = strokeWidth;

    const thickness = Math.max(1, Math.floor((data.cl_crosshairthickness + 0.2222) / 0.4444));
    let length = Math.floor((data.cl_crosshairsize + 0.2222) / 0.4445);
    const armX = center - Math.floor(thickness / 2);

    let gap = (data.cl_crosshairgap < 0 ? -Math.floor(-data.cl_crosshairgap) : Math.floor(data.cl_crosshairgap)) + 4;

    if (data.cl_crosshairstyle !== 2 || isPreviewWeapon) {
        gap = (data.cl_crosshairgap < -4 ? -Math.floor(-data.cl_crosshairgap) : Math.floor(data.cl_crosshairgap)) + 4;

        if (isPreviewWeapon && data.cl_crosshairgap_useweaponvalue) {
            gap += 3;
        }
    } else if (data.cl_crosshair_dynamic_splitdist < 3) {
        const innerLength = Math.ceil(length * (1 - data.cl_crosshair_dynamic_maxdist_splitratio));
        const originalAlpha = ctx.globalAlpha;

        length = Math.floor(length * data.cl_crosshair_dynamic_maxdist_splitratio);
        ctx.globalAlpha = originalAlpha * (1 - Math.pow(1 - data.cl_crosshair_dynamic_splitalpha_outermod, 0.45));

        drawBlock(ctx, armX + thickness + gap + innerLength + 1, armX, length, thickness, outlineThickness, outlineEnabled);
        drawBlock(ctx, armX - gap - length - innerLength - 1, armX, length, thickness, outlineThickness, outlineEnabled);

        if (!data.cl_crosshair_t) {
            drawBlock(ctx, armX, armX - gap - length - innerLength - 1, thickness, length, outlineThickness, outlineEnabled);
        }

        drawBlock(ctx, armX, armX + thickness + gap + innerLength + 1, thickness, length, outlineThickness, outlineEnabled);

        ctx.globalAlpha = originalAlpha * (1 - Math.pow(1 - data.cl_crosshair_dynamic_splitalpha_innermod, 0.45));
        length = innerLength;
        gap += 2 * data.cl_crosshair_dynamic_splitdist - 4;
    } else {
        gap += 1;
    }

    drawBlock(ctx, armX + thickness + gap, armX, length, thickness, outlineThickness, outlineEnabled);
    drawBlock(ctx, armX - gap - length, armX, length, thickness, outlineThickness, outlineEnabled);

    if (!data.cl_crosshair_t) {
        drawBlock(ctx, armX, armX - gap - length, thickness, length, outlineThickness, outlineEnabled);
    }

    drawBlock(ctx, armX, armX + thickness + gap, thickness, length, outlineThickness, outlineEnabled);

    if (data.cl_crosshairdot) {
        drawBlock(ctx, armX, armX, thickness, thickness, outlineThickness, outlineEnabled);
    }
}

function findCS32Source(crosshair, canvas) {
    const candidates = [typeof crosshair === 'string' ? crosshair : '', crosshair?.sourceCode, crosshair?.code, crosshair?.shareCode, canvas?.dataset?.shareCode, canvas?.dataset?.crosshairCode];
    for (const value of candidates) if (typeof value === 'string' && /^CS[ABCDEFGHJKLMNOPQRSTUVWXYZabcdefhijkmnopqrstuvwxyz23456789]{44}$/.test(value.trim())) return value.trim();
    let parent = canvas?.parentElement;
    while (parent) {
        const nodes = parent.querySelectorAll?.('.code-crosshair, #crosshairShareCode') || [];
        const sources = Array.from(nodes).map(n => n.textContent?.trim()).filter(v => /^CS[ABCDEFGHJKLMNOPQRSTUVWXYZabcdefhijkmnopqrstuvwxyz23456789]{44}$/.test(v || ''));
        if (sources.length === 1) return sources[0];
        if (sources.length > 1) return null;
        parent = parent.parentElement;
    }
    return null;
}
export default function drowCrosshair(crosshair, target) {
    const canvas = target || document.getElementById('canvas');
    if (!canvas) return;
    const source = findCS32Source(crosshair, canvas);
    if (source) {
        try { return drawPixelCrosshair(decodeCS32ShareCode(source), canvas); }
        catch (e) { return drawCrosshairError(canvas, e.message); }
    }
    if (crosshair?.error) drawCrosshairError(canvas, crosshair.error);
    else if (crosshair?.format === 'csconfig-pixels') drawPixelCrosshair(crosshair, canvas);
    else if (crosshair && typeof crosshair === 'object') renderCrosshairToCanvas(crosshair, canvas, false);
    else drawCrosshairError(canvas, 'Не удалось прочитать код прицела');
}

// CS32 native decoder and current 1280x960 renderer.
function decodeCS32(parsed) {
  const b=parsed.bytes, flags=b[4], packed=u32le(b,18), gap=u16le(b,14);
  const style=Math.min(flags&31,9);
  return {format:'csconfig-pixels',schema:'CS32',sourceVersion:'CS/1',version:1,
    screenHeight:Math.max(240,u16le(b,2)),style,styleKnown:true,styleName:PIXEL_STYLE_NAMES[style],
    dot:Boolean(flags&64),tStyle:Boolean(flags&32),recoil:Boolean(flags&128),
    rgb:Array.from(b.slice(5,8)),alpha:b[8],outlineRgb:Array.from(b.slice(9,12)),outlineAlpha:b[12],
    outlineMode:Math.min(b[13]>>>6,2),thickness:Math.min(b[13]&63,32),
    gap:clampPixel(gap>=32768?gap-65536:gap,-3840,3840),length:b[16],dynamicSpreadLimit:b[17],
    splitDistance:packed&127,innerSplitAlpha:Math.min((packed>>>7)&127,100)/100,
    outerSplitAlpha:0.3+Math.min((packed>>>14)&127,70)/100,
    splitSizeRatio:Math.min((packed>>>21)&127,100)/100,
    ironsightUseCrosshairColor:Boolean(packed&0x10000000),ironsightDotScale:0.1+Math.min(b[22],190)/100,
    lengthKnown:true,thicknessKnown:true,gapKnown:true,alphaKnown:true};
}
function getCS32Geometry(c,width=100,height=100){
  const authoredScreenHeight=c.screenHeight,previewScreenHeight=960;
  const renderScale=previewScreenHeight/authoredScreenHeight;
  // client.dll 0x180dba180 normalizes the settings BEFORE making primitives.
  // roundf uses ties away from zero; positive settings stay at least 1, negative gap at most -1.
  const normalize=(value)=>{
    if(!value||authoredScreenHeight===previewScreenHeight)return value;
    const scaled=Math.fround(Math.fround(renderScale)*value);
    const rounded=Math.sign(scaled)*Math.floor(Math.abs(scaled)+0.5);
    return value>0?Math.max(1,rounded):Math.min(-1,rounded);
  };
  const thickness=normalize(c.thickness),length=normalize(c.length),gap=normalize(c.gap);
  const cx=Math.ceil(width/2),cy=Math.ceil(height/2),style=c.style,rects=[],circles=[];
  // Native cross wrappers clamp negative gap to zero (0x180da4210); preserve the signed setting.
  if(thickness>0){
    if(CROSS_ARM_STYLES.has(style))rects.push(...nativeCrossRects(cx,cy,gap,length,thickness,c.tStyle));
    if(style===8)rects.push(...nativeSquareRects(cx,cy,gap,thickness,c.dot));
    if(style===7)rects.push(...quadCornerRects(cx,cy,gap,length,thickness));
    if(CIRCLE_STYLES.has(style)||style===9){
      const info=nativeThicknessInfo(thickness);
      // The primitive helper subtracts 0.5, plus the wrapper's odd-thickness correction.
      const shift=style===9?(thickness>=1&&!info.even?1:0.5):(info.even?0.5:1);
      circles.push({cx:cx-shift,cy:cy-shift,radius:Math.max(1,gap)+thickness,
        lineWidth:style===9?thickness:Math.max(1,thickness-1),
        quadrant:style===9,angularWidth:c.splitSizeRatio*Math.PI/2});
    }
    if(c.dot||style===6)rects.push(nativeDotRect(cx,cy,thickness));
  }
  return {style,thickness,length,gap,cx,cy,rects,circles,approximateDynamic:DYNAMIC_PIXEL_STYLES.has(style),
    authoredScreenHeight,previewScreenHeight,previewScreenWidth:1280,renderScale};
}
function drawCS32(c,canvas){
  if(!canvas)return;const ctx=canvas.getContext('2d');if(!ctx)return;
  const g=getCS32Geometry(c,canvas.width,canvas.height),img=ctx.createImageData(canvas.width,canvas.height);
  const low=c.outlineMode?1:0,high=c.outlineMode===1?1:0;
  const smooth=(a,b,x)=>{const t=clampPixel((x-a)/(b-a),0,1);return t*t*(3-2*t);};
  // client.dll converts RGBA RGB channels from sRGB to linear before shader composition.
  const toLinear=v=>{v/=255;return v<=0.04045?v/12.92:Math.pow((v+0.055)/1.055,2.4);};
  const toSrgb=v=>255*(v<=0.0031308?12.92*v:1.055*Math.pow(v,1/2.4)-0.055);
  const mainRgb=c.rgb.map(toLinear),outlineRgb=c.outlineRgb.map(toLinear);
  const bgText=canvas.dataset&&canvas.dataset.crosshairBackground;
  const bgParts=bgText?bgText.split(',').map(Number):null;
  const background=bgParts&&bgParts.length===3&&bgParts.every(v=>Number.isFinite(v)&&v>=0&&v<=255)?bgParts.map(toLinear):null;
  for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){
    let main=0,outline=0;
    for(const [rx,ry,w,h] of g.rects){
      if(w<=0||h<=0)continue;
      if(x>=rx&&x<=rx+w-1&&y>=ry&&y<=ry+h-1)main=1;
      if(x>=rx-low&&x<=rx+w-1+high&&y>=ry-low&&y<=ry+h-1+high)outline=1;
    }
    for(const ring of g.circles){
      const dx=x-ring.cx,dy=y-ring.cy,d=Math.hypot(dx,dy),angle=Math.atan2(dx,-dy);
      const mix=Math.max(smooth(0,Math.PI/2,angle),smooth(-Math.PI/2,-Math.PI,angle));
      const outer=low+(high-low)*mix,inner=high+(low-high)*mix;
      const r=ring.radius,ri=r-ring.lineWidth;
      let m=smooth(r+0.5,r-0.5,d)*smooth(ri-0.5,ri+0.5,d);
      let o=smooth(r+outer+0.5,r+outer-0.5,d)*smooth(ri-inner-0.5,ri-inner+0.5,d);
      if(ring.quadrant){
        const da=Math.abs(angle-Math.floor(angle/(Math.PI/2))*(Math.PI/2)-Math.PI/4),dist=Math.max(d,1),half=ring.angularWidth/2;
        m*=smooth(half+0.5/dist,half-0.5/dist,da);
        o*=smooth(half+(outer+0.5)/dist,half+(outer-0.5)/dist,da);
      }
      main=Math.max(main,m);outline=Math.max(outline,o);
    }
    // Combine masks once: overlapping arms/dot must not accumulate opacity or obscure color.
    const ma=main*c.alpha/255;
    // Native shader: oa=(1-ma)*outlineAlpha; lerp(oa,1,ma) applies (1-ma) again.
    const oa=c.outlineMode?outline*c.outlineAlpha/255*(1-ma):0,ow=oa*(1-ma),a=ma+ow;
    const p=(y*canvas.width+x)*4;
    if(a>0)for(let k=0;k<3;k++){
      const premult=mainRgb[k]*ma+outlineRgb[k]*ow;
      // For a known solid preview background, perform GPU-like blending in linear light.
      const value=background?premult+background[k]*(1-a):premult/a;
      img.data[p+k]=Math.round(clampPixel(toSrgb(value),0,255));
    }
    img.data[p+3]=a>0&&background?255:Math.round(a*255);
  }
  ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);ctx.putImageData(img,0,0);ctx.restore();
  canvas.dataset.crosshairRenderer='cs2-CS32-20261001';canvas.dataset.crosshairStyle=String(c.style);
  canvas.dataset.crosshairDynamic=g.approximateDynamic?'1':'0';canvas.dataset.crosshairOutlineMode=String(c.outlineMode);
  canvas.dataset.crosshairGeometry=g.approximateDynamic?'native-static-base':'native-static';
  canvas.dataset.crosshairPreviewScreenHeight=String(g.previewScreenHeight);canvas.dataset.crosshairPreviewScreenWidth='1280';
  canvas.dataset.crosshairPreviewResolution='1280x'+g.previewScreenHeight;canvas.dataset.crosshairAuthoredScreenHeight=String(c.screenHeight);
  canvas.removeAttribute('title');
}


export function encodeCS32ShareCode(crosshair = {}, options = {}) {
 const c=crosshair.format==='csconfig-pixels'?crosshair:parsePixelConfig(String(crosshair ?? ''),true);
 const alphabet=SHARE_ALPHABET;
 const b=new Uint8Array(32),d=new DataView(b.buffer),clamp=(n,l,h)=>Math.min(h,Math.max(l,n));
 b[1]=1;d.setUint16(2,clamp(Math.round(options.screenHeight??c.screenHeight??960),240,65535),true);
 b[4]=clamp(Math.trunc(c.style),0,9)|(c.dot?64:0)|(c.tStyle?32:0)|(c.recoil?128:0);
 b.set(c.rgb.map(v=>clamp(Math.round(v),0,255)),5);b[8]=clamp(Math.round(c.alpha),0,255);
 b.set((c.outlineRgb||[0,0,0]).map(v=>clamp(Math.round(v),0,255)),9);b[12]=c.outlineAlpha==null?255:clamp(Math.round(c.outlineAlpha),0,255);
 b[13]=clamp(Math.round(c.thickness),0,32)|(clamp(Math.trunc(c.outlineMode),0,2)<<6);
 d.setInt16(14,clamp(Math.round(c.gap),-3840,3840),true);b[16]=clamp(Math.round(c.length),0,255);b[17]=clamp(Math.round(c.dynamicSpreadLimit==null?255:c.dynamicSpreadLimit),0,255);
 const split=clamp(Math.round(c.splitDistance==null?3:c.splitDistance),0,127),inner=clamp(Math.round((c.innerSplitAlpha||0)*100),0,100),outer=clamp(Math.round(((c.outerSplitAlpha==null?1:c.outerSplitAlpha)-.3)*100),0,70),ratio=clamp(Math.round((c.splitSizeRatio==null?1:c.splitSizeRatio)*100),0,100);
 d.setUint32(18,(split|(inner<<7)|(outer<<14)|(ratio<<21)|(c.ironsightUseCrosshairColor?1<<28:0))>>>0,true);
 b[22]=clamp(Math.round(((c.ironsightDotScale==null?1:c.ironsightDotScale)-.1)*100),0,190);
 b[0]=b.slice(1).reduce((a,v)=>a+v,0)&255;let n=0n;for(const v of b)n=n*256n+BigInt(v);let code='CS';for(let i=0;i<44;i++){code+=alphabet[Number(n%57n)];n/=57n;}if(n)throw Error('Код превышает допустимый размер');return code;
}
export function decodeCS32ShareCode(source) {
 const parsed=typeof source==='string'?inspectShareCode(source):source;
 if(parsed?.schema!=='CS32'&&parsed?.bytes?.length!==32)throw new Error('Ожидался новый код CS…');
 return decodeCS32(parsed);
}
