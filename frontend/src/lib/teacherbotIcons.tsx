import {
  GraduationCap, BookOpen, Calculator, FlaskConical, Microscope, Atom, Dna, Globe, Landmark,
  Languages, ScrollText, PenTool, Palette, Music, Camera, Film, Code2, Cpu, Database, Brain,
  Lightbulb, Rocket, Star, Heart, Trophy, Target, Compass, Map, Mountain, TreePine, Leaf, Sun,
  Moon, Sparkles, Wand2, Bot, Users, MessageCircle, HelpCircle, Library, Ruler, Puzzle, Gamepad2,
  BarChart3, PieChart, Presentation, ClipboardList, Award, Feather, Newspaper, Headphones, Mic,
  Paintbrush, Shapes, Infinity as InfinityIcon, Sigma, Binary, Theater, Drama,
  type LucideIcon,
} from 'lucide-react'

/** Curated set of lucide-react icons offered as custom teacherbot avatars — already-installed,
 * single-stroke icons that render legibly in either black (light background) or white (dark/
 * colored background) since they inherit `currentColor`. */
export const TEACHERBOT_ICON_LIBRARY: { key: string; Icon: LucideIcon; label: string }[] = [
  { key: 'graduation-cap', Icon: GraduationCap, label: 'Laurea' },
  { key: 'book-open', Icon: BookOpen, label: 'Libro' },
  { key: 'library', Icon: Library, label: 'Biblioteca' },
  { key: 'calculator', Icon: Calculator, label: 'Calcolatrice' },
  { key: 'sigma', Icon: Sigma, label: 'Somma' },
  { key: 'infinity', Icon: InfinityIcon, label: 'Infinito' },
  { key: 'binary', Icon: Binary, label: 'Binario' },
  { key: 'ruler', Icon: Ruler, label: 'Righello' },
  { key: 'flask-conical', Icon: FlaskConical, label: 'Provetta' },
  { key: 'microscope', Icon: Microscope, label: 'Microscopio' },
  { key: 'atom', Icon: Atom, label: 'Atomo' },
  { key: 'dna', Icon: Dna, label: 'DNA' },
  { key: 'globe', Icon: Globe, label: 'Globo' },
  { key: 'landmark', Icon: Landmark, label: 'Storia' },
  { key: 'languages', Icon: Languages, label: 'Lingue' },
  { key: 'scroll-text', Icon: ScrollText, label: 'Testo' },
  { key: 'feather', Icon: Feather, label: 'Scrittura' },
  { key: 'newspaper', Icon: Newspaper, label: 'Giornale' },
  { key: 'pen-tool', Icon: PenTool, label: 'Disegno' },
  { key: 'palette', Icon: Palette, label: 'Palette' },
  { key: 'paintbrush', Icon: Paintbrush, label: 'Pennello' },
  { key: 'shapes', Icon: Shapes, label: 'Forme' },
  { key: 'theater', Icon: Theater, label: 'Teatro' },
  { key: 'drama', Icon: Drama, label: 'Recitazione' },
  { key: 'music', Icon: Music, label: 'Musica' },
  { key: 'headphones', Icon: Headphones, label: 'Audio' },
  { key: 'mic', Icon: Mic, label: 'Microfono' },
  { key: 'camera', Icon: Camera, label: 'Fotografia' },
  { key: 'film', Icon: Film, label: 'Video' },
  { key: 'code-2', Icon: Code2, label: 'Codice' },
  { key: 'cpu', Icon: Cpu, label: 'Tecnologia' },
  { key: 'database', Icon: Database, label: 'Dati' },
  { key: 'bar-chart', Icon: BarChart3, label: 'Grafico a barre' },
  { key: 'pie-chart', Icon: PieChart, label: 'Grafico a torta' },
  { key: 'presentation', Icon: Presentation, label: 'Presentazione' },
  { key: 'clipboard-list', Icon: ClipboardList, label: 'Lista' },
  { key: 'brain', Icon: Brain, label: 'Cervello' },
  { key: 'lightbulb', Icon: Lightbulb, label: 'Idea' },
  { key: 'sparkles', Icon: Sparkles, label: 'Scintille' },
  { key: 'wand', Icon: Wand2, label: 'Bacchetta' },
  { key: 'bot', Icon: Bot, label: 'Robot' },
  { key: 'rocket', Icon: Rocket, label: 'Razzo' },
  { key: 'target', Icon: Target, label: 'Obiettivo' },
  { key: 'trophy', Icon: Trophy, label: 'Trofeo' },
  { key: 'award', Icon: Award, label: 'Premio' },
  { key: 'star', Icon: Star, label: 'Stella' },
  { key: 'heart', Icon: Heart, label: 'Cuore' },
  { key: 'compass', Icon: Compass, label: 'Bussola' },
  { key: 'map', Icon: Map, label: 'Mappa' },
  { key: 'mountain', Icon: Mountain, label: 'Montagna' },
  { key: 'tree-pine', Icon: TreePine, label: 'Albero' },
  { key: 'leaf', Icon: Leaf, label: 'Foglia' },
  { key: 'sun', Icon: Sun, label: 'Sole' },
  { key: 'moon', Icon: Moon, label: 'Luna' },
  { key: 'puzzle', Icon: Puzzle, label: 'Puzzle' },
  { key: 'gamepad', Icon: Gamepad2, label: 'Gioco' },
  { key: 'users', Icon: Users, label: 'Gruppo' },
  { key: 'message-circle', Icon: MessageCircle, label: 'Chat' },
  { key: 'help-circle', Icon: HelpCircle, label: 'Aiuto' },
]

