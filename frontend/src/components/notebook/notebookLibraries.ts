export interface LibraryTemplate {
  id: string
  name: string
  description: string
  code: string
}

export interface NotebookLibrary {
  id: string
  name: string
  description: string
  icon: string
  category: 'ml' | 'audio' | 'physics' | 'graphics'
  cdnUrls: string[]
  requiresCamera: boolean
  templates: LibraryTemplate[]
}

export const LIBRARY_CATEGORIES: Record<NotebookLibrary['category'], string> = {
  ml: 'ML & AI',
  audio: 'Audio',
  physics: 'Fisica',
  graphics: 'Grafica',
}

// Hand connections for ml5 v1 / MediaPipe 21-keypoint model
const HAND_CONNECTIONS = `
const HAND_CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,4],
  [0,5],[5,6],[6,7],[7,8],
  [0,9],[9,10],[10,11],[11,12],
  [0,13],[13,14],[14,15],[15,16],
  [0,17],[17,18],[18,19],[19,20],
  [5,9],[9,13],[13,17]
];`

// Body connections for ml5 v1 / MoveNet 17-keypoint model
const BODY_CONNECTIONS = `
const BODY_CONNECTIONS = [
  [0,1],[0,2],[1,3],[2,4],
  [5,6],[5,7],[7,9],[6,8],[8,10],
  [5,11],[6,12],[11,12],
  [11,13],[13,15],[12,14],[14,16]
];`

