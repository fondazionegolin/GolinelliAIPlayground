import { createIcon } from './createIcon'

/** Compatibility names for lab shortcuts, using the shared Untitled UI collection. */
export { Bot as TuringFaceRobotIcon } from './icons.generated'

/** Plain pause bars for a transport button that already provides its circular surface. */
export const MediaPauseIcon = createIcon('MediaPause', '<rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none"/>')

// Distinct glyphs for the 3D and canvas modules (24×24 grid, same stroke language as the Untitled UI set).

/** Isometric cube: solid modeling (3D Lab). */
export const Cube3DIcon = createIcon('Cube3D', '<path d="M12 2.5 20.5 7v10L12 21.5 3.5 17V7z"/><path d="M3.5 7 12 11.5 20.5 7"/><path d="M12 11.5v10"/>')

/** A smaller cube with a spark: AI-generated 3D models. */
export const AiCubeIcon = createIcon('AiCube', '<path d="M10 8.6 16 11.8v6.8L10 21.8 4 18.6v-6.8z"/><path d="M4 11.8 10 15l6-3.2"/><path d="M10 15v6.8"/><path d="M18.5 2.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z"/>')

/** A canvas on an easel with a brush stroke: smart canvases. */
export const CanvasEaselIcon = createIcon('CanvasEasel', '<rect x="3.5" y="3" width="17" height="12" rx="2"/><path d="M7 11.5c1.3-3.2 2.7 0 4-2s2.4-1.6 3.4-.6c.8.8 1.6.5 2.2-.4"/><path d="M12 15v2.5"/><path d="M7.5 21.5 12 17.5l4.5 4"/>')

export { AiCubeIcon as MushroomIcon }