/** Curated Unicode emoji set — no asset dependency, renders via the OS/browser emoji font. */
export const TEACHERBOT_EMOJI_LIBRARY: string[] = [
  '🎓', '📚', '📖', '📝', '✏️', '🧮', '🔬', '🧪', '🧬', '🌍',
  '🗺️', '🏛️', '🎨', '🖌️', '🎭', '🎵', '🎸', '🎹', '📷', '🎬',
  '💻', '🤖', '🧠', '💡', '🚀', '⭐', '🏆', '🎯', '🧩', '🎮',
  '📐', '📏', '🔢', '♾️', '🌱', '🌳', '☀️', '🌙', '💬', '❓',
  '✅', '📌', '🎉', '🦉', '📅', '🌟', '🔍', '📊',
]

export type TeacherbotIconValue =
  | { kind: 'auto' }
  | { kind: 'lucide'; key: string; Icon: LucideIcon }
  | { kind: 'emoji'; emoji: string }

const LUCIDE_PREFIX = 'lucide:'
const EMOJI_PREFIX = 'emoji:'

export function encodeLucideIcon(key: string): string {
  return `${LUCIDE_PREFIX}${key}`
}

export function encodeEmojiIcon(emoji: string): string {
  return `${EMOJI_PREFIX}${emoji}`
}

/** Parses the teacherbot.icon string (e.g. "lucide:flask-conical", "emoji:🔬", or the legacy
 * default "bot") into a renderable value. Falls back to "auto" (subject-keyword detection done
 * by the caller) for anything unrecognized. */
export function resolveTeacherbotIcon(iconValue: string | null | undefined): TeacherbotIconValue {
  if (iconValue?.startsWith(LUCIDE_PREFIX)) {
    const key = iconValue.slice(LUCIDE_PREFIX.length)
    const entry = TEACHERBOT_ICON_LIBRARY.find((e) => e.key === key)
    if (entry) return { kind: 'lucide', key: entry.key, Icon: entry.Icon }
  }
  if (iconValue?.startsWith(EMOJI_PREFIX)) {
    const emoji = iconValue.slice(EMOJI_PREFIX.length)
    if (emoji) return { kind: 'emoji', emoji }
  }
  return { kind: 'auto' }
}
