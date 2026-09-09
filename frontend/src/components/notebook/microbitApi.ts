// Completamento di codice per l'API MicroPython della micro:bit (V2).
// Copre i nomi globali (moduli, oggetti, funzioni, costanti) e i membri
// dopo il punto (es. display.show, accelerometer.get_x), così l'editor offre
// suggerimenti precisi per la scheda.
import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete'

type Member = { label: string; type: Completion['type']; detail?: string; info?: string }

const fn = (label: string, detail?: string, info?: string): Member => ({ label, type: 'function', detail, info })
const prop = (label: string, detail?: string, info?: string): Member => ({ label, type: 'property', detail, info })
const constant = (label: string, detail?: string): Member => ({ label, type: 'constant', detail })

// ── Membri degli oggetti di bordo ────────────────────────────────────────────

const DISPLAY_MEMBERS: Member[] = [
  fn('show', 'show(image)', 'Mostra un\'immagine, una lettera o scorre un valore sul display 5x5.'),
  fn('scroll', 'scroll(text, delay=150)', 'Fa scorrere un testo o un numero sul display.'),
  fn('clear', 'clear()', 'Spegne tutti i LED del display.'),
  fn('set_pixel', 'set_pixel(x, y, value)', 'Imposta la luminosità (0-9) del LED in posizione x, y.'),
  fn('get_pixel', 'get_pixel(x, y)', 'Restituisce la luminosità (0-9) del LED in posizione x, y.'),
  fn('on', 'on()', 'Accende il display LED.'),
  fn('off', 'off()', 'Spegne il display LED (libera i pin per altri usi).'),
  fn('is_on', 'is_on()', 'True se il display è acceso.'),
  fn('read_light_level', 'read_light_level()', 'Legge il livello di luce ambientale (0-255) dai LED.'),
]

const BUTTON_MEMBERS: Member[] = [
  fn('is_pressed', 'is_pressed()', 'True se il pulsante è premuto in questo momento.'),
  fn('was_pressed', 'was_pressed()', 'True se il pulsante è stato premuto dall\'ultima chiamata.'),
  fn('get_presses', 'get_presses()', 'Numero di pressioni accumulate, poi azzera il contatore.'),
]

const ACCELEROMETER_MEMBERS: Member[] = [
  fn('get_x', 'get_x()', 'Accelerazione sull\'asse X in milli-g.'),
  fn('get_y', 'get_y()', 'Accelerazione sull\'asse Y in milli-g.'),
  fn('get_z', 'get_z()', 'Accelerazione sull\'asse Z in milli-g.'),
  fn('get_values', 'get_values()', 'Tupla (x, y, z) delle accelerazioni.'),
  fn('get_strength', 'get_strength()', 'Intensità complessiva dell\'accelerazione in milli-g.'),
  fn('current_gesture', 'current_gesture()', 'Nome del gesto attuale (es. "shake", "up").'),
  fn('is_gesture', 'is_gesture(name)', 'True se il gesto indicato è attivo ora.'),
  fn('was_gesture', 'was_gesture(name)', 'True se il gesto è avvenuto dall\'ultima chiamata.'),
  fn('get_gestures', 'get_gestures()', 'Storico dei gesti rilevati, poi lo azzera.'),
  fn('set_range', 'set_range(value)', 'Imposta il fondoscala dell\'accelerometro (2, 4 o 8 g).'),
]

const COMPASS_MEMBERS: Member[] = [
  fn('heading', 'heading()', 'Direzione della bussola in gradi (0-360). Richiede calibrazione.'),
  fn('calibrate', 'calibrate()', 'Avvia la calibrazione interattiva della bussola.'),
  fn('is_calibrated', 'is_calibrated()', 'True se la bussola è già calibrata.'),
  fn('clear_calibration', 'clear_calibration()', 'Cancella la calibrazione esistente.'),
  fn('get_x', 'get_x()', 'Campo magnetico sull\'asse X.'),
  fn('get_y', 'get_y()', 'Campo magnetico sull\'asse Y.'),
  fn('get_z', 'get_z()', 'Campo magnetico sull\'asse Z.'),
  fn('get_field_strength', 'get_field_strength()', 'Intensità del campo magnetico in nanotesla.'),
]

