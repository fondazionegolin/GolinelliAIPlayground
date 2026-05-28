import { forwardRef, useImperativeHandle, useRef } from 'react'

export interface StrudelPreviewHandle {
  evaluate: (code: string) => void
  preview: (code: string) => void
  stop: () => void
}

interface Props {
  runtimeError: string | null
}

const STRUDEL_CDN = 'https://esm.sh/@strudel/web'

function buildStrudelDoc(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { width: 100%; height: 100%; overflow: hidden; }
    body {
      background: #0c0c0c;
      font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
      -webkit-font-smoothing: antialiased;
      display: flex; flex-direction: column;
    }
    #top-bar {
      height: 22px; flex-shrink: 0;
      background: #080808; border-bottom: 1px solid #181818;
      display: flex; align-items: center; padding: 0 10px; gap: 8px;
    }
    .led {
      width: 5px; height: 5px; border-radius: 50%;
      background: #222; flex-shrink: 0; transition: background 0.25s;
    }
    .playing .led { background: #30ff9a; animation: blink 1s ease-in-out infinite; }
    @keyframes blink { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.28;transform:scale(.65)} }
    #status-txt {
      font-size: 8px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase;
      color: #282828; transition: color 0.25s; user-select: none;
    }
    .playing #status-txt { color: #555; }
    #beat-txt {
      margin-left: auto; font-size: 8px; font-weight: 700; letter-spacing: 0.08em;
      color: #222; font-variant-numeric: tabular-nums; user-select: none;
    }
    .playing #beat-txt { color: #3a3a3a; }
    #err-bar {
      display: none; flex-shrink: 0; padding: 3px 10px; max-height: 34px; overflow: hidden;
      background: #120505; border-bottom: 1px solid #260606;
      font-size: 8px; font-family: monospace; color: #ff5555;
      white-space: nowrap; text-overflow: ellipsis;
    }
    #seq-wrap { flex: 1; position: relative; overflow: hidden; min-height: 0; }
    #seq-canvas { display: block; width: 100%; height: 100%; }
    #audio-gate {
      position: absolute; inset: 0; display: none;
      flex-direction: column; align-items: center; justify-content: center;
      background: rgba(8,8,8,0.96); gap: 12px; z-index: 10;
    }
    #audio-gate.visible { display: flex; }
    #audio-gate button {
      background: #181818; border: 1px solid #2e2e2e; border-radius: 6px;
      color: #bbb; font-family: inherit; font-size: 10px; font-weight: 700;
      letter-spacing: 0.1em; text-transform: uppercase;
      padding: 9px 22px; cursor: pointer; transition: all .15s;
    }
    #audio-gate button:hover { background: #222; border-color: #555; color: #fff; }
    #audio-gate small { font-size: 7px; color: #2e2e2e; letter-spacing: .1em; text-transform: uppercase; }
    #pend-pill {
      position: absolute; bottom: 6px; right: 6px;
      font-size: 7px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase;
      color: rgba(255,214,62,.8); border: 1px solid rgba(255,214,62,.22);
      background: rgba(255,214,62,.06); border-radius: 3px;
      padding: 2px 6px; pointer-events: none; display: none; user-select: none;
    }
  </style>
