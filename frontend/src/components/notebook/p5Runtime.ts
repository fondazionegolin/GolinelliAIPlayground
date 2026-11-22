/**
 * Compatibility runtime injected into every p5.js preview, right after p5 itself.
 *
 * 1. `GolinelliCam`: one layout for the webcam picture AND the tracking points, recomputed on every call from the
 *    current canvas size and the real video size. Drawing the video and mapping MediaPipe (normalised 0..1) or ml5
 *    (video pixels) points through it keeps them aligned at any window size, in full screen, mirrored or not.
 * 2. Canvases created at window size follow the window when the sketch has no windowResized() of its own.
 *
 * Plain ES5 on purpose: it runs inside the sketch iframe before any user code.
 */
export const P5_RUNTIME_SCRIPT = `
(function () {
  var W = window;
  var settings = { mode: 'cover', mirror: true };

  function elementOf(video) { return video && video.elt ? video.elt : video; }
  function isNum(n) { return typeof n === 'number' && isFinite(n) && n > 0; }

  /** Real picture size of the stream (what the camera delivers). */
  function sourceSize(video) {
    var el = elementOf(video);
    if (el && isNum(el.videoWidth) && isNum(el.videoHeight)) return { w: el.videoWidth, h: el.videoHeight };
    if (video && isNum(video.width) && isNum(video.height)) return { w: video.width, h: video.height };
    if (el && isNum(el.width) && isNum(el.height)) return { w: el.width, h: el.height };
    return { w: 640, h: 480 };
  }

  /** Pixel space of ml5 keypoints: the size the capture element was given (video.size), else the stream size. */
  function keypointSpace(video) {
    if (video && isNum(video.width) && isNum(video.height)) return { w: video.width, h: video.height };
    var el = elementOf(video);
    if (el && isNum(el.width) && isNum(el.height)) return { w: el.width, h: el.height };
    return sourceSize(video);
  }

  function canvasSize(opts) {
    var w = (opts && opts.width) || (typeof W.width === 'number' ? W.width : W.innerWidth);
    var h = (opts && opts.height) || (typeof W.height === 'number' ? W.height : W.innerHeight);
    return { w: w, h: h };
  }

  function layout(video, opts) {
    opts = opts || {};
    var mode = opts.mode || settings.mode;
    var mirror = typeof opts.mirror === 'boolean' ? opts.mirror : settings.mirror;
    var c = canvasSize(opts);
    if (mode === 'stretch') return { x: 0, y: 0, w: c.w, h: c.h, scale: 1, mirror: mirror, mode: mode };
    var s = sourceSize(video);
    var k = mode === 'contain' ? Math.min(c.w / s.w, c.h / s.h) : Math.max(c.w / s.w, c.h / s.h);
    var w = s.w * k, h = s.h * k;
    return { x: (c.w - w) / 2, y: (c.h - h) / 2, w: w, h: h, scale: k, mirror: mirror, mode: mode };
  }

  function ready(video) {
    var el = elementOf(video);
    return !!(el && el.readyState >= 2 && el.videoWidth > 0 && el.videoHeight > 0);
  }

  function draw(video, opts) {
    var L = layout(video, opts);
    if (!ready(video)) return L;
    var el = elementOf(video);
    var useP5Image = video && video.elt && typeof W.image === 'function';
    W.push();
    if (L.mirror) { W.translate(L.x + L.w, L.y); W.scale(-1, 1); }
    else W.translate(L.x, L.y);
    if (useP5Image) W.image(video, 0, 0, L.w, L.h);
    else if (W.drawingContext && W.drawingContext.drawImage) W.drawingContext.drawImage(el, 0, 0, L.w, L.h);
    W.pop();
    return L;
  }

  function coords(p) {
    if (Array.isArray(p)) return { x: p[0], y: p[1], z: p[2] };
    return p || { x: 0, y: 0 };
  }

  /** Normalised point (MediaPipe landmarks, 0..1) -> canvas pixels, matching draw(). */
  function point(p, video, opts) {
    var q = coords(p), L = layout(video, opts);
    var nx = L.mirror ? 1 - q.x : q.x;
    return { x: L.x + nx * L.w, y: L.y + q.y * L.h, z: q.z };
  }

  /** Point in video pixels (ml5 keypoints, e.g. 0..640 x 0..480) -> canvas pixels, matching draw(). */
  function videoPoint(p, video, opts) {
    var q = coords(p), s = keypointSpace(video);
    return point({ x: q.x / s.w, y: q.y / s.h, z: q.z }, video, opts);
  }

  /** Canvas pixels -> normalised video point (e.g. to hit-test the mouse against landmarks). */
  function toNormalized(x, y, video, opts) {
    var L = layout(video, opts);
    var nx = (x - L.x) / L.w, ny = (y - L.y) / L.h;
    return { x: L.mirror ? 1 - nx : nx, y: ny };
  }

  W.GolinelliCam = {
    config: function (opts) { if (opts) { if (opts.mode) settings.mode = opts.mode; if (typeof opts.mirror === 'boolean') settings.mirror = opts.mirror; } return settings; },
    layout: layout, draw: draw, ready: ready, point: point, videoPoint: videoPoint, toNormalized: toNormalized,
    /** Scale for sizes (radius, stroke) so they look the same at any window size. */
    unit: function (video, opts) { var L = layout(video, opts); return L.w / 640; }
  };

  // Canvases created at window size follow the window (full screen, resized panels) when the sketch does not
  // handle windowResized() itself.
  var fit = { active: false, inst: null };
  if (W.p5 && W.p5.prototype && typeof W.p5.prototype.createCanvas === 'function') {
    var originalCreateCanvas = W.p5.prototype.createCanvas;
    W.p5.prototype.createCanvas = function (w, h) {
      var inst = this;
      try {
        fit.active = Math.abs(w - W.innerWidth) <= 1 && Math.abs(h - W.innerHeight) <= 1;
        fit.inst = inst;
        if (fit.active) { document.documentElement.style.overflow = 'hidden'; document.body.style.overflow = 'hidden'; }
      } catch (e) {}
      return originalCreateCanvas.apply(this, arguments);
    };
    W.addEventListener('resize', function () {
      if (!fit.active || !fit.inst || typeof W.windowResized === 'function') return;
      try { fit.inst.resizeCanvas(W.innerWidth, W.innerHeight); } catch (e) {}
    });
  }
})();
`