const MICROPHONE_MEMBERS: Member[] = [
  fn('sound_level', 'sound_level()', 'Livello sonoro corrente (0-255). Solo micro:bit V2.'),
  fn('current_event', 'current_event()', 'Ultimo evento sonoro (SoundEvent.LOUD/QUIET).'),
  fn('was_event', 'was_event(event)', 'True se l\'evento sonoro è avvenuto dall\'ultima chiamata.'),
  fn('is_event', 'is_event(event)', 'True se l\'evento sonoro è quello attuale.'),
  fn('get_events', 'get_events()', 'Storico degli eventi sonori.'),
  fn('set_threshold', 'set_threshold(event, value)', 'Imposta la soglia (0-255) per un evento sonoro.'),
]

const PIN_MEMBERS: Member[] = [
  fn('read_digital', 'read_digital()', 'Legge il valore digitale del pin (0 o 1).'),
  fn('write_digital', 'write_digital(value)', 'Scrive 0 o 1 sul pin.'),
  fn('read_analog', 'read_analog()', 'Legge un valore analogico (0-1023).'),
  fn('write_analog', 'write_analog(value)', 'Scrive un valore PWM (0-1023).'),
  fn('set_analog_period', 'set_analog_period(period)', 'Imposta il periodo PWM in millisecondi.'),
  fn('set_analog_period_microseconds', 'set_analog_period_microseconds(period)', 'Imposta il periodo PWM in microsecondi.'),
  fn('is_touched', 'is_touched()', 'True se il pin è toccato.'),
  fn('set_touch_mode', 'set_touch_mode(mode)', 'Imposta la modalità touch (RESISTIVE/CAPACITIVE).'),
  fn('set_pull', 'set_pull(mode)', 'Imposta la resistenza di pull (PULL_UP/PULL_DOWN/NO_PULL).'),
  fn('get_pull', 'get_pull()', 'Restituisce la modalità di pull corrente.'),
]

const IMAGE_ICONS = [
  'HEART', 'HEART_SMALL', 'HAPPY', 'SMILE', 'SAD', 'CONFUSED', 'ANGRY', 'ASLEEP',
  'SURPRISED', 'SILLY', 'FABULOUS', 'MEH', 'YES', 'NO',
  'CLOCK12', 'CLOCK11', 'CLOCK10', 'CLOCK9', 'CLOCK8', 'CLOCK7', 'CLOCK6',
  'CLOCK5', 'CLOCK4', 'CLOCK3', 'CLOCK2', 'CLOCK1',
  'ARROW_N', 'ARROW_NE', 'ARROW_E', 'ARROW_SE', 'ARROW_S', 'ARROW_SW', 'ARROW_W', 'ARROW_NW',
  'TRIANGLE', 'TRIANGLE_LEFT', 'CHESSBOARD', 'DIAMOND', 'DIAMOND_SMALL', 'SQUARE', 'SQUARE_SMALL',
  'RABBIT', 'COW', 'MUSIC_CROTCHET', 'MUSIC_QUAVER', 'MUSIC_QUAVERS', 'PITCHFORK', 'XMAS',
  'PACMAN', 'TARGET', 'TSHIRT', 'ROLLERSKATE', 'DUCK', 'HOUSE', 'TORTOISE', 'BUTTERFLY',
  'STICKFIGURE', 'GHOST', 'SWORD', 'GIRAFFE', 'SKULL', 'UMBRELLA', 'SNAKE',
]

