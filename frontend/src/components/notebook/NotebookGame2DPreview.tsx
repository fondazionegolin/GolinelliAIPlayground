import { AlertCircle, Gamepad2 } from 'lucide-react'

interface Props {
  source: string
  livePreview: boolean
  previewNonce: number
  runtimeError: string | null
  onRuntimeMessage: (message: string | null) => void
  onIframeLoad?: (win: Window | null) => void
}

const PHASER_CDN = 'https://cdn.jsdelivr.net/npm/phaser@3.80.1/dist/phaser.min.js'

function buildPreviewDoc(source: string) {
  const sourceLiteral = JSON.stringify(source).replace(/</g, '\\u003c')

  return `<!doctype html>
<html lang="it">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      html, body {
        margin: 0;
        width: 100%;
        height: 100%;
        overflow: hidden;
        background: #020617;
        color: #e2e8f0;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      #game {
        width: 100vw;
        height: 100vh;
        display: grid;
        place-items: center;
      }
      canvas {
        max-width: 100%;
        max-height: 100%;
        object-fit: contain;
        box-shadow: 0 24px 80px rgba(0, 0, 0, 0.35);
      }
      .boot {
        padding: 1rem;
        color: #94a3b8;
        font-size: 0.875rem;
      }
    </style>
  </head>
  <body>
    <div id="game"><div class="boot">Caricamento Phaser...</div></div>
    <script>
      const SOURCE = ${sourceLiteral};
      const notifyParent = (type, payload) => {
        window.parent.postMessage({ source: 'game2d-preview', type, payload }, '*');
      };
      window.onerror = function(message, source, lineno, colno) {
        notifyParent('runtime-error', String(message) + ' (' + lineno + ':' + colno + ')');
      };
      const originalError = console.error.bind(console);
      console.error = function(...args) {
        originalError(...args);
        notifyParent('runtime-error', args.map((item) => String(item)).join(' '));
      };
      window.addEventListener('message', function(event) {
        if (!event.data || event.data.source !== 'game2d-control') return;
        if (event.data.action === 'stop' && window.__game) {
          window.__game.scene.pause('RunnerScene');
          notifyParent('status', { playing: false });
        }
        if (event.data.action === 'play' && window.__game) {
          window.__game.scene.resume('RunnerScene');
          notifyParent('status', { playing: true });
        }
      });
    </script>
    <script src="${PHASER_CDN}"></script>
    <script>
      (function boot() {
        if (!window.Phaser) {
          notifyParent('runtime-error', 'Phaser non disponibile. Controlla la connessione al CDN.');
          return;
        }

        let spec;
        try {
          spec = JSON.parse(SOURCE || '{}');
        } catch (error) {
          notifyParent('runtime-error', 'JSON non valido: ' + (error && error.message ? error.message : String(error)));
          return;
        }

        const asNumber = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
        const hexColor = (value, fallback) => {
          const raw = String(value || fallback || '#ffffff').replace('#', '');
          const parsed = parseInt(raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw, 16);
          return Number.isFinite(parsed) ? parsed : parseInt(String(fallback || '#ffffff').replace('#', ''), 16);
        };
        const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

        class RunnerScene extends Phaser.Scene {
          constructor() {
            super('RunnerScene');
            this.score = 0;
            this.totalCollectibles = Array.isArray(spec.collectibles) ? spec.collectibles.length : 0;
            this.finished = false;
          }

          create() {
            const world = spec.world || {};
            const width = asNumber(world.width, 960);
            const height = asNumber(world.height, 540);
            this.physics.world.setBounds(0, 0, width, height);
            this.cameras.main.setBounds(0, 0, width, height);
            this.cameras.main.setBackgroundColor(world.background || '#0f172a');

            this.platforms = this.physics.add.staticGroup();
            this.hazards = this.physics.add.staticGroup();
            this.enemies = this.physics.add.group({ allowGravity: false, immovable: true });
            this.collectibles = this.physics.add.staticGroup();
            this.goalGroup = this.physics.add.staticGroup();
            this.patrols = [];

            const playerSpec = spec.player || {};
            this.spawnX = asNumber(playerSpec.x, 80);
            this.spawnY = asNumber(playerSpec.y, height - 90);
            this.playerSpeed = asNumber(playerSpec.speed, 260);
            this.playerJump = asNumber(playerSpec.jump, 470);
            this.player = this.add.rectangle(
              this.spawnX,
              this.spawnY,
              asNumber(playerSpec.width, 32),
              asNumber(playerSpec.height, 42),
              hexColor(playerSpec.color, '#38bdf8'),
            );
            this.physics.add.existing(this.player);
            this.player.body.setCollideWorldBounds(true);
            this.player.body.setDragX(1200);

            const entities = Array.isArray(spec.entities) ? spec.entities : [];
            for (const entity of entities) {
              const kind = entity.type || 'platform';
              const rect = this.add.rectangle(
                asNumber(entity.x, width / 2),
                asNumber(entity.y, height / 2),
                asNumber(entity.width, 80),
                asNumber(entity.height, 24),
                hexColor(entity.color, kind === 'hazard' ? '#ef4444' : kind === 'enemy' ? '#fb7185' : '#475569'),
              );

              if (kind === 'hazard') {
                this.physics.add.existing(rect, true);
                this.hazards.add(rect);
              } else if (kind === 'enemy') {
                this.physics.add.existing(rect);
                rect.body.setAllowGravity(false);
                rect.body.setImmovable(true);
                this.enemies.add(rect);
                const behavior = entity.behavior || {};
                if (behavior.kind === 'patrol') {
                  const axis = behavior.axis === 'y' ? 'y' : 'x';
                  const speed = asNumber(behavior.speed, 80);
                  const distance = asNumber(behavior.distance, 120);
                  this.patrols.push({ body: rect.body, axis, speed, origin: axis === 'x' ? rect.x : rect.y, distance });
                  if (axis === 'x') rect.body.setVelocityX(speed);
                  else rect.body.setVelocityY(speed);
                }
              } else {
                this.physics.add.existing(rect, true);
                this.platforms.add(rect);
              }
            }

            const collectibles = Array.isArray(spec.collectibles) ? spec.collectibles : [];
            for (const item of collectibles) {
              const star = this.add.circle(
                asNumber(item.x, width / 2),
                asNumber(item.y, height / 2),
                asNumber(item.radius, 10),
                hexColor(item.color, '#fde047'),
              );
              star.setStrokeStyle(2, 0xffffff, 0.55);
              this.physics.add.existing(star, true);
              this.collectibles.add(star);
            }

            if (spec.goal) {
              const goal = this.add.rectangle(
                asNumber(spec.goal.x, width - 70),
                asNumber(spec.goal.y, height - 90),
                asNumber(spec.goal.width, 36),
                asNumber(spec.goal.height, 72),
                hexColor(spec.goal.color, '#facc15'),
              );
              goal.setStrokeStyle(3, 0xffffff, 0.55);
              this.physics.add.existing(goal, true);
              this.goalGroup.add(goal);
            }

            this.physics.add.collider(this.player, this.platforms);
            this.physics.add.collider(this.enemies, this.platforms);
            this.physics.add.overlap(this.player, this.hazards, () => this.resetPlayer(), null, this);
            this.physics.add.overlap(this.player, this.enemies, () => this.resetPlayer(), null, this);
            this.physics.add.overlap(this.player, this.collectibles, this.collect, null, this);
            this.physics.add.overlap(this.player, this.goalGroup, this.reachGoal, null, this);

            this.cursors = this.input.keyboard.createCursorKeys();
            this.keys = this.input.keyboard.addKeys('W,A,S,D');
            this.hud = this.add.text(16, 14, '', {
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: '14px',
              color: '#e2e8f0',
              backgroundColor: 'rgba(15, 23, 42, 0.72)',
              padding: { x: 10, y: 6 },
            }).setScrollFactor(0);
            this.message = this.add.text(width / 2, 86, '', {
              fontFamily: 'ui-sans-serif, system-ui, sans-serif',
              fontSize: '20px',
              fontStyle: '700',
              color: '#ffffff',
              backgroundColor: 'rgba(15, 23, 42, 0.78)',
              padding: { x: 14, y: 8 },
            }).setOrigin(0.5).setScrollFactor(0).setVisible(false);
            this.cameras.main.startFollow(this.player, true, 0.08, 0.08);
            this.cameras.main.setZoom(clamp(asNumber(world.zoom, 1), 0.7, 1.8));
            this.updateHud();
            notifyParent('ready', null);
          }

          update() {
            if (!this.player || this.finished) return;
            const left = this.cursors.left.isDown || this.keys.A.isDown;
            const right = this.cursors.right.isDown || this.keys.D.isDown;
            const jump = this.cursors.up.isDown || this.cursors.space.isDown || this.keys.W.isDown;

            if (left) this.player.body.setVelocityX(-this.playerSpeed);
            else if (right) this.player.body.setVelocityX(this.playerSpeed);
            else this.player.body.setVelocityX(0);

            if (jump && this.player.body.blocked.down) {
              this.player.body.setVelocityY(-this.playerJump);
            }

            for (const patrol of this.patrols) {
              const pos = patrol.axis === 'x' ? patrol.body.x : patrol.body.y;
              if (Math.abs(pos - patrol.origin) >= patrol.distance) {
                if (patrol.axis === 'x') patrol.body.setVelocityX(-patrol.body.velocity.x || -patrol.speed);
                else patrol.body.setVelocityY(-patrol.body.velocity.y || -patrol.speed);
              }
            }

            if (this.player.y > this.physics.world.bounds.height + 80) {
              this.resetPlayer();
            }
          }

          collect(player, collectible) {
            collectible.destroy();
            this.score += 1;
            this.updateHud();
          }

          reachGoal() {
            if (this.score < this.totalCollectibles) {
              this.flashMessage('Raccogli prima tutti gli oggetti.');
              return;
            }
            this.finished = true;
            this.player.body.setVelocity(0, 0);
            this.flashMessage('Livello completato.');
            notifyParent('status', { playing: false, completed: true });
          }

          resetPlayer() {
            this.player.body.setVelocity(0, 0);
            this.player.setPosition(this.spawnX, this.spawnY);
            this.flashMessage('Reset posizione.');
          }

          flashMessage(text) {
            this.message.setText(text);
            this.message.setVisible(true);
            this.time.delayedCall(1300, () => this.message.setVisible(false));
          }

          updateHud() {
            const title = (spec.metadata && spec.metadata.title) || 'Game 2D';
            const objective = (spec.ui && spec.ui.objective) || 'Frecce/WASD per muoverti.';
            this.hud.setText(title + '\\n' + objective + '\\nOggetti: ' + this.score + '/' + this.totalCollectibles);
          }
        }

        try {
          const world = spec.world || {};
          const width = asNumber(world.width, 960);
          const height = asNumber(world.height, 540);
          window.__game = new Phaser.Game({
            type: Phaser.AUTO,
            parent: 'game',
            width,
            height,
            backgroundColor: world.background || '#0f172a',
            physics: {
              default: 'arcade',
              arcade: {
                gravity: { y: asNumber(world.gravity, 900) },
                debug: !!world.debug,
              },
            },
            scene: RunnerScene,
            scale: {
              mode: Phaser.Scale.FIT,
              autoCenter: Phaser.Scale.CENTER_BOTH,
            },
          });
        } catch (error) {
          notifyParent('runtime-error', error && error.message ? error.message : String(error));
        }
      })();
    </script>
  </body>
</html>`
}

