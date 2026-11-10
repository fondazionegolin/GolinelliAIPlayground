# Design System

This folder is the single source of truth for product UI.

## Approved product styling

The following choices were explicitly approved by the product owner. Preserve them for future UI work; change these shared tokens and components only when the owner requests a different style.

| Element | Approved treatment | Implementation |
| --- | --- | --- |
| Input, textarea, native select and searchable select | Flat, opaque, slightly cool grey; rounded corners; no border, outline or inset shadow at rest. Strong neutral text and readable grey placeholders. No pink, violet or yellow field fill. | `Input`, `Textarea`, `Select`, `SearchableSelect`; `ds-field` and `--ds-field-*` in `foundation.css` / `index.css`. Current resting fill: light `#f1f3f5`, dark `#191b1e`; radius `18px`. |
| Buttons | Preserve the existing rounded material/pill shapes, spacing and shared variants. Do not add local gradients, borders, pressed edges, inset underlines or custom shadows. | `Button` / `IconButton` from `@/design`; shared `--button-*` and `--selection-*` tokens. |
| Audio transport over cover art | Contrasting circular glass buttons: dark frosted secondary controls with white icons, larger luminous play/pause with dark ink, soft reflections and visible keyboard focus. Keep the same contrast in both themes and retain the glass surface for disabled controls with muted icons. | `IconButton surface="glass"`; `tone="neutral"` for mute/skip and `tone="accent"` for play/pause. Shared `--button-glass-*` tokens and `ds-media-button` in `index.css`; 44px secondary / 56px primary. This is the approved exception for glass blur and reflections over artwork. |
| Switches and segmented selectors | Match the navbar: a shared rounded group and a flat selected item. Selected items have no added lower edge or pressed shadow. | `buildAccentNavClusterStyle()` for the group; neutral ghost `Button`s and `ds-selected` for the active item. Preserve keyboard focus and `aria-pressed` / `aria-current`. |
| Dropdowns and menus | Match the same flat rounded control. Popup surfaces are opaque, readable, rounded and use only the shared popup shadow. | Native `Select` or searchable `SearchableSelect`; `ds-popover` and `--ds-popover-solid`. Preserve search, keyboard navigation, focus and selection semantics. |
| Sliders (`input[type=range]`) | Flat and ethereal: 4px translucent violet track, translucent filled part, small flat round thumb; no border, outline or shadow. | Global rule at the end of `index.css`; native inputs inherit it, opt out with `data-field-appearance="plain"`. |
| Secondary text | Muted violet in light mode and light rose-violet in dark mode, replacing the old celeste. The rose-violet is text ink, never a field background or border. | `--text-secondary`; use `--text-primary` for titles, labels and main content, and `--ds-field-ink` for input values. |
| Dataflow charts | Choose axis columns with shared dropdowns; numeric axes offer numeric columns, optional Z switches between 2D and 3D. Titles, axis labels, ticks and legends must contrast with the chart surface in both themes. | Shared `Select`; `components/agentic/plotTheme.ts` resolves theme tokens for Plotly SVG/WebGL layouts and updates them when the theme changes. |
| Smart canvas figures | Board figures and post-its are soft: rounded corners (up to 22px), a light vertical shading of their fill (never a flat block), round joins, a faint shadow tinted by the border; the border defaults to the fill's own hue, slightly darker (tone on tone), and follows the fill when it changes unless the user picked another. Frames always sit below every other element. Shape menu: rectangle (rounded and sharp), ellipse, triangle only. | `components/CanvasShape.tsx`, `shapeStrokeFor` / `shadeTopFor` in `components/canvasColors.ts`; z layering in `CollaborativeCanvas.tsx` (`itemZIndex`). |
| Calendars (navbar week/month modal) | Each day is its own tile on a darker gutter (near-black in dark mode), never hairlines only. Today's date is always a red circle (`--ds-cal-today`) with bold white digits — in the navbar mini calendar, the week header and the month cell — and today's column is lightly tinted; no decorative bars or rings above labels; the current time is a thick glowing accent line in today's column, a dashed faint line in the other days and an accent time pill in the hour gutter. Week view shows only the user's visible hours (default 07–20, saved per browser). Week = columns icon, month = grid icon. | `--ds-cal-gutter`, `--ds-cal-day`, `--ds-cal-day-muted`, `--ds-cal-hour-line`, `--ds-cal-half-line` in `foundation.css`; `components/calendar/CalendarExpandedModal.tsx`. |
| Session join code (navbar) | A small transparent tag with a yellow outline (`--ds-session-code-line`, `SessionCodePill size="sm"`) and bold yellow monospace digits (`--ds-session-code-ink`, darker amber in light mode for contrast); no fill — the filled yellow was too intense (owner request 2026-11-11). Video call codes (`VoiceCallCodeTag`) use the same tag, inside the session pill and laid out horizontally: status dot · session name · code · chevron · settings; a click copies the code and confirms with a toast and a check icon. Approved exception to the logo-palette rule. | `components/SessionCodePill.tsx`, tokens in `foundation.css`. |
| Page identity | An illustration to the left of the combined title and subtitle, using the same artwork as the navigation. Apply this also to detail/editor headers. | `SectionHeading`, or `SectionIllustration` beside an editable title; source of truth: `components/NavSectionArt.tsx`. |

