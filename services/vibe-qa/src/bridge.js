'use strict'
// Deterministic stand-in for window.GolinelliAI: the QA run checks the generated UI and logic, not the AI providers.
// Every call is recorded in window.__qaCalls so the report can show which platform services the app really used.
const BRIDGE = `
(function () {
  var calls = (window.__qaCalls = []);
  var store = {};
  function rec(name, args) { calls.push({ name: name, at: Date.now() }); }
  // Stand-in for a generated photo: a soft, text-free gradient so layout and crops can be judged (the real image arrives in production).
  function svg(label) {
    var h = 0, t = String(label || 'x'); for (var i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) % 360;
    var s = '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(' + h + ',28%,72%)"/><stop offset="1" stop-color="hsl(' + ((h + 40) % 360) + ',32%,46%)"/></linearGradient></defs><rect width="800" height="600" fill="url(#g)"/><circle cx="560" cy="210" r="140" fill="rgba(255,255,255,0.16)"/><circle cx="250" cy="440" r="190" fill="rgba(0,0,0,0.10)"/></svg>';
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(s);
  }
  var tick = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  window.GolinelliAI = {
    chat: function (a) { rec('chat'); return tick(30).then(function () { return { response: 'Risposta di prova dell\\'assistente.' }; }); },
    chatStream: function (a) { rec('chatStream'); var t = 'Risposta di prova dell\\'assistente.'; if (a && a.onToken) a.onToken(t, t); return tick(30).then(function () { return { response: t }; }); },
    json: function (a) { rec('json'); return tick(30).then(function () { return { items: [], text: 'dato di prova', ok: true }; }); },
    vision: function (a) { rec('vision'); return tick(30).then(function () { return { response: 'Descrizione di prova dell\\'immagine.' }; }); },
    generateImage: function (a) { rec('generateImage'); return tick(40).then(function () { return { image_url: svg(a && a.prompt) }; }); },
    places: function (a) { rec('places'); return tick(30).then(function () { return [{ name: 'Luogo di prova', label: 'Luogo di prova, Milano', lat: 45.4642, lon: 9.19, type: 'place' }]; }); },
    speak: function () { rec('speak'); return Promise.resolve(); }, stopSpeaking: function () {}, listen: function () { rec('listen'); return Promise.resolve('testo di prova'); },
    me: function () { return Promise.resolve({ name: 'Utente di prova', role: 'teacher' }); },
    saveData: function (a) { rec('saveData'); store[a.key] = a.value; return Promise.resolve({ key: a.key, value: a.value }); },
    loadData: function (a) { rec('loadData'); return Promise.resolve({ key: a.key, value: a.key in store ? store[a.key] : null }); },
    deleteData: function (a) { delete store[a.key]; return Promise.resolve({}); },
    shared: { get: function () { return Promise.resolve(null); }, set: function (k, v) { return Promise.resolve(v); }, append: function (k, v) { return Promise.resolve([v]); }, subscribe: function () { return function () {}; } },
    media: {
      camera: function () { rec('camera'); return Promise.reject(new Error('Camera non disponibile nel test automatico')); },
      microphone: function () { rec('microphone'); return Promise.reject(new Error('Microfono non disponibile nel test automatico')); },
      cameraAndMicrophone: function () { return Promise.reject(new Error('Camera non disponibile nel test automatico')); },
      attach: function () { return Promise.resolve(); },
    },
    ml: { face: function () { return Promise.reject(new Error('ML non disponibile nel test automatico')); }, hand: function () { return Promise.reject(new Error('ML non disponibile nel test automatico')); }, pose: function () { return Promise.reject(new Error('ML non disponibile nel test automatico')); } },
  };
  window.GolinelliML = { load: function () { return Promise.reject(new Error('ML non disponibile nel test automatico')); } };
})();
`
module.exports = { BRIDGE }