export default function NotebookGame2DPreview({
  source,
  livePreview,
  previewNonce,
  runtimeError,
  onRuntimeMessage,
  onIframeLoad,
}: Props) {
  return (
    <div className="h-full min-h-[360px] overflow-hidden rounded-none border-0 bg-slate-950">
      <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-slate-800 bg-slate-900 px-4 py-2">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold text-slate-100">
            <Gamepad2 className="h-4 w-4 text-cyan-300" />
            Game Runner Phaser
          </p>
          <p className="text-[11px] text-slate-400">
            {livePreview ? 'Schema JSON con aggiornamento live' : 'Schema JSON con aggiornamento manuale'}
          </p>
        </div>
      </div>
      <div className="relative h-[calc(100%-49px)]">
        <iframe
          key={previewNonce}
          title="Anteprima Game 2D"
          srcDoc={buildPreviewDoc(source)}
          sandbox="allow-scripts"
          className="h-full w-full border-0 bg-slate-950"
          onLoad={(event) => {
            onRuntimeMessage(null)
            onIframeLoad?.((event.target as HTMLIFrameElement).contentWindow)
          }}
        />
        {runtimeError && (
          <div className="absolute inset-x-4 bottom-4 rounded-xl border border-red-500/30 bg-red-950/85 px-4 py-3 text-sm text-red-100 backdrop-blur">
            <div className="mb-1 flex items-center gap-2 text-red-200">
              <AlertCircle className="h-4 w-4" />
              Errore nel runner Game 2D
            </div>
            <p className="font-mono text-xs leading-relaxed text-red-50">{runtimeError}</p>
          </div>
        )}
      </div>
    </div>
  )
}
