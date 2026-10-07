/**
 * The platform's single icon module. Every icon in the app is imported from here, never from an icon package.
 *
 * Icons are Phosphor (https://phosphoricons.com, MIT), exported under the names the code base already used
 * (the former lucide-react names), so call sites did not change. The glyphs are generated in one weight by
 * scripts/generate-icons.mjs from icon-map.json: to restyle every icon, run `npm run icons -- --weight <weight>`.
 */
import '@flaticon/flaticon-uicons/css/solid/rounded.css'
export * from './icons.generated'
export type { IconProps as LucideProps, AppIcon as LucideIcon } from './createIcon'