const IMAGE_MEMBERS: Member[] = [
  ...IMAGE_ICONS.map((label) => constant(label, `Image.${label}`)),
  constant('ALL_CLOCKS', 'Lista di tutte le immagini CLOCK.'),
  constant('ALL_ARROWS', 'Lista di tutte le immagini ARROW.'),
  fn('width', 'width()', 'Larghezza dell\'immagine in pixel.'),
  fn('height', 'height()', 'Altezza dell\'immagine in pixel.'),
  fn('get_pixel', 'get_pixel(x, y)', 'Luminosità (0-9) del pixel.'),
  fn('set_pixel', 'set_pixel(x, y, value)', 'Imposta la luminosità del pixel.'),
  fn('shift_left', 'shift_left(n)', 'Restituisce l\'immagine spostata a sinistra di n colonne.'),
  fn('shift_right', 'shift_right(n)', 'Restituisce l\'immagine spostata a destra di n colonne.'),
  fn('shift_up', 'shift_up(n)', 'Restituisce l\'immagine spostata in alto di n righe.'),
  fn('shift_down', 'shift_down(n)', 'Restituisce l\'immagine spostata in basso di n righe.'),
  fn('crop', 'crop(x, y, w, h)', 'Ritaglia una porzione dell\'immagine.'),
  fn('copy', 'copy()', 'Restituisce una copia dell\'immagine.'),
  fn('invert', 'invert()', 'Restituisce l\'immagine con i pixel invertiti.'),
  fn('fill', 'fill(value)', 'Riempie tutti i pixel con la luminosità indicata.'),
  fn('blit', 'blit(src, x, y, w, h, xdest, ydest)', 'Copia una porzione di un\'altra immagine.'),
]

const MUSIC_MEMBERS: Member[] = [
  fn('play', 'play(music, pin=pin0, wait=True, loop=False)', 'Suona una melodia o un elenco di note.'),
  fn('pitch', 'pitch(frequency, duration=-1, pin=pin0, wait=True)', 'Suona una frequenza per una durata in ms.'),
  fn('stop', 'stop(pin=pin0)', 'Ferma la musica in riproduzione.'),
  fn('reset', 'reset()', 'Ripristina tempo, ottava e durata predefiniti.'),
  fn('set_tempo', 'set_tempo(ticks=4, bpm=120)', 'Imposta il tempo della musica.'),
  fn('get_tempo', 'get_tempo()', 'Restituisce (ticks, bpm) correnti.'),
  ...['DADADADUM', 'ENTERTAINER', 'PRELUDE', 'ODE', 'NYAN', 'RINGTONE', 'FUNK', 'BLUES',
    'BIRTHDAY', 'WEDDING', 'FUNERAL', 'PUNCHLINE', 'PYTHON', 'BADDY', 'CHASE', 'BA_DING',
    'WAWAWAWAA', 'JUMP_UP', 'JUMP_DOWN', 'POWER_UP', 'POWER_DOWN'].map((label) => constant(label, `music.${label}`)),
]

const RADIO_MEMBERS: Member[] = [
  fn('on', 'on()', 'Accende la radio.'),
  fn('off', 'off()', 'Spegne la radio per risparmiare energia.'),
  fn('config', 'config(**kwargs)', 'Configura group, channel, power, length della radio.'),
  fn('reset', 'reset()', 'Ripristina le impostazioni radio predefinite.'),
  fn('send', 'send(message)', 'Invia una stringa via radio.'),
  fn('send_bytes', 'send_bytes(message)', 'Invia byte grezzi via radio.'),
  fn('receive', 'receive()', 'Riceve la stringa più vecchia in coda, o None.'),
  fn('receive_bytes', 'receive_bytes()', 'Riceve i byte più vecchi in coda, o None.'),
  fn('receive_full', 'receive_full()', 'Riceve (bytes, rssi, timestamp) o None.'),
  constant('RATE_1MBIT', 'Velocità radio 1 Mbit.'),
  constant('RATE_2MBIT', 'Velocità radio 2 Mbit.'),
]