Authored document, slide, canvas and code content keeps its own colors. UI changes must remain legible in both themes and at mobile widths. Focus and validation feedback remain meaningful exceptions to the resting borderless appearance.

All teacher and student search/filter bars use `SearchPill` from `@/design`, including toolbars, sidebars, dialogs, searchable dropdowns and mobile views. Its `ds-search` style fixes height at 44px, horizontal padding at 12px, gap at 8px, icon at 16px and radius at `--ds-field-radius` (18px). Use the single outer `ui-search` surface, shared text/placeholder colors and the same clear button; the input stays transparent and keyboard focus outlines the wrapper. Local classes may set layout (width, margin, flex), never height, padding, radius, colors or shadows. Keep counts in `endAdornment`, input labels/keyboard handlers on the component, and optional specialized clearing through `onClear` / `clearLabel`. Standalone non-search fields retain their usual `--ds-field-*` appearance.

## Admin panel

The admin shell (`frontend/src/pages/admin/admin.css`) is a denser variant of the product UI. By explicit request, admin tables carry hairline column dividers (`th + th`, `td + td`) and admin native fields share the flat `--ds-field-*` look. Admin tab strips (`.admin-tabs .admin-tab`) must keep a real selector specificity: `:where()` rules lose to the browser button reset and flatten the tabs. Keep admin text at 11px or above.

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

## Student chatbot workspace

The initial chat and chatbot library reuse the `/teacher/teacherbots` section illustration via `SectionHeading` / `SectionIllustration`. Use `ChatWelcome` for the illustrated greeting and prompt suggestions on desktop and mobile. Suggestions and toolbar actions use shared `Button` variants and their default rounded shape; do not override the radius or add local colored fills, borders or shadows. Built-in assistant identity uses logo violet, pink and blue; editable custom bot colors remain on avatars. Chat surfaces use theme tokens, and the category tabs use the navbar cluster with `ds-selected`.

## Authored brochures and interactive pages

Brochure headings, prefixes, calls to action and footer are document content: persist `language` and `labels` with the payload and let the chatbot edit or translate them independently of the platform's UI language. The PDF action exports the same rendered HTML through Chromium with screen media, exact colors and the preview viewport; avoid conversions through a word processor that discard CSS layout.

Use `InteractiveHtmlFrame` for opening full authored HTML in documents, shared tasks, attachments and the teacher canvas. Keep JavaScript and controls enabled inside its opaque origin; never combine `allow-scripts` with `allow-same-origin` for these pages. Open document dialogs in a portal under `document.body`, outside page transitions and transformed containers, so embedded controls receive real pointer and keyboard events. Catalog thumbnails stay static, and ordinary rich text still uses sanitization.

## Navbar clock and profile menus

The shared `NavbarCalendarClock` centers its two-line date/time stack inside a 36px control, with no vertical padding. Use compact extra-bold text: 9px/11px line height for the date and 13px/15px for the time, separated by 2px. Keep the time in primary text ink and the date in the calendar's today color. The compact phone calendar retains its day badge.

`ds-popover` provides the shared `--ds-radius-panel` corner radius by default. Teacher and student profile menus clip their header and row hover fills to those rounded corners with `overflow-hidden`.

## Chat model selectors

