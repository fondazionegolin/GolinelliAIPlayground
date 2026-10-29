import {
  GraduationCap, BookOpen, Calculator, FlaskConical, Microscope, Atom, Dna, Globe, Landmark,
  Languages, ScrollText, PenTool, Palette, Music, Camera, Film, Code2, Cpu, Database, Brain,
  Lightbulb, Rocket, Star, Heart, Trophy, Target, Compass, Map, Mountain, TreePine, Leaf, Sun,
  Moon, Sparkles, Wand2, Bot, Users, MessageCircle, HelpCircle, Library, Ruler, Puzzle, Gamepad2,
  BarChart3, PieChart, Presentation, ClipboardList, Award, Feather, Newspaper, Headphones, Mic,
  Paintbrush, Shapes, Infinity as InfinityIcon, Sigma, Binary, Theater, Drama,
  type LucideIcon,
} from '@/components/icons'
import { tl } from '@/i18n/tl'

/** Curated set of platform icons (@/components/icons) offered as custom teacherbot avatars — already-installed,
 * single-stroke icons that render legibly in either black (light background) or white (dark/
 * colored background) since they inherit `currentColor`. */
export const TEACHERBOT_ICON_LIBRARY: { key: string; Icon: LucideIcon; label: string }[] = [
  { key: 'graduation-cap', Icon: GraduationCap, label: tl("Laurea") },
  { key: 'book-open', Icon: BookOpen, label: tl("Libro") },
  { key: 'library', Icon: Library, label: tl("Biblioteca") },
  { key: 'calculator', Icon: Calculator, label: tl("Calcolatrice") },
  { key: 'sigma', Icon: Sigma, label: tl("Somma") },
  { key: 'infinity', Icon: InfinityIcon, label: tl("Infinito") },
  { key: 'binary', Icon: Binary, label: tl("Binario") },
  { key: 'ruler', Icon: Ruler, label: tl("Righello") },
  { key: 'flask-conical', Icon: FlaskConical, label: tl("Provetta") },
  { key: 'microscope', Icon: Microscope, label: tl("Microscopio") },
  { key: 'atom', Icon: Atom, label: tl("Atomo") },
  { key: 'dna', Icon: Dna, label: 'DNA' },
  { key: 'globe', Icon: Globe, label: tl("Globo") },
  { key: 'landmark', Icon: Landmark, label: tl("Storia") },
  { key: 'languages', Icon: Languages, label: tl("Lingue") },
  { key: 'scroll-text', Icon: ScrollText, label: 'Testo' },
  { key: 'feather', Icon: Feather, label: tl("Scrittura") },
  { key: 'newspaper', Icon: Newspaper, label: tl("Giornale") },
  { key: 'pen-tool', Icon: PenTool, label: tl("Disegno") },
  { key: 'palette', Icon: Palette, label: 'Palette' },
  { key: 'paintbrush', Icon: Paintbrush, label: tl("Pennello") },
  { key: 'shapes', Icon: Shapes, label: tl("Forme") },
  { key: 'theater', Icon: Theater, label: tl("Teatro") },
  { key: 'drama', Icon: Drama, label: tl("Recitazione") },
  { key: 'music', Icon: Music, label: tl("Musica") },
  { key: 'headphones', Icon: Headphones, label: 'Audio' },
  { key: 'mic', Icon: Mic, label: tl("Microfono") },
  { key: 'camera', Icon: Camera, label: tl("Fotografia") },
  { key: 'film', Icon: Film, label: 'Video' },
  { key: 'code-2', Icon: Code2, label: tl("Codice") },
  { key: 'cpu', Icon: Cpu, label: tl("Tecnologia") },
  { key: 'database', Icon: Database, label: tl("Dati") },
  { key: 'bar-chart', Icon: BarChart3, label: tl("Grafico a barre") },
  { key: 'pie-chart', Icon: PieChart, label: tl("Grafico a torta") },
  { key: 'presentation', Icon: Presentation, label: tl("Presentazione") },
  { key: 'clipboard-list', Icon: ClipboardList, label: tl("Lista") },
  { key: 'brain', Icon: Brain, label: tl("Cervello") },
  { key: 'lightbulb', Icon: Lightbulb, label: tl("Idea") },
  { key: 'sparkles', Icon: Sparkles, label: tl("Scintille") },
  { key: 'wand', Icon: Wand2, label: tl("Bacchetta") },
  { key: 'bot', Icon: Bot, label: 'Robot' },
  { key: 'rocket', Icon: Rocket, label: tl("Razzo") },
  { key: 'target', Icon: Target, label: tl("Obiettivo") },
  { key: 'trophy', Icon: Trophy, label: tl("Trofeo") },
  { key: 'award', Icon: Award, label: tl("Premio") },
  { key: 'star', Icon: Star, label: tl("Stella") },
  { key: 'heart', Icon: Heart, label: tl("Cuore") },
  { key: 'compass', Icon: Compass, label: tl("Bussola") },
  { key: 'map', Icon: Map, label: tl("Mappa") },
  { key: 'mountain', Icon: Mountain, label: tl("Montagna") },
  { key: 'tree-pine', Icon: TreePine, label: tl("Albero") },
  { key: 'leaf', Icon: Leaf, label: tl("Foglia") },
  { key: 'sun', Icon: Sun, label: tl("Sole") },
  { key: 'moon', Icon: Moon, label: tl("Luna") },
  { key: 'puzzle', Icon: Puzzle, label: 'Puzzle' },
  { key: 'gamepad', Icon: Gamepad2, label: tl("Gioco") },
  { key: 'users', Icon: Users, label: tl("Gruppo") },
  { key: 'message-circle', Icon: MessageCircle, label: tl("Chat") },
  { key: 'help-circle', Icon: HelpCircle, label: tl("Aiuto") },
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
