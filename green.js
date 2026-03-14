/**
 * CRT Subpixel Renderer v4 — WebGL + Typewriter + Paging
 *
 * Changes from v3:
 *   - Aligned grid: no brick-wall offset (all RGB groups on same row)
 *   - Flood: bright components (>50%) bleed into dim adjacent subpixels
 *
 * Cell layout (2px wide x 3px tall per logical pixel):
 *   row 0=R, row 1=G, row 2=B (vertical subpixel stripes)
 *
 * The offscreen 2D canvas contains full-color text.
 * The shader reads RGB from the texture and maps each channel
 * to the corresponding phosphor subpixel.
 */
(function () {
    // --- Config ---
    var DENSITY = 2;    // canvas multiplier (1=normal, 2=4x more RGB cells, 4=16x)
    var CELL_W = 2;
    var CELL_H = 3;
    var FONT_SIZE = 14 * DENSITY;
    var LINE_HEIGHT = 1.4;
    var FONT = FONT_SIZE + "px 'VT323', monospace";
    var FONT_TITLE = FONT_SIZE + "px 'VT323', monospace";
    var FONT_META = (FONT_SIZE - 2 * DENSITY) + "px 'VT323', monospace";
    var PADDING_X = 4 * DENSITY;
    var PADDING_TOP = 4 * DENSITY;
    var PADDING_BOTTOM = 12 * DENSITY;
    var BG_COLOR = [0.0, 0.0, 0.0];
    var CHAR_DELAY = 10;   // ms per tick (typewriter)
    var CHARS_PER_TICK = 2; // characters revealed per tick
    var HOT_CHARS = 20;    // trailing chars that glow hot

    // --- Colors ---
    var COL_TITLE = '#50ff50'; // Bright Green
    var COL_SEP = '#0f5f0f';
    var COL_BODY = '#20aa20';
    var COL_META = '#0f5f0f';
    var COL_LINK = '#30cc30'; // Green
    var COL_MORE = '#30cc30'; // Green

    // --- Content definition ---
    // Each item: { text, color, indent, pageBreak }
    var ALL_ITEMS = [];

    function defineContent() {
        ALL_ITEMS = [];

        // Lesson 1
        push('MICROFORTH: LESSON 1 - THE STACK', COL_TITLE, FONT_TITLE);
        push('----------------------------------', COL_SEP, FONT_META);
        body('Welcome. Forth is stack-based. You push data onto a stack, and words pop it off to do work.');
        body('Type a number to push it. Type a dot . to pop and print it. Try typing 42 .');
        push('Or reason about the output of 1 2 3 . . .', COL_LINK, FONT_META);
        push('Click next when you are ready to continue.', COL_LINK, FONT_META);
        ALL_ITEMS.push({ pageBreak: true });

        // Lesson 2
        push('MICROFORTH: LESSON 2 - MATH', COL_TITLE, FONT_TITLE);
        push('----------------------------------', COL_SEP, FONT_META);
        body('Math in Forth uses Postfix notation (RPN). You put the arguments first, then the operator.');
        body('Available operators: + - * / MOD');
        push('Try typing: 3 4 + .', COL_LINK, FONT_META);
        push('Try typing: 10 2 / .', COL_LINK, FONT_META);
        push('Or even: 5 3 2 + / .', COL_LINK, FONT_META);
        ALL_ITEMS.push({ pageBreak: true });

        // Lesson 3
        push('MICROFORTH: LESSON 3 - STACK MANIPULATION', COL_TITLE, FONT_TITLE);
        push('----------------------------------', COL_SEP, FONT_META);
        body('You often need to arrange the stack. DUP duplicates the top item. DROP discards it. SWAP swaps the top two. OVER copies the second item to the top.');
        push('Try typing: 5 DUP * .   (Squares a number)', COL_LINK, FONT_META);
        ALL_ITEMS.push({ pageBreak: true });

        // Lesson 4
        push('MICROFORTH: LESSON 4 - NEW WORDS', COL_TITLE, FONT_TITLE);
        push('----------------------------------', COL_SEP, FONT_META);
        body('Forth lets you teach it new words. Use : to start a definition, and ; to end it.');
        push('Try typing: : SQUARE DUP * ;', COL_LINK, FONT_META);
        push('Then type:  10 SQUARE .', COL_LINK, FONT_META);
        ALL_ITEMS.push({ pageBreak: true });

        // Lesson 5
        push('MICROFORTH: LESSON 5 - SANDBOX', COL_TITLE, FONT_TITLE);
        push('----------------------------------', COL_SEP, FONT_META);
        body('You now know the basics of MicroForth! The terminal is yours.');
        body('Type WORDS to see the dictionary.');
        push('Happy Hacking.', COL_LINK, FONT_META);
        ALL_ITEMS.push({ pageBreak: true });
    }

    function push(text, color, font) {
        ALL_ITEMS.push({ text: text, color: color, font: font || FONT });
    }

    function body(text) {
        // Word-wrap using measureText
        if (!textCtx) return;
        textCtx.font = FONT;
        var maxW = texW - PADDING_X * 2;
        var words = text.split(' ');
        var line = '';
        for (var i = 0; i < words.length; i++) {
            var test = line + (line.length > 0 ? ' ' : '') + words[i];
            if (textCtx.measureText(test).width > maxW && line.length > 0) {
                ALL_ITEMS.push({ text: line, color: COL_BODY, font: FONT });
                line = words[i];
            } else {
                line = test;
            }
        }
        if (line.length > 0) ALL_ITEMS.push({ text: line, color: COL_BODY, font: FONT });
    }

    // --- Lessons ---
    var lessons = [];
    var currentLesson = 0;
    var screenLines = 0; // how many lines fit on screen (minus nav bar)

    function buildLessons() {
        var lineH = Math.floor(FONT_SIZE * LINE_HEIGHT);
        screenLines = Math.floor((texH - PADDING_TOP - PADDING_BOTTOM) / lineH) - 1; // -1 for nav bar
        if (screenLines < 5) screenLines = 5;
        termMaxLines = screenLines - 1; // -1 for prompt line

        lessons = [];
        var lesson = [];
        for (var i = 0; i < ALL_ITEMS.length; i++) {
            var item = ALL_ITEMS[i];
            if (item.pageBreak) {
                if (lesson.length > 0) lessons.push(lesson);
                lesson = [];
            } else {
                lesson.push(item);
            }
        }
        if (lesson.length > 0) lessons.push(lesson);
        currentLesson = 0;
    }

    function loadLesson(idx) {
        currentLesson = idx;
        termHistory = [];
        var lesson = lessons[currentLesson] || [];
        // Push lesson text into terminal history
        for (var i = 0; i < lesson.length; i++) {
            termHistory.push(lesson[i].text || '');
        }
        termHistory.push(''); // blank line after lesson text
        startTypewriter();
    }

    // --- Typewriter state ---
    var revealedChars = 0;
    var totalCharsInPage = 0;
    var typewriterTimer = null;
    var typewriterDone = false;

    function startTypewriter() {
        revealedChars = 0;
        totalCharsInPage = 0;
        typewriterDone = false;
        for (var i = 0; i < termHistory.length; i++) {
            totalCharsInPage += termHistory[i].length;
        }
        if (totalCharsInPage === 0) {
            typewriterDone = true;
            rasterizeCurrentPage();
            render();
            updateOverlay();
            return;
        }
        typewriterTick();
    }

    function typewriterTick() {
        revealedChars += CHARS_PER_TICK;
        if (revealedChars >= totalCharsInPage) {
            revealedChars = totalCharsInPage;
            typewriterDone = true;
        }
        rasterizeCurrentPage();
        render();
        if (!typewriterDone) {
            typewriterTimer = setTimeout(typewriterTick, CHAR_DELAY);
        } else {
            updateOverlay();
        }
    }

    function skipTypewriter() {
        if (typewriterDone) return;
        if (typewriterTimer) clearTimeout(typewriterTimer);
        revealedChars = totalCharsInPage;
        typewriterDone = true;
        rasterizeCurrentPage();
        render();
        updateOverlay();
    }

    function nextLesson() {
        if (currentLesson < lessons.length - 1) {
            loadLesson(currentLesson + 1);
        }
    }

    function prevLesson() {
        if (currentLesson > 0) {
            loadLesson(currentLesson - 1);
            // Skip typewriter for going back
            revealedChars = 999999;
            totalCharsInPage = 999999;
            typewriterDone = true;
            if (typewriterTimer) clearTimeout(typewriterTimer);
            rasterizeCurrentPage();
            render();
            updateOverlay();
        }
    }

    // --- Nav hit areas (in texture coords) ---
    var navPrevX = 0, navPrevW = 0;
    var navNextX = 0, navNextW = 0;
    var navScreenY = 0;

    // --- MicroForth Interpreter ---
    var forthStack = [];
    var forthDict = {};
    var forthCompileMode = false;
    var forthCompileWord = '';
    var forthCompileDef = [];

    function initForth() {
        forthStack = [];
        forthDict = {
            '+': function () { if (forthStack.length < 2) return "? underflow"; var a = forthStack.pop(); var b = forthStack.pop(); forthStack.push(b + a); },
            '-': function () { if (forthStack.length < 2) return "? underflow"; var a = forthStack.pop(); var b = forthStack.pop(); forthStack.push(b - a); },
            '*': function () { if (forthStack.length < 2) return "? underflow"; var a = forthStack.pop(); var b = forthStack.pop(); forthStack.push(b * a); },
            '/': function () { if (forthStack.length < 2) return "? underflow"; var a = forthStack.pop(); var b = forthStack.pop(); if (a === 0) return "? zero div"; forthStack.push(Math.floor(b / a)); },
            'MOD': function () { if (forthStack.length < 2) return "? underflow"; var a = forthStack.pop(); var b = forthStack.pop(); if (a === 0) return "? zero div"; forthStack.push(b % a); },
            '.': function () { if (forthStack.length < 1) return "? underflow"; return forthStack.pop() + " "; },
            'DUP': function () { if (forthStack.length < 1) return "? underflow"; var a = forthStack.pop(); forthStack.push(a); forthStack.push(a); },
            'DROP': function () { if (forthStack.length < 1) return "? underflow"; forthStack.pop(); },
            'SWAP': function () { if (forthStack.length < 2) return "? underflow"; var a = forthStack.pop(); var b = forthStack.pop(); forthStack.push(a); forthStack.push(b); },
            'OVER': function () { if (forthStack.length < 2) return "? underflow"; var a = forthStack.pop(); var b = forthStack.pop(); forthStack.push(b); forthStack.push(a); forthStack.push(b); },
            'WORDS': function () { return Object.keys(forthDict).join(' ') + " "; }
        };
    }

    function runForth(inputLine) {
        var tokens = inputLine.trim().split(/\s+/);
        var output = [];
        for (var i = 0; i < tokens.length; i++) {
            var token = tokens[i].toUpperCase();
            if (!token) continue;

            if (token === ':' && !forthCompileMode) {
                forthCompileMode = true;
                if (i + 1 < tokens.length) {
                    forthCompileWord = tokens[++i].toUpperCase();
                    forthCompileDef = [];
                } else {
                    return "? expected text";
                }
                continue;
            }

            if (forthCompileMode) {
                if (token === ';') {
                    forthCompileMode = false;
                    forthDict[forthCompileWord] = forthCompileDef;
                    // No output on successful compile to mimic forth style
                } else {
                    forthCompileDef.push(token);
                }
                continue;
            }

            if (forthDict.hasOwnProperty(token)) {
                var entry = forthDict[token];
                if (typeof entry === 'function') {
                    var res = entry();
                    if (res) output.push(res);
                } else if (Array.isArray(entry)) {
                    var innerRes = runForth(entry.join(' '));
                    if (innerRes && innerRes !== ' ok') output.push(innerRes.trim());
                }
            } else {
                var num = parseInt(token, 10);
                if (!isNaN(num)) {
                    forthStack.push(num);
                } else {
                    return token + " ?";
                }
            }
        }
        if (output.length === 0 && !forthCompileMode) return " ok";
        var outStr = output.join('');
        if (!forthCompileMode && !outStr.endsWith('ok')) return outStr + " ok";
        return outStr;
    }

    // --- Terminal state ---
    var termHistory = [];
    var termInput = '';
    var termCursorOn = true;
    var termMaxLines = 5;

    // --- State ---
    var canvas, gl;
    var textCanvas, textCtx;
    var texW, texH;
    var program, texture;
    var uResolution, uScreenSize, uCellSize, uBgColor, uBloom, uTime, uSparks;

    // Lena image for CRT rendering test
    var lenaImg = null;
    var lenaReady = false;

    function loadLena() {
        lenaImg = new Image();
        lenaImg.onload = function () {
            lenaReady = true;
            // Re-render to show Lena immediately
            rasterizeCurrentPage();
            render();
        };
        lenaImg.src = '/petscii/images/lena.png';
    }

    function init() {
        canvas = document.getElementById('crt-canvas');
        if (!canvas) return;

        gl = canvas.getContext('webgl', { antialias: false, alpha: false, preserveDrawingBuffer: true });
        if (!gl) { console.error('WebGL not available'); return; }

        // Prepare offscreen canvas early (needed for measureText in word-wrap)
        textCanvas = document.createElement('canvas');
        textCtx = textCanvas.getContext('2d');

        resize();
        setupShaders();
        setupGeometry();
        setupTexture();
        initForth();

        defineContent();
        buildLessons();
        loadLesson(0);
        loadLena();
        noiseLoop();

        setInterval(function () {
            termCursorOn = !termCursorOn;
            rasterizeCurrentPage();
            render();
        }, 500);

        window.addEventListener('resize', function () {
            resize();
            defineContent();
            buildLessons();
            revealedChars = totalCharsInPage = 999999;
            typewriterDone = true;
            rasterizeCurrentPage();
            render();
            updateOverlay();
        });

        // Click: skip typewriter, navigate back/forward
        document.addEventListener('click', function (e) {
            if (!typewriterDone) {
                skipTypewriter();
                return;
            }

            // Convert click position to texture coordinates
            var rect = canvas.getBoundingClientRect();
            var clickTexX = (e.clientX - rect.left) / rect.width * texW;
            var clickTexY = (e.clientY - rect.top) / rect.height * texH;
            var lineH = Math.floor(FONT_SIZE * LINE_HEIGHT);

            // Check if click is in the nav bar area (bottom of screen)
            if (clickTexY >= navScreenY && clickTexY < navScreenY + lineH) {
                if (navPrevW > 0 && clickTexX >= navPrevX && clickTexX < navPrevX + navPrevW) {
                    prevLesson();
                    return;
                }
                if (navNextW > 0 && clickTexX >= navNextX) {
                    nextLesson();
                    return;
                }
            }

            // Click anywhere else: next lesson if available
            if (currentLesson < lessons.length - 1) {
                nextLesson();
            }
        });

        // Scroll: same behavior
        document.addEventListener('wheel', function () {
            if (!typewriterDone) {
                skipTypewriter();
            }
        });

        // Keyboard limits for the terminal input
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                termHistory.push(termInput);
                var forthOut = runForth(termInput);
                if (forthOut) termHistory.push(forthOut);
                termInput = '';
                while (termHistory.length > termMaxLines) termHistory.shift();
            } else if (e.key === 'Backspace') {
                e.preventDefault();
                termInput = termInput.slice(0, -1);
            } else if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
                termInput += e.key;
            }
            termCursorOn = true;
            rasterizeCurrentPage();
            render();
            updateOverlay();
        });
    }

    function resize() {
        var dpr = (window.devicePixelRatio || 1) * DENSITY;
        var w = 800; // Fixed classic width
        var h = 600; // Fixed classic height
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        canvas.style.width = w + 'px';
        canvas.style.height = h + 'px';
        gl.viewport(0, 0, canvas.width, canvas.height);
        texW = Math.floor(canvas.width / CELL_W);
        texH = Math.floor(canvas.height / CELL_H);
    }

    // --- Shaders ---
    var VERT_SRC = [
        'attribute vec2 aPos;',
        'void main() { gl_Position = vec4(aPos, 0.0, 1.0); }'
    ].join('\n');

    var FRAG_SRC = [
        'precision mediump float;',
        'uniform sampler2D uTexture;',
        'uniform vec2 uResolution;',
        'uniform vec2 uScreenSize;',
        'uniform vec2 uCellSize;',
        'uniform vec3 uBgColor;',
        'uniform float uBloom;',
        'uniform float uTime;',
        'uniform vec4 uSparks[3];', // xy=position in texels, z=brightness, w=radius
        '',
        '// Hash-based white noise',
        'float noise(vec2 co) {',
        '  return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);',
        '}',
        '',
        '// Barrel distortion (screen curvature)',
        'vec2 curve(vec2 uv) {',
        '  uv = (uv - 0.5) * 2.0; // scale to -1..1 from center',
        '  uv *= 1.1; // scale down the image slightly so the corners do not get cut off severely',
        '  // Subtle curve: mostly flat, bending smoothly at the edges',
        '  uv.x *= 1.0 + pow((abs(uv.y) / 6.0), 3.0);',
        '  uv.y *= 1.0 + pow((abs(uv.x) / 6.0), 3.0);',
        '  uv  = (uv / 2.0) + 0.5; // restore to 0..1',
        '  uv =  uv *0.92 + 0.04;',
        '  return uv;',
        '}',
        '',
        'void main() {',
        '  vec2 px = gl_FragCoord.xy;',
        '  px.y = uScreenSize.y - px.y;',
        '',
        '  // Normalize screen coordinates 0..1',
        '  vec2 normPx = px / uScreenSize;',
        '',
        '  // Apply curvature mapping to find which coordinate on the flat texture we should sample',
        '  vec2 curvedUV = curve(normPx);',
        '',
        '  // If the curve pushes us off the edge of the virtual monitor glass, render black',
        '  if (curvedUV.x < 0.0 || curvedUV.x > 1.0 || curvedUV.y < 0.0 || curvedUV.y > 1.0) {',
        '      gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);',
        '      return;',
        '  }',
        '',
        '  // Remap back to physical pixels based on the curved UV',
        '  vec2 mappedPx = curvedUV * uScreenSize;',
        '',
        '  // Update all cell lookups to use the mapped pixel coordinate',
        '  float cellX = floor(mappedPx.x / uCellSize.x);',
        '  float cellY = floor(mappedPx.y / uCellSize.y);',
        '  vec2 cell = vec2(cellX, cellY);',
        '  vec2 uv = (cell + 0.5) / uResolution;',
        '  vec3 texel = texture2D(uTexture, uv).rgb;',
        '',
        '  // Bloom: neighbor glow weighted by their luminance (R+G+B)',
        '  vec3 bloom = vec3(0.0);',
        '  for (float dx = -1.0; dx <= 1.0; dx += 1.0) {',
        '    for (float dy = -1.0; dy <= 1.0; dy += 1.0) {',
        '      if (dx == 0.0 && dy == 0.0) continue;',
        '      vec2 nuv = (cell + vec2(dx, dy) + 0.5) / uResolution;',
        '      vec3 nb = texture2D(uTexture, nuv).rgb;',
        '      float lum = (nb.r + nb.g + nb.b) / 3.0;',
        '      bloom += nb * lum;',
        '    }',
        '  }',
        '  bloom = bloom / 8.0 * 0.2;',
        '',
        '  // Brightness boost',
        '  float bright = 1.8;',
        '',
        '  // Subpixel mask: R,G,B in vertical rows (rotated 90deg)',
        '  float subY = mod(mappedPx.y, uCellSize.y);',
        '  vec3 mask = vec3(0.0);',
        '  if (subY < 1.0) mask.r = 1.0;',
        '  else if (subY < 2.0) mask.g = 1.0;',
        '  else mask.b = 1.0;',
        '',
        '  // Overbright: boost subpixel when other channels are also active',
        '  float otherActive = 0.0;',
        '  if (mask.r < 0.5 && texel.r > 0.1) otherActive += 1.0;',
        '  if (mask.g < 0.5 && texel.g > 0.1) otherActive += 1.0;',
        '  if (mask.b < 0.5 && texel.b > 0.1) otherActive += 1.0;',
        '  float overbright = 1.0 + otherActive * 0.35;',
        '',
        '  // Flood: each component bleeds its color into adjacent subpixels (vertical)',
        '  float floodFactor = 0.4;',
        '  vec3 flood = vec3(0.0);',
        '  float subIdx = floor(mod(mappedPx.y, uCellSize.y));',
        '',
        '  // Top neighbor: subIdx-1 (wraps to B of cell above when subIdx=0)',
        '  vec2 topCell = vec2(cellX, cellY - (subIdx < 0.5 ? 1.0 : 0.0));',
        '  vec3 topTexel = texture2D(uTexture, (topCell + 0.5) / uResolution).rgb;',
        '  float topSubIdx = subIdx < 0.5 ? 2.0 : subIdx - 1.0;',
        '  float topVal = topSubIdx < 0.5 ? topTexel.r : (topSubIdx < 1.5 ? topTexel.g : topTexel.b);',
        '  vec3 topColor = vec3(topSubIdx < 0.5 ? 1.0 : 0.0, topSubIdx < 1.5 && topSubIdx > 0.5 ? 1.0 : 0.0, topSubIdx > 1.5 ? 1.0 : 0.0);',
        '  flood += topColor * topVal * floodFactor;',
        '',
        '  // Bottom neighbor: subIdx+1 (wraps to R of cell below when subIdx=2)',
        '  vec2 botCell = vec2(cellX, cellY + (subIdx > 1.5 ? 1.0 : 0.0));',
        '  vec3 botTexel = texture2D(uTexture, (botCell + 0.5) / uResolution).rgb;',
        '  float botSubIdx = subIdx > 1.5 ? 0.0 : subIdx + 1.0;',
        '  float botVal = botSubIdx < 0.5 ? botTexel.r : (botSubIdx < 1.5 ? botTexel.g : botTexel.b);',
        '  vec3 botColor = vec3(botSubIdx < 0.5 ? 1.0 : 0.0, botSubIdx < 1.5 && botSubIdx > 0.5 ? 1.0 : 0.0, botSubIdx > 1.5 ? 1.0 : 0.0);',
        '  flood += botColor * botVal * floodFactor;',
        '',
        '  vec3 color = (texel * bright * overbright + bloom + flood) * mask;',
        '',
        '  // Eye diffusion: blend 25% with vertical neighbors',
        '  float diffuse = 0.25;',
        '  vec2 topPx = vec2(mappedPx.x, mappedPx.y - uCellSize.y);',
        '  vec2 botPx = vec2(mappedPx.x, mappedPx.y + uCellSize.y);',
        '',
        '  float tCellX = floor(topPx.x / uCellSize.x);',
        '  float tCellY = floor(topPx.y / uCellSize.y);',
        '  vec3 tTex = texture2D(uTexture, (vec2(tCellX, tCellY) + 0.5) / uResolution).rgb;',
        '  float tSubY = mod(topPx.y, uCellSize.y);',
        '  vec3 tMask = vec3(0.0);',
        '  if (tSubY < 1.0) tMask.r = 1.0;',
        '  else if (tSubY < 2.0) tMask.g = 1.0;',
        '  else tMask.b = 1.0;',
        '  vec3 tColor = tTex * tMask;',
        '',
        '  float bCellX = floor(botPx.x / uCellSize.x);',
        '  float bCellY = floor(botPx.y / uCellSize.y);',
        '  vec3 bTex = texture2D(uTexture, (vec2(bCellX, bCellY) + 0.5) / uResolution).rgb;',
        '  float bSubY = mod(botPx.y, uCellSize.y);',
        '  vec3 bMask = vec3(0.0);',
        '  if (bSubY < 1.0) bMask.r = 1.0;',
        '  else if (bSubY < 2.0) bMask.g = 1.0;',
        '  else bMask.b = 1.0;',
        '  vec3 bColor = bTex * bMask;',
        '',
        '  color = color * (1.0 - diffuse) + (tColor + bColor) * 0.5 * diffuse;',
        '',
        '  // Color bloom: add the "intended" full RGB color (unmasked) from',
        '  // this cell and its neighbors, so subpixel gaps fill with true color',
        '  float colorBloom = 0.15;',
        '  vec3 trueColor = texel;',
        '  for (float dx = -1.0; dx <= 1.0; dx += 1.0) {',
        '    for (float dy = -1.0; dy <= 1.0; dy += 1.0) {',
        '      if (dx == 0.0 && dy == 0.0) continue;',
        '      vec2 nuv2 = (cell + vec2(dx, dy) + 0.5) / uResolution;',
        '      trueColor += texture2D(uTexture, nuv2).rgb;',
        '    }',
        '  }',
        '  trueColor = trueColor / 9.0;',
        '  color += trueColor * colorBloom;',
        '',
        '  // --- Physically Plausible CRT Refresh & Flicker ---',
        '  // 1. AC Hum / Power flicker (subtle overall brightness fluctuation)',
        '  float hum = sin(uTime * 50.0) * 0.03 + sin(uTime * 12.0) * 0.02;',
        '  color *= (0.95 + hum);',
        '',
        '  // 2. Refresh Scanline (Phosphor beam decay rolling down the screen)',
        '  // UV coords going 0..1 top to bottom. uTime rolls it down.',
        '  float roll = fract(curvedUV.y - uTime * 0.25); // Slightly faster roll',
        '  // The beam excites the phosphor which then decays exponentially',
        '  float beamGlow = exp(-roll * 4.0) * 0.25;',
        '  color += texel * beamGlow;',
        '',
        '  // 3. White noise on black background',
        '  float n = noise(mappedPx + uTime) * 0.02;',
        '  color += vec3(n);',
        '',
        '  // Wide glow: sample in a 20-texel radius disc (sparse sampling)',
        '  vec3 wideGlow = vec3(0.0);',
        '  float glowRadius = 20.0;',
        '  float glowSamples = 0.0;',
        '  for (float gx = -20.0; gx <= 20.0; gx += 4.0) {',
        '    for (float gy = -20.0; gy <= 20.0; gy += 4.0) {',
        '      float gd = length(vec2(gx, gy));',
        '      if (gd > glowRadius) continue;',
        '      float gw = 1.0 - gd / glowRadius;',
        '      vec2 guv = (cell + vec2(gx, gy) + 0.5) / uResolution;',
        '      vec3 gs = texture2D(uTexture, guv).rgb;',
        '      wideGlow += gs * gw * gw;',
        '      glowSamples += 1.0;',
        '    }',
        '  }',
        '  color += wideGlow / glowSamples * 0.5;',
        '',
        '  // --- GLASS RENDER TRICKS ---',
        '  // 4. Subtle Vignette (darken corners, brighten center tube)',
        '  float vignette = curvedUV.x * curvedUV.y * (1.0 - curvedUV.x) * (1.0 - curvedUV.y);',
        '  vignette = clamp(pow(vignette * 15.0, 0.2), 0.0, 1.0);',
        '  color *= vignette;',
        '',
        '  // 5. Specular highlight/reflection on the curved glass',
        '  // Adds a broad, soft white wash stretching across the curve to simulate room lighting',
        '  float reflectY = 1.0 - pow(abs(curvedUV.y - 0.5) * 2.0, 2.0); ',
        '  float reflectX = 1.0 - pow(abs(curvedUV.x - 0.5) * 2.0, 2.0);',
        '  float glassReflection = reflectY * reflectX * 0.04;', // Very dim, mostly visible when screen is dark
        '  color += vec3(glassReflection);',
        '',
        '  gl_FragColor = vec4(uBgColor + color, 1.0);',
        '}'
    ].join('\n');

    function setupShaders() {
        var vs = compile(gl.VERTEX_SHADER, VERT_SRC);
        var fs = compile(gl.FRAGMENT_SHADER, FRAG_SRC);
        program = gl.createProgram();
        gl.attachShader(program, vs);
        gl.attachShader(program, fs);
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            console.error('Link:', gl.getProgramInfoLog(program));
        }
        gl.useProgram(program);
        uResolution = gl.getUniformLocation(program, 'uResolution');
        uScreenSize = gl.getUniformLocation(program, 'uScreenSize');
        uCellSize = gl.getUniformLocation(program, 'uCellSize');
        uBgColor = gl.getUniformLocation(program, 'uBgColor');
        uBloom = gl.getUniformLocation(program, 'uBloom');
        uTime = gl.getUniformLocation(program, 'uTime');
        uSparks = gl.getUniformLocation(program, 'uSparks');
    }

    function compile(type, src) {
        var s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
            console.error('Shader:', gl.getShaderInfoLog(s));
        }
        return s;
    }

    function setupGeometry() {
        var buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            -1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1
        ]), gl.STATIC_DRAW);
        var a = gl.getAttribLocation(program, 'aPos');
        gl.enableVertexAttribArray(a);
        gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
    }

    function setupTexture() {
        texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }

    // --- Text rasterization ---
    function rasterizeCurrentPage() {
        textCanvas.width = texW;
        textCanvas.height = texH;

        textCtx.fillStyle = '#000';
        textCtx.fillRect(0, 0, texW, texH);
        textCtx.textBaseline = 'top';

        var lineH = Math.floor(FONT_SIZE * LINE_HEIGHT);
        var bottomY = texH - PADDING_BOTTOM - lineH;

        // --- Unified terminal rendering ---
        var visibleLines = termHistory.slice();
        var y = PADDING_TOP;
        textCtx.font = FONT;

        // During typewriter animation, only show revealed chars
        if (!typewriterDone) {
            var charIndex = 0;
            var hotStart = Math.max(0, revealedChars - HOT_CHARS);
            var cursorX = PADDING_X, cursorY = PADDING_TOP;

            for (var i = 0; i < visibleLines.length; i++) {
                var text = visibleLines[i];
                var visibleLen = Math.min(text.length, Math.max(0, revealedChars - charIndex));

                if (visibleLen > 0) {
                    var hotStartInLine = Math.max(0, hotStart - charIndex);
                    var coldLen = Math.min(hotStartInLine, visibleLen);

                    if (coldLen > 0) {
                        textCtx.fillStyle = COL_BODY;
                        textCtx.fillText(text.substring(0, coldLen), PADDING_X, y);
                    }

                    if (visibleLen > hotStartInLine) {
                        var hotIdx = Math.max(0, hotStartInLine);
                        var hotText = text.substring(hotIdx, visibleLen);
                        var hotX = PADDING_X;
                        if (hotIdx > 0) {
                            hotX += textCtx.measureText(text.substring(0, hotIdx)).width;
                        }
                        textCtx.fillStyle = '#50ff50';
                        textCtx.fillText(hotText, hotX, y);
                    }

                    cursorX = PADDING_X + textCtx.measureText(text.substring(0, visibleLen)).width;
                    cursorY = y;
                }

                charIndex += text.length;
                y += lineH;
                if (charIndex >= revealedChars) break;
            }

            // Typewriter cursor
            var cursorW = Math.floor(FONT_SIZE * 0.6);
            textCtx.fillStyle = '#50ff50';
            textCtx.fillRect(cursorX + 1, cursorY, cursorW, FONT_SIZE);
        } else {
            // After typewriter: draw all history + prompt
            for (var i = 0; i < visibleLines.length; i++) {
                textCtx.fillStyle = COL_BODY;
                textCtx.fillText(visibleLines[i], PADDING_X, y);
                y += lineH;
            }

            // Draw prompt + input
            textCtx.fillStyle = COL_TITLE;
            var promptStr = '> ';
            textCtx.fillText(promptStr + termInput, PADDING_X, y);

            // Draw blinking cursor
            if (termCursorOn) {
                var cursorW = Math.floor(FONT_SIZE * 0.6);
                var termCursorX = PADDING_X + textCtx.measureText(promptStr + termInput).width;
                textCtx.fillStyle = '#50ff50';
                textCtx.fillRect(termCursorX + 1, y, cursorW, FONT_SIZE);
            }
        }

        // --- Nav Bar ---
        var hasNext = currentLesson < lessons.length - 1;
        var hasPrev = currentLesson > 0;
        textCtx.font = FONT_META;

        if (!typewriterDone && lessons.length > 1) {
            textCtx.fillStyle = COL_SEP;
            var pageText = '[' + (currentLesson + 1) + '/' + lessons.length + ']';
            textCtx.fillText(pageText, PADDING_X, bottomY);
        } else if (typewriterDone && (hasPrev || hasNext)) {
            var navPad = 2;
            var totalNavW = 0;
            var prevLabel = ' < ';
            var prevW = textCtx.measureText(prevLabel).width;
            var nextLabel = ' next > ';
            var nextW = textCtx.measureText(nextLabel).width;

            if (hasPrev) totalNavW += prevW + navPad * 2;
            if (hasNext) totalNavW += (hasPrev ? 4 : 0) + nextW + navPad * 2;

            var x = texW - PADDING_X - totalNavW;

            if (hasPrev) {
                textCtx.fillStyle = COL_MORE;
                textCtx.fillRect(x, bottomY - navPad, prevW + navPad * 2, FONT_SIZE + navPad * 2);
                textCtx.fillStyle = '#000000';
                textCtx.fillText(prevLabel, x + navPad, bottomY);
                navPrevX = x;
                navPrevW = prevW + navPad * 2;
                x += navPrevW + 4;
            } else {
                navPrevW = 0;
            }

            if (hasNext) {
                textCtx.fillStyle = COL_MORE;
                textCtx.fillRect(x, bottomY - navPad, nextW + navPad * 2, FONT_SIZE + navPad * 2);
                textCtx.fillStyle = '#000000';
                textCtx.fillText(nextLabel, x + navPad, bottomY);
                navNextX = x;
                navNextW = nextW + navPad * 2;
            } else {
                navNextW = 0;
            }

            navScreenY = bottomY - navPad;
        }


        // Upload
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, textCanvas);
    }

    // --- Sparks state ---
    var MAX_SPARKS = 3;
    // Each spark: [x, y, brightness, radius] — 4 floats per spark
    var sparksData = new Float32Array(MAX_SPARKS * 4);
    var sparkTimers = [0, 0, 0]; // time remaining for each spark (ms)
    var nextSparkIn = 1500; // ms until next spark spawns

    function updateSparks(dt) {
        // Countdown to next spark
        nextSparkIn -= dt;
        if (nextSparkIn <= 0) {
            // Find a free slot
            for (var i = 0; i < MAX_SPARKS; i++) {
                if (sparkTimers[i] <= 0) {
                    sparksData[i * 4 + 0] = Math.random() * texW;     // x in texels
                    sparksData[i * 4 + 1] = Math.random() * texH;     // y in texels
                    sparksData[i * 4 + 2] = 0.6 + Math.random() * 0.4; // brightness
                    sparksData[i * 4 + 3] = 2 + Math.random() * 3;    // radius in texels
                    sparkTimers[i] = 100 + Math.random() * 200;        // duration 100-300ms
                    break;
                }
            }
            nextSparkIn = 2000 + Math.random() * 3000; // next spark in 2-5s
        }

        // Decay active sparks
        for (var i = 0; i < MAX_SPARKS; i++) {
            if (sparkTimers[i] > 0) {
                sparkTimers[i] -= dt;
                if (sparkTimers[i] <= 0) {
                    sparksData[i * 4 + 2] = 0; // turn off
                }
            }
        }
    }

    // --- Render ---
    var noiseAnimId = null;
    var lastFrameTime = 0;

    function render() {
        gl.clearColor(BG_COLOR[0], BG_COLOR[1], BG_COLOR[2], 1.0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.uniform2f(uResolution, texW, texH);
        gl.uniform2f(uScreenSize, canvas.width, canvas.height);
        gl.uniform2f(uCellSize, CELL_W, CELL_H);
        gl.uniform3f(uBgColor, BG_COLOR[0], BG_COLOR[1], BG_COLOR[2]);
        gl.uniform1f(uBloom, 0.5);
        gl.uniform1f(uTime, performance.now() * 0.001);
        gl.uniform4fv(uSparks, sparksData);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    // Continuous render loop for animated noise + sparks
    function noiseLoop(timestamp) {
        var dt = lastFrameTime ? timestamp - lastFrameTime : 16;
        lastFrameTime = timestamp;
        updateSparks(dt);
        render();
        noiseAnimId = requestAnimationFrame(noiseLoop);
    }

    // --- Text overlay for selectability ---
    var overlayEl = null;

    function addOverlaySpan(text, fontDesc, xOffset, yOffset, scaleX, scaleY) {
        var span = document.createElement('span');
        span.textContent = text;
        var normX = xOffset / texW;
        var normY = (yOffset - 2) / texH;
        var curveX = normX;
        var curveY = normY;
        curveX = (curveX - 0.5) * 2.0;
        curveY = (curveY - 0.5) * 2.0;
        curveX *= 1.1;
        curveY *= 1.1;
        curveX *= 1.0 + Math.pow(Math.abs(curveY) / 3.0, 3.0);
        curveY *= 1.0 + Math.pow(Math.abs(curveX) / 3.0, 3.0);
        curveX = (curveX / 2.0) + 0.5;
        curveY = (curveY / 2.0) + 0.5;
        curveX = curveX * 0.92 + 0.04;
        curveY = curveY * 0.92 + 0.04;
        var cssX = curveX * texW * scaleX;
        var cssY = curveY * texH * scaleY;
        var cssFontSize = FONT_SIZE * scaleY;
        var fontFamily = "'VT323', monospace";
        if (fontDesc === FONT_META) {
            cssFontSize = (FONT_SIZE - 2) * scaleY;
        }
        span.style.left = cssX + 'px';
        span.style.top = cssY + 'px';
        span.style.fontSize = cssFontSize + 'px';
        span.style.fontFamily = fontFamily;
        span.style.lineHeight = '1';
        span.style.transform = 'scaleX(' + (scaleX / scaleY) + ')';
        span.style.transformOrigin = 'left top';
        overlayEl.appendChild(span);
    }

    function updateOverlay() {
        if (!overlayEl) overlayEl = document.getElementById('text-overlay');
        if (!overlayEl) return;

        overlayEl.innerHTML = '';
        var dpr = window.devicePixelRatio || 1;
        var scaleX = CELL_W / dpr;
        var scaleY = CELL_H / dpr;
        var lineH = Math.floor(FONT_SIZE * LINE_HEIGHT);
        var y = PADDING_TOP;

        // Unified overlay: all lines from termHistory + prompt
        for (var i = 0; i < termHistory.length; i++) {
            addOverlaySpan(termHistory[i], FONT, PADDING_X, y, scaleX, scaleY);
            y += lineH;
        }
        if (typewriterDone) {
            addOverlaySpan('> ' + termInput, FONT, PADDING_X, y, scaleX, scaleY);
        }
    }

    // Wait for VT323 to load before booting
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            document.fonts.ready.then(init);
        });
    } else {
        document.fonts.ready.then(init);
    }
})();