Student and teacher chat toolbars keep the model selector on a single line, aligned with adjacent controls. `SearchableSelect` uses `favoriteValue` / `onFavoriteChange` to show a star beside each model inside the dropdown; the filled star marks the single default. Choosing a favorite preserves the current chat selection. The trigger also shows the star when the selected model is the default. Keep search, keyboard selection and independently focusable star buttons; use a grid popup when row actions are present. Do not add a separate “set as preferred” caption below the selector.

## Prompt feedback and dictation

`VoiceRecorder` reviews appear in a compact, non-modal shared dialog aligned to the prompt width, above or below it as space permits. Use `anchorElement` for controls rendered outside their target (global dictation); keep translation controls collapsed initially. Preserve editing, playback, insertion, Escape and focus restoration.

Teacher chat acknowledges a submission immediately, displays its user message and initial routing status, and acquires a synchronous lock before any asynchronous work. Keep that lock through routing, conversation creation and execution; cancellation must abort preparation too, and an execution failure must never retry the prompt through the routing fallback.

## Audio playback

The navbar widget is the single persistent audio player for authenticated teachers and students. Double-clicking an audio file in Files or pressing play in Audio Lab, a chat attachment or a podcast starts that same player and opens its popup. Use `useBackgroundAudio().playFile(...)`, `playTracks(...)` or `listen(...)`; feature components must not mount another audio element for ordinary listening. Video editing, voice recording and live calls keep their own transport.

Keep the popup a compact two-column widget (stacked on mobile): left the cover with progress and transport (mute, previous, play/pause, next); right the playlist dropdown («Tutti i brani» or a playlist) above the track list. Clicking a track or choosing a playlist starts playback immediately. Playlist names, saving, reordering, sharing and class broadcast configuration belong in the dedicated playlist section, not the navbar popup. Playback continues after closing the popup or changing page.

The teacher popup offers «Crea musica» with a prompt and duration instead of a computer-upload section. Use the shared `MusicPromptEditor` in the popup and Audio Lab: genre, instrument, rhythm/BPM and timbre terms have semantic text colors and clickable affinity suggestions. Keep its field surface and focus consistent with shared fields. Generated tracks appear in the music workspace library, including actions to create missing cover art. Album art is always square, both in stored images (center crop) and every cover display. Music generation continues as a background job when the popup closes.

Keep Audio Lab essential: prompt, title/duration, cover, artist credit and listening are the primary content. Put generation options, cover editing and secondary track actions behind compact disclosures. Avoid always-visible legends, prompt counters, repeated descriptions and credit explanations. Keyword alternatives open as a vertical dropdown anchored directly to the selected word; preserve arrow-key navigation, Escape, outside dismissal and viewport clamping. Track titles can be renamed from the library and result; the original artist credit comes from the author’s signed-in profile and follows the track into playlists and the navbar.

## Rules

- The visual language is flat and lightly glossy: opaque or barely transparent surfaces, one subtle top reflection, and shadows for separation.
- Decorative outlines are not part of the system. Do not add local `border-*` or `ring-*` classes to controls, cards, navigation, or popovers.
- Use the shared CSS surfaces (`ds-control`, `ds-selected`, `ds-panel`, `ds-popover`, `ds-navbar`) and `--ds-*` tokens. Borders remain valid only when they communicate meaning, such as validation, accessible focus, or a drop target.
- Editable controls use `ds-field` and the shared `--ds-field-*` tokens: light cool-grey backgrounds, rounded corners and no resting borders or inset shadows, with readable neutral input text, grey placeholders and visible focus in both themes. Rose-violet is reserved for secondary text, never field surfaces. Do not replace a field background with a card surface or remove its focus indicator. Legacy native fields inherit the same treatment; editor internals and `data-field-appearance="plain"` are excluded.
- Secondary UI text uses muted violet in light mode and rose-violet in dark mode. Dark-mode legacy `text-blue-*`, `text-sky-*` and `text-cyan-*` classes follow that ink palette; logo fills and authored document colors keep their palette.
- Product pages use `ui-card`, `ui-card-interactive`, `ui-search`, `ui-cta`, and `ui-segment`. These utilities keep legacy feature screens aligned while they migrate to the React primitives.
- Do not use backdrop blur for ordinary chrome. Transparency must remain slight enough to preserve contrast without glassmorphism.
- Audio transport over cover art uses the approved shared `surface="glass"` exception above; keep it scoped to media controls.
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