export const NOTEBOOK_LIBRARIES: NotebookLibrary[] = [
  // ─── ml5.js ────────────────────────────────────────────────────────────────
  {
    id: 'ml5',
    name: 'ml5.js',
    description: 'Machine learning nel browser: hand pose, body pose, object detection, segmentazione e classificazione immagini',
    icon: '🤖',
    category: 'ml',
    cdnUrls: ['https://unpkg.com/ml5@1/dist/ml5.min.js'],
    requiresCamera: true,
    templates: [
      {
        id: 'ml5-handpose',
        name: 'Riconoscimento mani — scheletro',
        description: 'Scheletro delle mani in tempo reale con 21 keypoint (ml5 v1 API)',
        code: `// ml5.js v1 — Riconoscimento mani con scheletro
// Richiede: webcam attiva
${HAND_CONNECTIONS}

let video, handpose;
let hands = [];
let ready = false;

function setup() {
  createCanvas(640, 480);
  textFont('monospace');

  video = createCapture(VIDEO);
  video.size(640, 480);
  video.hide();

  // ml5 v1: constructor callback = modello pronto
  handpose = ml5.handPose({}, () => {
    ready = true;
    handpose.detectStart(video, (results) => { hands = results; });
  });
}

function draw() {
  // Specchia il video (effetto selfie)
  push();
  translate(width, 0);
  scale(-1, 1);
  image(video, 0, 0, width, height);
  pop();

  if (!ready) {
    fill(0, 190); noStroke(); rect(0, 0, width, 52);
    fill(255); textSize(14); textAlign(CENTER);
    text('Caricamento modello HandPose...', width / 2, 30);
    textAlign(LEFT);
    return;
  }

  for (let hand of hands) {
    let kps = hand.keypoints;

    // Scheletro
    stroke(0, 230, 120); strokeWeight(2); noFill();
    for (let [a, b] of HAND_CONNECTIONS) {
      let pa = kps[a], pb = kps[b];
      line(width - pa.x, pa.y, width - pb.x, pb.y);
    }

    // Keypoint
    noStroke();
    for (let i = 0; i < kps.length; i++) {
      fill(i === 0 ? color(255, 100, 50) : color(255, 220, 0));
      circle(width - kps[i].x, kps[i].y, i === 0 ? 14 : 8);
    }

    // Etichetta mano
    fill(255); noStroke(); textSize(12);
    text(hand.handedness, width - kps[0].x + 10, kps[0].y - 8);
  }

  // HUD
  noStroke(); fill(0, 180); rect(8, 8, 175, 22, 4);
  fill(255); textSize(11);
  text('Mani rilevate: ' + hands.length, 14, 23);
}`,
      },
      {
        id: 'ml5-bodypose',
        name: 'Body Pose — scheletro corpo',
        description: 'Tracciamento del corpo completo con MoveNet 17 keypoint (ml5 v1 API)',
        code: `// ml5.js v1 — Body Pose con scheletro
// Richiede: webcam attiva
${BODY_CONNECTIONS}

let video, bodypose;
let poses = [];
let ready = false;

function setup() {
  createCanvas(640, 480);
  textFont('monospace');

  video = createCapture(VIDEO);
  video.size(640, 480);
  video.hide();

  bodypose = ml5.bodyPose({}, () => {
    ready = true;
    bodypose.detectStart(video, (results) => { poses = results; });
  });
}

function draw() {
  push();
  translate(width, 0);
  scale(-1, 1);
  image(video, 0, 0, width, height);
  pop();

  if (!ready) {
    fill(0, 190); noStroke(); rect(0, 0, width, 52);
    fill(255); textSize(14); textAlign(CENTER);
    text('Caricamento modello BodyPose...', width / 2, 30);
    textAlign(LEFT);
    return;
  }

  for (let pose of poses) {
    let kps = pose.keypoints;

    // Scheletro
    stroke(0, 200, 255); strokeWeight(3); noFill();
    for (let [a, b] of BODY_CONNECTIONS) {
      let pa = kps[a], pb = kps[b];
      if (pa.confidence > 0.3 && pb.confidence > 0.3)
        line(width - pa.x, pa.y, width - pb.x, pb.y);
    }

    // Keypoint
    noStroke();
    for (let kp of kps) {
      if (kp.confidence > 0.3) {
        fill(kp.confidence > 0.7 ? color(255, 220, 0) : color(255, 150, 0));
        circle(width - kp.x, kp.y, 10);
      }
    }
  }

  noStroke(); fill(0, 180); rect(8, 8, 180, 22, 4);
  fill(255); textSize(11);
  text('Pose rilevate: ' + poses.length, 14, 23);
}`,
      },
      {
        id: 'ml5-objectdetect',
        name: 'Object Detection — COCO-SSD',
        description: 'Rilevamento 80 categorie di oggetti con bounding box (ml5 v1 API)',
        code: `// ml5.js v1 — Object Detection COCO-SSD
// Richiede: webcam attiva

let video, detector;
let detections = [];
let ready = false;

function setup() {
  createCanvas(640, 480);
  textFont('monospace');

  video = createCapture(VIDEO);
  video.size(640, 480);
  video.hide();

  // ml5 v1: objectDetector con callback ready
  detector = ml5.objectDetector('COCOSSD', {}, () => {
    ready = true;
    detector.detectStart(video, (results) => {
      if (results) detections = results;
    });
  });
}

function draw() {
  image(video, 0, 0, width, height);

  if (!ready) {
    fill(0, 190); noStroke(); rect(0, 0, width, 52);
    fill(255); textSize(14); textAlign(CENTER);
    text('Caricamento COCO-SSD...', width / 2, 30);
    textAlign(LEFT);
    return;
  }

  for (let d of detections) {
    // Bounding box
    noFill(); stroke(0, 255, 80); strokeWeight(2);
    rect(d.x, d.y, d.width, d.height, 4);

    // Etichetta con sfondo
    let label = d.label + ' ' + nf(d.confidence * 100, 1, 0) + '%';
    let lw = textWidth(label) + 12;
    fill(0, 255, 80); noStroke();
    rect(d.x, d.y - 22, lw, 22, 4, 4, 0, 0);
    fill(0); textSize(12);
    text(label, d.x + 6, d.y - 6);
  }

  noStroke(); fill(0, 180); rect(8, 8, 220, 22, 4);
  fill(255); textSize(11);
  text('Oggetti: ' + detections.length + '  FPS: ' + round(frameRate()), 14, 23);
}`,
      },
      {
        id: 'ml5-segmentation',
        name: 'Segmentazione corpo',
        description: 'Separa persona dallo sfondo — maschera visuale in tempo reale (ml5 v1 API)',
        code: `// ml5.js v1 — Body Segmentation
// Richiede: webcam attiva
// Click per cambiare effetto

let video, segmenter;
let segResult = null;
let ready = false;
let mode = 0;
const MODES = ['Maschera verde', 'Silhouette', 'Effetto neon'];

function setup() {
  createCanvas(640, 480);
  textFont('monospace');

  video = createCapture(VIDEO);
  video.size(640, 480);
  video.hide();

  // ml5 v1: bodySegmentation con callback ready
  segmenter = ml5.bodySegmentation('SelfieSegmentation', {}, () => {
    ready = true;
    segmenter.detectStart(video, (result) => {
      if (result) segResult = result;
    });
  });
}

function draw() {
  background(30);
  image(video, 0, 0, width, height);

  if (!ready) {
    fill(0, 190); noStroke(); rect(0, 0, width, 52);
    fill(255); textSize(14); textAlign(CENTER);
    text('Caricamento SelfieSegmentation...', width / 2, 30);
    textAlign(LEFT);
    return;
  }

  if (!segResult || !segResult.mask) return;

  // Effetti visivi con la maschera della persona
  if (mode === 0) {
    // Sovrapponi la maschera con colore verde (dove c'è la persona)
    tint(0, 255, 100, 160);
    image(segResult.mask, 0, 0, width, height);
    noTint();
  } else if (mode === 1) {
    // Silhouette: inverti i colori
    tint(255, 220);
    image(segResult.mask, 0, 0, width, height);
    noTint();
    blendMode(DIFFERENCE);
    image(video, 0, 0, width, height);
    blendMode(BLEND);
  } else {
    // Effetto neon pulsante
    let pulse = map(sin(frameCount * 0.08), -1, 1, 80, 220);
    tint(pulse, 0, 255, 180);
    image(segResult.mask, 0, 0, width, height);
    noTint();
  }

  // HUD
  noStroke(); fill(0, 180); rect(8, 8, 210, 42, 4);
  fill(255); textSize(11);
  text('Click: cambia effetto', 14, 23);
  text('Effetto: ' + MODES[mode], 14, 38);
}

function mousePressed() {
  mode = (mode + 1) % MODES.length;
}`,
      },
      {
        id: 'ml5-imageclassifier',
        name: 'Classificazione immagini — MobileNet',
        description: 'Classifica ciò che vede la webcam in 1000 categorie (ml5 v1 API)',
        code: `// ml5.js v1 — Image Classifier MobileNet
// Richiede: webcam attiva

let video, classifier;
let topLabel = '';
let topConf = 0;
let history = [];
let ready = false;

function setup() {
  createCanvas(640, 480);
  textFont('monospace');

  video = createCapture(VIDEO);
  video.size(640, 480);
  video.hide();

  // ml5 v1: imageClassifier con callback ready
  classifier = ml5.imageClassifier('MobileNet', {}, () => {
    ready = true;
    // classifyStart: riclassifica in continuo
    classifier.classifyStart(video, (results) => {
      if (results && results.length > 0) {
        topLabel = results[0].label.split(',')[0].trim();
        topConf = results[0].confidence;
        history.unshift({ label: topLabel, conf: topConf });
        if (history.length > 5) history.pop();
      }
    });
  });
}

function draw() {
  image(video, 0, 0, width, height);

  if (!ready) {
    fill(0, 190); noStroke(); rect(0, 0, width, 52);
    fill(255); textSize(14); textAlign(CENTER);
    text('Caricamento MobileNet...', width / 2, 30);
    textAlign(LEFT);
    return;
  }

  // Pannello basso con risultato
  noStroke(); fill(0, 0, 0, 190);
  rect(0, height - 90, width, 90);

  fill(255, 220, 0); textSize(22);
  text(topLabel || '—', 16, height - 54);

  fill(200); textSize(13);
  text('Confidenza: ' + nf(topConf * 100, 1, 1) + '%', 16, height - 26);

  // Barra
  fill(40); rect(16, height - 18, width - 32, 10, 5);
  fill(0, 200, 120); rect(16, height - 18, (width - 32) * topConf, 10, 5);

  // Storico
  noStroke(); fill(0, 160); rect(8, 8, 235, history.length * 22 + 14, 5);
  for (let i = 0; i < history.length; i++) {
    fill(255, map(i, 0, history.length, 255, 60));
    text(history[i].label + ' (' + nf(history[i].conf * 100, 1, 0) + '%)', 14, 24 + i * 22);
  }
}`,
      },
    ],
  },

  // ─── Matter.js ─────────────────────────────────────────────────────────────
  {
    id: 'matterjs',
    name: 'Matter.js',
    description: 'Motore fisico 2D: gravità, collisioni, corpi rigidi, vincoli e mouse drag',
    icon: '⚙️',
    category: 'physics',
    cdnUrls: ['https://cdnjs.cloudflare.com/ajax/libs/matter-js/0.19.0/matter.min.js'],
    requiresCamera: false,
    templates: [
      {
        id: 'matter-basic',
        name: 'Fisica di base',
        description: 'Box e cerchi con gravità, collisioni e mouse drag',
        code: `// Matter.js — Fisica di base
// Click per aggiungere corpi, trascina per muoverli

const { Engine, Bodies, Body, Composite, Mouse, MouseConstraint } = Matter;

let engine, world;

function setup() {
  let canvas = createCanvas(640, 480);
  engine = Engine.create();
  world = engine.world;

  Composite.add(world, [
    Bodies.rectangle(320, 496, 640, 20, { isStatic: true }),
    Bodies.rectangle(-10, 240, 20, 480, { isStatic: true }),
    Bodies.rectangle(650, 240, 20, 480, { isStatic: true }),
  ]);

  let mouse = Mouse.create(canvas.elt);
  Composite.add(world, MouseConstraint.create(engine, {
    mouse,
    constraint: { stiffness: 0.2, render: { visible: false } },
  }));

  textFont('monospace');
}

function draw() {
  background(18, 22, 38);
  Engine.update(engine, 1000 / 60);

  for (let b of Composite.allBodies(world)) {
    beginShape();
    if (b.isStatic) {
      fill(55, 65, 100); stroke(80, 95, 140);
    } else {
      colorMode(HSB);
      fill((b.id * 53) % 360, 80, 90);
      stroke((b.id * 53) % 360, 60, 100);
      colorMode(RGB);
    }
    strokeWeight(1);
    for (let v of b.vertices) vertex(v.x, v.y);
    endShape(CLOSE);
  }

  noStroke(); fill(255, 120); textSize(11); textFont('monospace');
  text('Click: aggiungi · Trascina: muovi', 10, 20);
}

function mousePressed() {
  let b = random() > 0.5
    ? Bodies.rectangle(mouseX, mouseY, random(20, 60), random(20, 60))
    : Bodies.circle(mouseX, mouseY, random(10, 30), { restitution: 0.7 });
  Body.setVelocity(b, { x: random(-3, 3), y: 0 });
  Composite.add(world, b);
}`,
      },
      {
        id: 'matter-chain',
        name: 'Catena & pendolo',
        description: 'Corpi collegati da vincoli elastici',
        code: `// Matter.js — Catena e pendolo
// Click per dare un impulso

const { Engine, Bodies, Body, Composite, Constraint } = Matter;

let engine, world, bob;

function setup() {
  createCanvas(640, 480);
  engine = Engine.create();
  world = engine.world;

  let pivot = Bodies.circle(320, 50, 8, { isStatic: true });
  Composite.add(world, pivot);

  let prev = pivot;
  for (let i = 0; i < 9; i++) {
    let b = Bodies.circle(320, 80 + i * 36, 12, { frictionAir: 0.015, restitution: 0.3 });
    Composite.add(world, [
      b,
      Constraint.create({ bodyA: prev, bodyB: b, length: 28, stiffness: 0.8, damping: 0.05 }),
    ]);
    prev = b;
  }

  bob = Bodies.circle(320, 80 + 9 * 36, 28, { restitution: 0.5, frictionAir: 0.008 });
  Composite.add(world, [
    bob,
    Constraint.create({ bodyA: prev, bodyB: bob, length: 28, stiffness: 0.9 }),
  ]);

  Body.setVelocity(bob, { x: 6, y: 0 });
  textFont('monospace');
}

function draw() {
  background(14, 16, 28);
  Engine.update(engine, 1000 / 60);

  stroke(100, 160, 255, 160); strokeWeight(2);
  for (let c of Composite.allConstraints(world)) {
    let pa = c.bodyA ? c.bodyA.position : c.pointA;
    let pb = c.bodyB ? c.bodyB.position : c.pointB;
    line(pa.x, pa.y, pb.x, pb.y);
  }

  noStroke();
  for (let b of Composite.allBodies(world)) {
    let p = b.position;
    if (b.isStatic) fill(70, 80, 120);
    else if (b === bob) { colorMode(HSB); fill(frameCount % 360, 80, 95); colorMode(RGB); }
    else fill(80, 180, 255);
    circle(p.x, p.y, (b.circleRadius || 12) * 2);
  }

  noStroke(); fill(255, 100); textSize(11);
  text('Click per impulso', 10, 20);
}

function mousePressed() {
  Body.applyForce(bob, bob.position, { x: random(-0.06, 0.06), y: random(-0.04, 0) });
}`,
      },
    ],
  },

  // ─── Tone.js ───────────────────────────────────────────────────────────────
  {
    id: 'tonejs',
    name: 'Tone.js',
    description: 'Sintesi audio, sequencer, effetti e musica generativa nel browser',
    icon: '🎵',
    category: 'audio',
    cdnUrls: ['https://cdnjs.cloudflare.com/ajax/libs/tone/14.7.77/Tone.js'],
    requiresCamera: false,
    templates: [
      {
        id: 'tone-theremin',
        name: 'Theremin con mouse',
        description: 'X = nota musicale · Y = volume — strumento interattivo',
        code: `// Tone.js — Theremin
// Click per attivare, muovi il mouse per suonare

let synth, reverb;
let active = false;
const SCALE = [261, 294, 330, 349, 392, 440, 494, 523, 587, 659, 698, 784];

async function setup() {
  createCanvas(640, 400);
  colorMode(HSB);
  textFont('monospace');

  reverb = new Tone.Reverb({ decay: 2.5, wet: 0.4 }).toDestination();
  synth = new Tone.Synth({
    oscillator: { type: 'sine' },
    envelope: { attack: 0.1, decay: 0, sustain: 1, release: 0.8 },
  }).connect(reverb);
  synth.volume.value = -20;
}

function draw() {
  background(240, 0.05, 0.08);

  let nCols = SCALE.length;
  let cw = width / nCols;
  for (let i = 0; i < nCols; i++) {
    let hue = map(i, 0, nCols, 0, 300);
    let isActive = active && floor(map(mouseX, 0, width, 0, nCols)) === i;
    fill(hue, isActive ? 0.85 : 0.4, isActive ? 1 : 0.25); noStroke();
    rect(i * cw + 1, 0, cw - 2, height);
    fill(hue, 0.5, 0.8); textSize(10); textAlign(CENTER);
    text(SCALE[i] + 'Hz', i * cw + cw / 2, height - 14);
  }

  if (active) {
    let hue = map(mouseX, 0, width, 0, 300);
    stroke(hue, 0.9, 1); strokeWeight(1.5); noFill();
    line(mouseX, 0, mouseX, height);
    line(0, mouseY, width, mouseY);
    circle(mouseX, mouseY, 40);
  }

  textAlign(LEFT); noStroke(); fill(0, 0, active ? 0.9 : 0.5); textSize(12);
  text(active ? 'Suono attivo — muovi il mouse' : 'Click per attivare', 10, 22);
}

async function mousePressed() {
  await Tone.start();
  active = !active;
  if (active) {
    let idx = constrain(floor(map(mouseX, 0, width, 0, SCALE.length)), 0, SCALE.length - 1);
    synth.triggerAttack(SCALE[idx]);
  } else {
    synth.triggerRelease();
  }
}

function mouseMoved() {
  if (!active) return;
  let idx = constrain(floor(map(mouseX, 0, width, 0, SCALE.length)), 0, SCALE.length - 1);
  synth.frequency.rampTo(SCALE[idx], 0.05);
  synth.volume.rampTo(map(mouseY, height, 0, -30, -5), 0.05);
}`,
      },
      {
        id: 'tone-sequencer',
        name: 'Step Sequencer 16 passi',
        description: 'Drum machine a 4 tracce — click per comporre il pattern',
        code: `// Tone.js — Step Sequencer 16 passi
// Click sulle celle per attivare · Pulsante Play per avviare

let synths = [];
let grid = [];
let seq, currentStep = 0, started = false;

const ROWS = 4;
const STEPS = 16;
const NAMES = ['Kick', 'Snare', 'Hi-Hat', 'Clap'];
const COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12'];
const FREQS = [80, 250, 8000, 1800];

async function setup() {
  createCanvas(640, 320);
  textFont('monospace');

  for (let r = 0; r < ROWS; r++) {
    grid[r] = Array(STEPS).fill(false);
    synths[r] = new Tone.MembraneSynth({
      pitchDecay: 0.04 + r * 0.02,
      envelope: { attack: 0.001, decay: 0.18 + r * 0.08, sustain: 0, release: 0.1 },
    }).toDestination();
  }
  [0,4,8,12].forEach(i => { grid[0][i] = true; });
  [4,12].forEach(i => { grid[1][i] = true; });
  for (let i = 0; i < STEPS; i += 2) grid[2][i] = true;

  Tone.Transport.bpm.value = 120;
  seq = new Tone.Sequence((time, step) => {
    currentStep = step;
    for (let r = 0; r < ROWS; r++)
      if (grid[r][step]) synths[r].triggerAttackRelease(FREQS[r], '8n', time);
  }, [...Array(STEPS).keys()], '16n');
}

function draw() {
  background(20);
  let cw = (width - 100) / STEPS;
  let ch = (height - 60) / ROWS;

  for (let r = 0; r < ROWS; r++) {
    fill(COLORS[r]); noStroke(); textSize(10); textAlign(RIGHT);
    text(NAMES[r], 94, 30 + r * ch + ch / 2 + 4);

    for (let s = 0; s < STEPS; s++) {
      let x = 100 + s * cw, y = 30 + r * ch;
      let on = grid[r][s], cur = started && s === currentStep;
      if (on && cur) fill(COLORS[r]);
      else if (on) fill(lerpColor(color(COLORS[r]), color(20), 0.45));
      else if (cur) fill(70);
      else fill(s % 4 === 0 ? 44 : 32);
      noStroke(); rect(x + 1, y + 3, cw - 3, ch - 6, 3);
    }
  }

  let bx = width / 2 - 44, by = height - 34;
  fill(started ? '#e74c3c' : '#2ecc71'); noStroke();
  rect(bx, by, 88, 28, 7);
  fill(255); textSize(12); textAlign(CENTER);
  text(started ? '■ STOP' : '▶ PLAY', width / 2, by + 18);

  textAlign(LEFT); fill(150); textSize(11);
  text('BPM: ' + Tone.Transport.bpm.value, 10, 20);
}

async function mousePressed() {
  await Tone.start();
  let bx = width / 2 - 44, by = height - 34;
  if (mouseX > bx && mouseX < bx + 88 && mouseY > by && mouseY < by + 28) {
    if (started) { seq.stop(); Tone.Transport.stop(); started = false; }
    else { seq.start(0); Tone.Transport.start(); started = true; }
    return;
  }
  let cw = (width - 100) / STEPS;
  let ch = (height - 60) / ROWS;
  let s = floor((mouseX - 100) / cw);
  let r = floor((mouseY - 30) / ch);
  if (s >= 0 && s < STEPS && r >= 0 && r < ROWS) grid[r][s] = !grid[r][s];
}`,
      },
    ],
  },

  // ─── p5.sound ──────────────────────────────────────────────────────────────
  {
    id: 'p5sound',
    name: 'p5.sound',
    description: 'Analisi audio real-time: FFT, waveform, microfono e visualizzazioni sonore',
    icon: '🎤',
    category: 'audio',
    cdnUrls: ['https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.9.3/addons/p5.sound.min.js'],
    requiresCamera: false,
    templates: [
      {
        id: 'p5sound-fft',
        name: 'Visualizzatore FFT microfono',
        description: 'Spettro frequenze e waveform dal microfono in tempo reale',
        code: `// p5.sound — Visualizzatore FFT
// Click per avviare il microfono

let mic, fft;
let started = false;

function setup() {
  createCanvas(640, 400);
  colorMode(HSB);
  textFont('monospace');
}

async function mousePressed() {
  if (started) return;
  await getAudioContext().resume();
  mic = new p5.AudioIn();
  mic.start();
  fft = new p5.FFT(0.85, 256);
  fft.setInput(mic);
  started = true;
}

function draw() {
  background(240, 0.05, 0.06);

  if (!started) {
    fill(0, 0, 0.7); noStroke(); textSize(16); textAlign(CENTER);
    text('Click per attivare il microfono', width / 2, height / 2);
    textAlign(LEFT);
    return;
  }

  let spectrum = fft.analyze();
  let waveform = fft.waveform();

  // Spettro frequenze
  noStroke();
  for (let i = 0; i < spectrum.length; i++) {
    let x = map(i, 0, spectrum.length, 0, width);
    let h = map(spectrum[i], 0, 255, 0, height * 0.7);
    let hue = map(i, 0, spectrum.length, 200, 360);
    fill(hue % 360, 0.85, 0.95, 0.8);
    rect(x, height - h, width / spectrum.length - 0.5, h);
  }

  // Waveform
  stroke(60, 0.9, 1); strokeWeight(2); noFill();
  beginShape();
  for (let i = 0; i < waveform.length; i++)
    vertex(map(i, 0, waveform.length, 0, width), map(waveform[i], -1, 1, height * 0.1, height * 0.9));
  endShape();

  let vol = mic.getLevel();
  fill(0, 0, 0, 0.6); noStroke(); rect(8, 8, 185, 22, 4);
  fill(0, 0, 1); textSize(11); textAlign(LEFT);
  text('Volume: ' + nf(vol, 1, 3), 14, 23);
}`,
      },
    ],
  },
]