</head>
<body>
  <div id="top-bar">
    <span class="led"></span>
    <span id="status-txt">CARICAMENTO...</span>
    <span id="beat-txt"></span>
  </div>
  <div id="err-bar"></div>
  <div id="seq-wrap">
    <canvas id="seq-canvas"></canvas>
    <div id="audio-gate">
      <button onclick="activateAudio()">&#9654;&thinsp; ATTIVA AUDIO</button>
      <small>click to unlock webaudio</small>
    </div>
    <div id="pend-pill">&#x25B7; PROSSIMA BATTUTA</div>
  </div>

  <script type="module">
    var topBar    = document.getElementById('top-bar')
    var statusTxt = document.getElementById('status-txt')
    var beatTxt   = document.getElementById('beat-txt')
    var errBar    = document.getElementById('err-bar')
    var seqWrap   = document.getElementById('seq-wrap')
    var canvas    = document.getElementById('seq-canvas')
    var rc        = canvas.getContext('2d')
    var audioGate = document.getElementById('audio-gate')
    var pendPill  = document.getElementById('pend-pill')

    function notify(type, payload) {
      parent.postMessage({ source: 'strudel-preview', type: type, payload: payload }, '*')
    }

    // ── State ────────────────────────────────────────────────────────────────
    var isPlaying = false

    function setStatus(msg, playing) {
      playing = !!playing
      statusTxt.textContent = msg
      isPlaying = playing
      if (playing) topBar.classList.add('playing')
      else { topBar.classList.remove('playing'); beatTxt.textContent = '' }
      notify('status', { msg: msg, playing: playing })
    }

    function setError(msg) {
      errBar.style.display = msg ? 'block' : 'none'
      errBar.textContent = msg || ''
      if (msg) notify('error', { message: msg })
    }

    // ── TE color palette ──────────────────────────────────────────────────────
    var TE_COLORS = [
      '#ff7740', '#ffd63e', '#30ff9a', '#30e8ff',
      '#4898ff', '#cc40ff', '#ff40c0', '#ff5544',
      '#ffaa30', '#a8ff30', '#30bbff', '#ff3388',
    ]

    // ── Note parsing (handles all strudel value formats) ──────────────────────
    var NOTE_NAMES = ['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B']
    var PERC_MAP = {
      // Standard GM
      bd:36, kick:36, sd:38, snare:38, hh:42, ch:42, oh:46,
      cp:39, clap:39, mt:47, lt:41, ht:50, cy:49, cr:57,
      tom:47, rim:37, cb:56, cow:56,
      // Dirt-Samples banks
      '909':36, '808':36, '808bd':36, '808sd':38, '808oh':46, '808cy':49,
      bass:36, bassdm:36, hat:42, hihat:42,
      perc:47, shaker:69, tamb:69, marac:69, tabla:47,
      casio:69, pluck:64, piano:60, flute:74, violin:40,
      linnhats:42, arpy:64, gong:76, chin:76, jvbass:36,
      electro1:60, glitch:72, ifdrums:38, clubkick:36, hardkick:36,
      // tidal-drum-machines (RolandTR909_* after aliasBank → TR909_*)
      // canonical name for sequencer display: use the suffix
      tr909bd:36, tr909sd:38, tr909hh:42, tr909oh:46, tr909cp:39,
      tr909cr:49, tr909rd:49, tr909rim:37, tr909ht:50, tr909mt:47, tr909lt:41,
      tr808bd:36, tr808sd:38, tr808hh:42, tr808oh:46, tr808cy:49,
      // aliases produced by aliasBank
      tr909:36, tr808:36, tr707:36, tr606:36, tr727:36, tr505:36,
    }

    function midiToLabel(n) {
      n = Math.round(n)
      return NOTE_NAMES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1)
    }

    function toNum(x) {
      // Unwraps Fraction objects and plain numbers
      if (typeof x === 'number') return x
      if (x !== null && x !== undefined && typeof x.valueOf === 'function') {
        var v = x.valueOf()
        if (typeof v === 'number') return v
      }
      return null
    }

    function parseNoteName(s) {
      // Matches strudel's regex: /^([a-gA-G])([#bsf]*)(-?[0-9]*)$/
      var m = String(s).trim().match(/^([A-Ga-g])([#bsf]*)(-?[0-9]*)$/)
      if (!m || !m[1]) return null
      var base = { C:0, D:2, E:4, F:5, G:7, A:9, B:11 }[m[1].toUpperCase()] || 0
      var acc = 0
      for (var i = 0; i < m[2].length; i++) {
        acc += ({ '#':1, 'b':-1, 's':1, 'f':-1 }[m[2][i]] || 0)
      }
      var octave = m[3] !== '' ? parseInt(m[3]) : 3
      return (octave + 1) * 12 + base + acc
    }

    function hapInfo(val) {
      if (val == null) return null

      // Direct number (MIDI) or Fraction
      var n = toNum(val)
      if (n !== null) return { midi: Math.round(n), label: midiToLabel(n) }

      // Plain string: "c3" note name or "bd" percussion
      if (typeof val === 'string') {
        var s0 = val.trim()
        var midi0 = parseNoteName(s0)
        if (midi0 !== null) return { midi: midi0, label: midiToLabel(midi0) }
        var key0 = s0.toLowerCase().replace(/:.*$/, '').replace(/_.*$/, '')
        if (PERC_MAP[key0] !== undefined) return { midi: PERC_MAP[key0], label: key0.toUpperCase().slice(0, 4) }
        return null
      }

      if (typeof val !== 'object') return null

      // Object: check note property first
      if (val.note !== undefined) {
        var nv = toNum(val.note)
        if (nv !== null) return { midi: Math.round(nv), label: midiToLabel(nv) }
        if (typeof val.note === 'string') {
          var midi1 = parseNoteName(val.note)
          if (midi1 !== null) return { midi: midi1, label: midiToLabel(midi1) }
        }
      }

      // Object: freq (Hz → MIDI)
      if (typeof val.freq === 'number' && val.freq > 0) {
        var n2 = Math.round(12 * Math.log2(val.freq / 440) + 69)
        return { midi: n2, label: midiToLabel(n2) }
      }

      // Object: n (semitone offset from C4, only if no s/sound)
      if (val.n !== undefined && !val.s) {
        var nv2 = toNum(val.n)
        if (nv2 !== null) {
          var n3 = Math.round(nv2) + 60
          return { midi: n3, label: midiToLabel(n3) }
        }
      }

      // Object: sound / sample name
      var snd = (val.s || '').toLowerCase().replace(/:.*$/, '').replace(/_.*$/, '')
      if (snd) {
        var midi3 = PERC_MAP[snd] !== undefined
          ? PERC_MAP[snd]
          : (48 + Object.keys(PERC_MAP).indexOf(snd) % 24)
        return { midi: midi3, label: snd.toUpperCase().slice(0, 4) }
      }

      return null
    }

    // ── Row merging ───────────────────────────────────────────────────────────
    // allRows: [{midi, label, color, activeEvents:[{begin,dur}], previewEvents:[...]}]
    var allRows     = []
    var activeHaps  = []
    var previewHaps = []

    var LABEL_W = 32   // px for note label column

    function hapsToMap(haps) {
      var map = {}
      for (var i = 0; i < haps.length; i++) {
        var info = hapInfo(haps[i].value)
        if (!info) continue
        var key = info.label + '_' + info.midi
        if (!map[key]) map[key] = { midi: info.midi, label: info.label, events: [] }
        var ba  = toNum(haps[i].whole.begin) || 0
        var be  = toNum(haps[i].whole.end)   || 0
        var b   = ba % 1
        var dur = Math.min(Math.max(be - ba, 0.0625), 1 - b + 0.001)
        map[key].events.push({ begin: b, dur: dur })
      }
      return map
    }

    function mergeAndDraw(aHaps, pHaps) {
      var aMap = hapsToMap(aHaps)
      var pMap = hapsToMap(pHaps)
      var seen = {}, keys = []
      for (var k in aMap) { if (!seen[k]) { seen[k] = 1; keys.push(k) } }
      for (var k in pMap) { if (!seen[k]) { seen[k] = 1; keys.push(k) } }

      var rows = []
      for (var i = 0; i < keys.length; i++) {
        var a = aMap[keys[i]], p = pMap[keys[i]], ref = a || p
        rows.push({
          midi:          ref.midi,
          label:         ref.label,
          activeEvents:  a ? a.events : [],
          previewEvents: p ? p.events : [],
          color:         null,
        })
      }
      rows.sort(function(a, b) { return b.midi - a.midi })
      // No hard cap — show every note, use min row height to clip excess
      for (var r = 0; r < rows.length; r++) {
        rows[r].color = TE_COLORS[r % TE_COLORS.length]
      }
      allRows = rows
      drawSeq()
    }

    // ── Canvas ────────────────────────────────────────────────────────────────
    function resizeCanvas() {
      canvas.width  = seqWrap.offsetWidth  || 320
      canvas.height = seqWrap.offsetHeight || 200
      drawSeq()
    }

    function roundRectPath(x, y, w, h, r) {
      var rr = Math.max(0, Math.min(r, w / 2, h / 2))
      if (rc.roundRect) { rc.roundRect(x, y, w, h, rr); return }
      rc.moveTo(x + rr, y)
      rc.lineTo(x + w - rr, y);    rc.quadraticCurveTo(x + w, y,     x + w, y + rr)
      rc.lineTo(x + w, y + h - rr); rc.quadraticCurveTo(x + w, y + h, x + w - rr, y + h)
      rc.lineTo(x + rr, y + h);    rc.quadraticCurveTo(x, y + h,     x, y + h - rr)
      rc.lineTo(x, y + rr);        rc.quadraticCurveTo(x, y,         x + rr, y)
      rc.closePath()
    }

    function drawNoteBlock(x, y, w, rowH, color, isPreview) {
      if (w < 2) return
      var PAD = Math.max(2, Math.floor(rowH * 0.12))
      var nh  = Math.max(3, rowH - PAD * 2)
      var ny  = y + PAD
      var rr  = Math.min(3, Math.floor(w * 0.3), Math.floor(nh * 0.4))

      rc.save()

      rc.globalAlpha = isPreview ? 0.22 : 0.82
      rc.fillStyle = color
      rc.beginPath()
      roundRectPath(x, ny, w - 1, nh, rr)
      rc.fill()

      // Top highlight
      rc.globalAlpha = isPreview ? 0.07 : 0.3
      rc.fillStyle = '#ffffff'
      rc.fillRect(x + 1, ny + 1, Math.max(w - 3, 1), Math.min(2, nh - 2))

      // TE sine-arch above (only for notes wider than 10px)
      if (w > 10) {
        var archH = Math.min(nh * 0.7, 10, rowH * 0.28)
        rc.globalAlpha = isPreview ? 0.1 : 0.4
        rc.strokeStyle = color
        rc.lineWidth   = 1.5
        rc.lineCap     = 'round'
        if (!isPreview) { rc.shadowColor = color; rc.shadowBlur = 4 }
        rc.beginPath()
        rc.moveTo(x + 0.5, ny)
        rc.bezierCurveTo(x + w * 0.3, ny - archH, x + w * 0.7, ny - archH, x + w - 1.5, ny)
        rc.stroke()
        rc.shadowBlur = 0
      }

      rc.restore()
    }

    var HEADER_H = 13  // px for each section header row

    function drawSection(offsetY, sectionH, events, label, isPreview) {
      var W  = canvas.width
      var GW = W - LABEL_W
      var nRows = allRows.length
      var rowH  = Math.max(Math.floor((sectionH - HEADER_H) / nRows), 10)

      // Section header background
      rc.fillStyle = '#080808'
      rc.fillRect(0, offsetY, W, HEADER_H)

      // Section header label
      rc.font        = '700 7px system-ui'
      rc.textBaseline = 'middle'
      rc.fillStyle   = isPreview ? 'rgba(255,214,62,0.35)' : 'rgba(255,255,255,0.28)'
      rc.textAlign   = 'left'
      rc.fillText(label, LABEL_W + 5, offsetY + HEADER_H / 2)

      // Beat numbers in header
      rc.fillStyle = 'rgba(255,255,255,0.12)'
      for (var b = 0; b < 4; b++) {
        rc.textAlign = 'center'
        rc.fillText(b + 1, LABEL_W + (b / 4 + 1 / 8) * GW, offsetY + HEADER_H / 2)
      }

      var gridY = offsetY + HEADER_H

      // Row backgrounds + beat grid (draw once, shared)
      for (var ri = 0; ri < nRows; ri++) {
        var ry = gridY + ri * rowH
        rc.fillStyle = ri % 2 === 0 ? '#0c0c0c' : '#101010'
        rc.fillRect(0, ry, W, rowH)
      }

      // Vertical beat grid lines
      var STEPS = 16
      rc.lineWidth = 1
      for (var s = 0; s <= STEPS; s++) {
        rc.strokeStyle = s % 4 === 0 ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.02)'
        var gx = LABEL_W + (s / STEPS) * GW
        rc.beginPath(); rc.moveTo(gx, gridY); rc.lineTo(gx, gridY + nRows * rowH); rc.stroke()
      }

      // Label column separator
      rc.strokeStyle = 'rgba(255,255,255,0.04)'
      rc.lineWidth   = 1
      rc.beginPath(); rc.moveTo(LABEL_W, gridY); rc.lineTo(LABEL_W, gridY + nRows * rowH); rc.stroke()

      // Rows: label + note blocks
      for (var ri2 = 0; ri2 < nRows; ri2++) {
        var row = allRows[ri2]
        var ry2 = gridY + ri2 * rowH

        // Label
        rc.save()
        rc.globalAlpha  = isPreview ? 0.35 : 0.6
        rc.fillStyle    = row.color
        rc.font         = '700 ' + Math.min(rowH - 2, 9) + 'px system-ui'
        rc.textAlign    = 'center'
        rc.textBaseline = 'middle'
        rc.fillText(row.label, LABEL_W / 2, ry2 + rowH / 2)
        rc.restore()

        // Note blocks for this section's events
        var evts = events[ri2] || []
        for (var ei = 0; ei < evts.length; ei++) {
          var ev = evts[ei]
          var ex = LABEL_W + ev.begin * GW
          var ew = Math.max(ev.dur * GW, 4)
          drawNoteBlock(ex, ry2, ew, rowH, row.color, isPreview)
        }
      }
    }

    function drawSeq() {
      var W  = canvas.width
      var H  = canvas.height
      var HH = Math.floor(H / 2)  // each section gets half the height

      rc.clearRect(0, 0, W, H)
      rc.fillStyle = '#0c0c0c'
      rc.fillRect(0, 0, W, H)

      if (allRows.length === 0) {
        rc.fillStyle    = 'rgba(255,255,255,0.07)'
        rc.font         = '700 8px system-ui'
        rc.textAlign    = 'center'
        rc.textBaseline = 'middle'
        rc.fillText('► SCRIVI CODICE STRUDEL E PREMI PLAY', W / 2, H / 2)
        return
      }

      // Build per-section event arrays (indexed by row)
      var activeEvts  = allRows.map(function(r) { return r.activeEvents })
      var previewEvts = allRows.map(function(r) { return r.previewEvents })

      // TOP section: SUONA (current)
      drawSection(0, HH, activeEvts, 'SUONA', false)

      // Horizontal divider
      rc.strokeStyle = 'rgba(255,255,255,0.14)'
      rc.lineWidth   = 1
      rc.beginPath(); rc.moveTo(0, HH); rc.lineTo(W, HH); rc.stroke()

      // BOTTOM section: PROSSIMA (preview)
      drawSection(HH, HH, previewEvts, 'PROSSIMA', true)

      // Playhead — only in top section
      if (isPlaying && strudelScheduler) {
        try {
          var now = strudelScheduler.now()
          var pos = now % 1
          var GW  = W - LABEL_W
          var phX = LABEL_W + pos * GW
          var nRows = allRows.length
          var rowH  = Math.max(Math.floor((HH - HEADER_H) / nRows), 10)
          rc.save()
          rc.strokeStyle = 'rgba(255,255,255,0.85)'
          rc.lineWidth   = 1.5
          rc.shadowColor = '#ffffff'
          rc.shadowBlur  = 5
          rc.beginPath()
          rc.moveTo(phX, HEADER_H)
          rc.lineTo(phX, HEADER_H + nRows * rowH)
          rc.stroke()
          rc.restore()
          beatTxt.textContent = 'BAR ' + (Math.floor(now) + 1) + '  \xb7  ' + (Math.floor(pos * 4) + 1) + '/4'
        } catch(e) {}
      }
    }

    // ── RAF: playhead animation + bar-boundary eval ───────────────────────────
    var strudelScheduler = null
    var lastBarIdx  = -1
    var rafActive   = false
    var pendingCode = null

    function startRaf() {
      if (rafActive) return
      rafActive = true
      ;(function tick() {
        if (!isPlaying) { rafActive = false; return }
        drawSeq()
        if (strudelScheduler) {
          try {
            var now    = strudelScheduler.now()
            var barIdx = Math.floor(now)
            if (pendingCode !== null && lastBarIdx >= 0 && barIdx > lastBarIdx) {
              var code = pendingCode; pendingCode = null
              pendPill.style.display = 'none'
              strudelEval(code).catch(function(err) {
                setError((err && err.message) ? err.message : String(err))
              })
            }
            lastBarIdx = barIdx
          } catch(e) {}
        }
        requestAnimationFrame(tick)
      })()
    }

    function resetVisuals() {
      isPlaying   = false
      rafActive   = false
      pendingCode = null
      lastBarIdx  = -1
      allRows     = []
      activeHaps  = []
      previewHaps = []
      pendPill.style.display = 'none'
      beatTxt.textContent    = ''
      drawSeq()
    }

    // ── Silent preview eval (no audio change) ─────────────────────────────────
    // Transpiles strudel code → plain JS → creates Pattern → queryArc for haps.
    async function evalPreview(code) {
      try {
        var pat
        if (transpile) {
          try {
            var result = transpile(code)
            if (result && result.output) {
              // eslint-disable-next-line no-new-func
              var AsyncFunc = Object.getPrototypeOf(async function(){}).constructor
              pat = await new AsyncFunc(result.output)()
            }
          } catch(_te) {
            try { pat = eval(code) } catch(_) {} // eslint-disable-line no-eval
          }
        } else {
          try { pat = eval(code) } catch(_) {} // eslint-disable-line no-eval
        }
        if (pat && typeof pat.queryArc === 'function') {
          var haps = pat.queryArc(0, 1).filter(function(h) {
            return typeof h.hasOnset === 'function' ? h.hasOnset() : true
          })
          previewHaps = haps
          mergeAndDraw(activeHaps, previewHaps)
        }
      } catch(e) {} // silent on error — keep old preview
    }

    // ── Strudel wiring ────────────────────────────────────────────────────────
    var strudelEval   = null
    var strudelHush   = null
    var audioUnlocked = false
    var transpile     = null   // set after initStrudel

    window.activateAudio = function() {}

    window.addEventListener('message', function(evt) {
      if (!evt.data || evt.data.source !== 'strudel-control') return

      if (evt.data.action === 'evaluate') {
        setError(null)
        if (!strudelEval) { pendingCode = evt.data.code; return }
        if (!audioUnlocked) {
          pendingCode = evt.data.code
          audioGate.classList.add('visible')
          setStatus("CLICCA PER ATTIVARE L'AUDIO")
          return
        }
        if (isPlaying) {
          pendingCode = evt.data.code
          pendPill.style.display = 'block'
          evalPreview(evt.data.code)   // update PROSSIMA section immediately
        } else {
          strudelEval(evt.data.code).catch(function(err) {
            setStatus('ERRORE.'); setError((err && err.message) ? err.message : String(err))
          })
        }
      }

      if (evt.data.action === 'preview') {
        if (isPlaying) evalPreview(evt.data.code)
      }

      if (evt.data.action === 'stop') {
        if (strudelHush) strudelHush()
        resetVisuals()
        setStatus('FERMATO.')
      }
    })

    // ── Load Strudel ──────────────────────────────────────────────────────────
    new ResizeObserver(resizeCanvas).observe(seqWrap)
    resizeCanvas()

    var mod = null
    try {
      setStatus('CARICAMENTO LIBRERIA...')
      mod = await import('${STRUDEL_CDN}')
      for (var k in mod) { try { globalThis[k] = mod[k] } catch(_) {} }

      // Resolve transpiler (may be re-exported by @strudel/web or load separately)
      transpile = mod.transpiler || null
      if (!transpile) {
        try {
          var tmod = await import('https://esm.sh/@strudel/transpiler')
          transpile = tmod.transpiler || null
        } catch(_) {}
      }

      setStatus('CARICAMENTO CAMPIONI...')
      var DS = 'https://raw.githubusercontent.com/felixroos/dough-samples/main'
      var strudelRepl = await mod.initStrudel({
        prebake: async function() {
          var loads = []
          if (typeof mod.samples === 'function') {
            // Match strudel.cc: load dough-samples CDN (includes RolandTR909_*, etc.)
            loads.push(mod.samples(DS + '/tidal-drum-machines.json').catch(function(e){ console.warn('[strudel] tdm:', e) }))
            loads.push(mod.samples(DS + '/Dirt-Samples.json').catch(function(e){ console.warn('[strudel] dirt:', e) }))
            loads.push(mod.samples(DS + '/piano.json').catch(function(e){}))
          }
          await Promise.all(loads)
          // Aliases: RolandTR909 → TR909, RolandTR808 → TR808, etc.
          if (typeof mod.aliasBank === 'function') {
            mod.aliasBank('https://raw.githubusercontent.com/todepond/samples/main/tidal-drum-machines-alias.json').catch(function(){})
          }
        },
        afterEval: function(evCtx) {
          var pattern = evCtx && evCtx.pattern
          var haps = []
          if (pattern && typeof pattern.queryArc === 'function') {
            try {
              haps = pattern.queryArc(0, 1).filter(function(h) {
                return typeof h.hasOnset === 'function' ? h.hasOnset() : true
              })
            } catch(e) { console.warn('[strudel] queryArc:', e) }
          }
          activeHaps  = haps
          previewHaps = haps   // preview mirrors active until code changes
          setStatus('SUONANDO ♪', true)
          startRaf()
          mergeAndDraw(activeHaps, previewHaps)
        },
        onEvalError: function(err) {
          setStatus('ERRORE NEL CODICE.')
          setError((err && err.message) ? err.message : String(err))
        },
        onSchedulerError: function(err) {
          setStatus('ERRORE AUDIO.')
          setError((err && err.message) ? err.message : String(err))
        },
      })

      strudelScheduler = strudelRepl && strudelRepl.scheduler ? strudelRepl.scheduler : null
      strudelEval  = function(code) { return mod.evaluate(code) }
      strudelHush  = function() { mod.hush(); resetVisuals(); }

      window.activateAudio = async function() {
        audioUnlocked = true
        audioGate.classList.remove('visible')
        if (typeof mod.getAudioContext === 'function') {
          var ac = mod.getAudioContext()
          if (ac && ac.state !== 'running') { try { await ac.resume() } catch(_) {} }
        }
        if (pendingCode !== null) {
          var code = pendingCode; pendingCode = null
          strudelEval(code).catch(function(err) {
            setStatus('ERRORE.'); setError((err && err.message) ? err.message : String(err))
          })
        }
      }

      setStatus('PRONTO — PREMI ► PER INIZIARE.')
      notify('ready', null)
    } catch (err) {
      setStatus('ERRORE CARICAMENTO.')
      setError('Impossibile caricare Strudel: ' + ((err && err.message) ? err.message : String(err)))
    }
  </script>
</body>
</html>`
}

const STRUDEL_DOC = buildStrudelDoc()

const NotebookStrudelPreview = forwardRef<StrudelPreviewHandle, Props>(
  function NotebookStrudelPreview({ runtimeError }, ref) {
    const iframeRef = useRef<HTMLIFrameElement>(null)

    const post = (msg: object) =>
      iframeRef.current?.contentWindow?.postMessage(msg, '*')

    useImperativeHandle(ref, () => ({
      evaluate: (code: string) =>
        post({ source: 'strudel-control', action: 'evaluate', code }),
      preview: (code: string) =>
        post({ source: 'strudel-control', action: 'preview', code }),
      stop: () =>
        post({ source: 'strudel-control', action: 'stop' }),
    }))

    return (
      <div className="relative h-full min-h-[320px] overflow-hidden rounded-lg">
        <iframe
          ref={iframeRef}
          title="Strudel Live Music"
          srcDoc={STRUDEL_DOC}
          sandbox="allow-scripts"
          className="h-full w-full border-0"
        />
        {runtimeError && (
          <div className="absolute inset-x-4 bottom-4 rounded-xl border border-red-500/30 bg-red-950/85 px-4 py-3 text-sm text-red-100 backdrop-blur">
            <p className="font-mono text-xs leading-relaxed">{runtimeError}</p>
          </div>
        )}
      </div>
    )
  },
)

export default NotebookStrudelPreview
