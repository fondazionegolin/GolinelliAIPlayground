# Design System

This folder is the single source of truth for product UI.

## Approved product styling

The following choices were explicitly approved by the product owner. Preserve them for future UI work; change these shared tokens and components only when the owner requests a different style.

| Element | Approved treatment | Implementation |
| --- | --- | --- |
| Input, textarea, native select and searchable select | Flat, opaque, slightly cool grey; rounded corners; no border, outline or inset shadow at rest. Strong neutral text and readable grey placeholders. No pink, violet or yellow field fill. | `Input`, `Textarea`, `Select`, `SearchableSelect`; `ds-field` and `--ds-field-*` in `foundation.css` / `index.css`. Current resting fill: light `#f1f3f5`, dark `#191b1e`; radius `18px`. |
| Buttons | Preserve the existing rounded material/pill shapes, spacing and shared variants. Do not add local gradients, borders, pressed edges, inset underlines or custom shadows. | `Button` / `IconButton` from `@/design`; shared `--button-*` and `--selection-*` tokens. |
| Switches and segmented selectors | Match the navbar: a shared rounded group and a flat selected item. Selected items have no added lower edge or pressed shadow. | `buildAccentNavClusterStyle()` for the group; neutral ghost `Button`s and `ds-selected` for the active item. Preserve keyboard focus and `aria-pressed` / `aria-current`. |
| Dropdowns and menus | Match the same flat rounded control. Popup surfaces are opaque, readable, rounded and use only the shared popup shadow. | Native `Select` or searchable `SearchableSelect`; `ds-popover` and `--ds-popover-solid`. Preserve search, keyboard navigation, focus and selection semantics. |
| Sliders (`input[type=range]`) | Flat and ethereal: 4px translucent violet track, translucent filled part, small flat round thumb; no border, outline or shadow. | Global rule at the end of `index.css`; native inputs inherit it, opt out with `data-field-appearance="plain"`. |
| Secondary text | Muted violet in light mode and light rose-violet in dark mode, replacing the old celeste. The rose-violet is text ink, never a field background or border. | `--text-secondary`; use `--text-primary` for titles, labels and main content, and `--ds-field-ink` for input values. |
| Page identity | An illustration to the left of the combined title and subtitle, using the same artwork as the navigation. Apply this also to detail/editor headers. | `SectionHeading`, or `SectionIllustration` beside an editable title; source of truth: `components/NavSectionArt.tsx`. |

Authored document, slide, canvas and code content keeps its own colors. UI changes must remain legible in both themes and at mobile widths. Focus and validation feedback remain meaningful exceptions to the resting borderless appearance.

## Section illustrations

Use the existing section asset instead of adding another header icon or generating a replacement illustration:

```tsx
import { SectionHeading, SectionIllustration } from '@/design'

<SectionHeading section="/teacher/audio-lab" className="text-2xl font-bold">
  Audio Lab
</SectionHeading>

// Compact editor or a title that is an input rather than a heading:
<SectionIllustration section="/teacher/documents" compact />
```

`SectionHeading` preserves the heading text and supports `as="h2"`, `compact`, and `titleClassName` for truncation. Page artwork is 72px on mobile and 80px on desktop, about the height of title and subtitle together. Pass `subtitle` and `subtitleClassName` to keep both lines beside the illustration. Compact two-line headers use 56px; single-line editor marks use 40px. The image is decorative (`alt=""`, hidden from assistive technology), has reserved dimensions, keeps its aspect ratio, and has no colored tile, frame or shadow. Reuse the parent section's artwork in editors and detail views. Avoid adding it to every card or subsection inside a page.

## Audio playback

The navbar widget is the single persistent audio player for authenticated teachers and students. Double-clicking an audio file in Files or pressing play in Audio Lab, a chat attachment or a podcast starts that same player and opens its popup. Use `useBackgroundAudio().playFile(...)`, `playTracks(...)` or `listen(...)`; feature components must not mount another audio element for ordinary listening. Video editing, voice recording and live calls keep their own transport.

Keep the popup compact and focused on listening: current track, play/pause, previous/next when there is a queue, local mute and progress. Selecting «Riproduci un brano» or «Carica una playlist» starts playback immediately. Playlist names, saving, reordering, sharing and class broadcast configuration belong in the dedicated playlist section, not the navbar popup. Playback continues after closing the popup or changing page.

## Rules

- The visual language is flat and lightly glossy: opaque or barely transparent surfaces, one subtle top reflection, and shadows for separation.
- Decorative outlines are not part of the system. Do not add local `border-*` or `ring-*` classes to controls, cards, navigation, or popovers.
- Use the shared CSS surfaces (`ds-control`, `ds-selected`, `ds-panel`, `ds-popover`, `ds-navbar`) and `--ds-*` tokens. Borders remain valid only when they communicate meaning, such as validation, accessible focus, or a drop target.
- Editable controls use `ds-field` and the shared `--ds-field-*` tokens: light cool-grey backgrounds, rounded corners and no resting borders or inset shadows, with readable neutral input text, grey placeholders and visible focus in both themes. Rose-violet is reserved for secondary text, never field surfaces. Do not replace a field background with a card surface or remove its focus indicator. Legacy native fields inherit the same treatment; editor internals and `data-field-appearance="plain"` are excluded.
- Secondary UI text uses muted violet in light mode and rose-violet in dark mode. Dark-mode legacy `text-blue-*`, `text-sky-*` and `text-cyan-*` classes follow that ink palette; logo fills and authored document colors keep their palette.
- Product pages use `ui-card`, `ui-card-interactive`, `ui-search`, `ui-cta`, and `ui-segment`. These utilities keep legacy feature screens aligned while they migrate to the React primitives.
- Do not use backdrop blur for ordinary chrome. Transparency must remain slight enough to preserve contrast without glassmorphism.
- Use primitives exported from `@/design` for buttons, cards, inputs, badges, dialogs, tabs, and spinners.
- Do not copy primary button styles into feature components. Use `<Button tone="accent" surface="solid">`.
- Do not introduce new dominant UI colors in feature screens. Use the logo palette:
  - `--logo-pink`
  - `--logo-blue`
  - `--logo-violet`
- Preserve the current shared button and selection variants. Logo colors can identify branding or meaningful status; do not introduce new colored control fills.
- Use transparent logo surfaces for cards, tiles, modules, and passive information.
- Change component shape, spacing, shadow, and primary action look through `frontend/src/index.css` component tokens first:
  - `--button-*`
  - `--selection-*`
  - `--control-radius`
  - `--card-radius`
  - `--surface-*`
- TypeScript tokens are exported from `@/design`, including `brandTokens`, for non-CSS use cases.

## Primary Button

The standard primary button is controlled by `Button`:

```tsx
import { Button } from '@/design'

<Button tone="accent" surface="solid">+ Nuovo notebook</Button>
```

This preserves the approved rounded CTA with the current shared material, readable ink and theme behavior. If the visual language changes at the user's request, update `Button.tsx` and the `--button-*` CSS tokens instead of editing each usage.

## Selection Buttons

Navigation tabs, model selectors, and segmented controls use the neutral `--selection-*` tokens. Match the navbar's `ds-selected` state; inactive controls stay borderless.

Use the navbar's `buildAccentNavClusterStyle()` for grouped switch containers and `ds-selected` for the selected item, with neutral ghost buttons for inactive items. Do not add local inset underlines or pressed-edge shadows to selected buttons.