const SPEECH_MEMBERS: Member[] = [
  fn('say', 'say(words, speed=72, pitch=64, throat=128, mouth=128)', 'Pronuncia una frase in inglese.'),
  fn('pronounce', 'pronounce(phonemes, ...)', 'Pronuncia una sequenza di fonemi.'),
  fn('sing', 'sing(phonemes, ...)', 'Canta una sequenza di fonemi.'),
  fn('translate', 'translate(words)', 'Converte testo inglese in fonemi.'),
]

const UART_MEMBERS: Member[] = [
  fn('init', 'init(baudrate=9600, bits=8, parity=None, stop=1, tx=None, rx=None)', 'Inizializza la seriale UART.'),
  fn('any', 'any()', 'True se ci sono dati da leggere.'),
  fn('read', 'read(nbytes=None)', 'Legge byte dalla seriale.'),
  fn('readline', 'readline()', 'Legge una riga dalla seriale.'),
  fn('write', 'write(buf)', 'Scrive byte sulla seriale.'),
]

const LOG_MEMBERS: Member[] = [
  fn('set_labels', 'set_labels(*labels, timestamp=SECONDS)', 'Definisce le colonne del log dati.'),
  fn('add', 'add(data_dict)', 'Aggiunge una riga di dati al log.'),
  fn('set_mirroring', 'set_mirroring(serial)', 'Riflette il log dati anche sulla seriale.'),
  fn('delete', 'delete(full=False)', 'Cancella i dati registrati.'),
  constant('MILLISECONDS', 'Timestamp del log in millisecondi.'),
  constant('SECONDS', 'Timestamp del log in secondi.'),
  constant('MINUTES', 'Timestamp del log in minuti.'),
  constant('HOURS', 'Timestamp del log in ore.'),
  constant('DAYS', 'Timestamp del log in giorni.'),
]

const SOUND_MEMBERS: Member[] = ['GIGGLE', 'HAPPY', 'HELLO', 'MYSTERIOUS', 'SAD', 'SLIDE',
  'SOARING', 'SPRING', 'TWINKLE', 'YAWN'].map((label) => constant(label, `Sound.${label}`))

const SOUND_EVENT_MEMBERS: Member[] = [constant('LOUD', 'Evento sonoro forte.'), constant('QUIET', 'Evento sonoro silenzioso.')]

// Mappa nome oggetto → membri. I pin condividono lo stesso set.
const MEMBER_MAP: Record<string, Member[]> = {
  display: DISPLAY_MEMBERS,
  button_a: BUTTON_MEMBERS,
  button_b: BUTTON_MEMBERS,
  accelerometer: ACCELEROMETER_MEMBERS,
  compass: COMPASS_MEMBERS,
  microphone: MICROPHONE_MEMBERS,
  Image: IMAGE_MEMBERS,
  music: MUSIC_MEMBERS,
  radio: RADIO_MEMBERS,
  speech: SPEECH_MEMBERS,
  uart: UART_MEMBERS,
  log: LOG_MEMBERS,
  Sound: SOUND_MEMBERS,
  SoundEvent: SOUND_EVENT_MEMBERS,
}

for (let i = 0; i <= 20; i += 1) MEMBER_MAP[`pin${i}`] = PIN_MEMBERS
MEMBER_MAP.pin_logo = PIN_MEMBERS
MEMBER_MAP.pin_speaker = PIN_MEMBERS

function resolveMembers(object: string): Member[] | null {
  return MEMBER_MAP[object] ?? null
}

// ── Nomi globali ──────────────────────────────────────────────────────────────

const GLOBAL_COMPLETIONS: Completion[] = [
  // Funzioni del modulo microbit
  fn('sleep', 'sleep(ms)', 'Mette in pausa il programma per ms millisecondi.'),
  fn('running_time', 'running_time()', 'Millisecondi trascorsi dall\'accensione.'),
  fn('temperature', 'temperature()', 'Temperatura del processore in gradi Celsius.'),
  fn('panic', 'panic(n)', 'Entra in modalità panic mostrando un codice di errore.'),
  fn('reset', 'reset()', 'Riavvia la scheda.'),
  fn('set_volume', 'set_volume(value)', 'Imposta il volume (0-255). Solo micro:bit V2.'),
  fn('scale', 'scale(value, from_, to)', 'Riscala un valore da un intervallo a un altro.'),
  fn('print', 'print(*values)', 'Stampa sul monitor seriale.'),
  fn('range', 'range(stop)', 'Sequenza di numeri.'),
  fn('len', 'len(obj)', 'Lunghezza di una sequenza.'),
  fn('str', 'str(obj)', 'Converte in stringa.'),
  fn('int', 'int(obj)', 'Converte in intero.'),
  fn('abs', 'abs(x)', 'Valore assoluto.'),
  // Oggetti di bordo
  prop('display', 'display', 'Display LED 5x5 di bordo.'),
  prop('button_a', 'button_a', 'Pulsante A.'),
  prop('button_b', 'button_b', 'Pulsante B.'),
  prop('accelerometer', 'accelerometer', 'Accelerometro a 3 assi.'),
  prop('compass', 'compass', 'Bussola / magnetometro.'),
  prop('microphone', 'microphone', 'Microfono di bordo (micro:bit V2).'),
  prop('speaker', 'speaker', 'Altoparlante di bordo (micro:bit V2).'),
  prop('i2c', 'i2c', 'Bus I2C.'),
  prop('spi', 'spi', 'Bus SPI.'),
  prop('uart', 'uart', 'Seriale UART.'),
  prop('pin_logo', 'pin_logo', 'Pin touch del logo (micro:bit V2).'),
  prop('pin_speaker', 'pin_speaker', 'Pin dell\'altoparlante (micro:bit V2).'),
  // Classi / costanti
  { label: 'Image', type: 'class', detail: 'Image(string)', info: 'Immagine 5x5 per il display LED.' },
  { label: 'Sound', type: 'class', detail: 'Suoni predefiniti (micro:bit V2).' },
  { label: 'SoundEvent', type: 'class', detail: 'Eventi sonori del microfono.' },
  // Moduli importabili
  { label: 'microbit', type: 'namespace', detail: 'from microbit import *' },
  { label: 'music', type: 'namespace', detail: 'import music' },
  { label: 'radio', type: 'namespace', detail: 'import radio' },
  { label: 'neopixel', type: 'namespace', detail: 'import neopixel' },
  { label: 'speech', type: 'namespace', detail: 'import speech' },
  { label: 'machine', type: 'namespace', detail: 'import machine' },
  { label: 'audio', type: 'namespace', detail: 'import audio' },
  { label: 'log', type: 'namespace', detail: 'import log — registrazione dati (V2)' },
  { label: 'random', type: 'namespace', detail: 'import random' },
  { label: 'math', type: 'namespace', detail: 'import math' },
  { label: 'utime', type: 'namespace', detail: 'import utime' },
]

// Pin numerici pin0..pin20 come proprietà.
for (let i = 0; i <= 20; i += 1) {
  GLOBAL_COMPLETIONS.push(prop(`pin${i}`, `pin${i}`, `Pin GPIO ${i}.`))
}

// ── Sorgente di completamento per CodeMirror ──────────────────────────────────

export function microbitApiCompletions(context: CompletionContext): CompletionResult | null {
  // Accesso a un membro: cattura "oggetto.parziale".
  const dotted = context.matchBefore(/[A-Za-z_]\w*\.\w*$/)
  if (dotted) {
    const dot = dotted.text.lastIndexOf('.')
    const object = dotted.text.slice(0, dot)
    const members = resolveMembers(object)
    if (members) {
      return {
        from: dotted.from + dot + 1,
        options: members,
        validFor: /^\w*$/,
      }
    }
    // Oggetto non riconosciuto: lascia decidere agli altri completamenti.
    return null
  }

  const word = context.matchBefore(/[A-Za-z_]\w*$/)
  if (!word || (word.from === word.to && !context.explicit)) return null

  return {
    from: word.from,
    options: GLOBAL_COMPLETIONS,
    validFor: /^\w*$/,
  }
}
