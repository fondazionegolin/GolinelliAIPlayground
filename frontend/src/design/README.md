# Design System

This folder is the single source of truth for product UI.

## Rules

- The visual language is flat and lightly glossy: opaque or barely transparent surfaces, one subtle top reflection, and shadows for separation.
- Decorative outlines are not part of the system. Do not add local `border-*` or `ring-*` classes to controls, cards, navigation, or popovers.
- Use the shared CSS surfaces (`ds-control`, `ds-selected`, `ds-panel`, `ds-popover`, `ds-navbar`) and `--ds-*` tokens. Borders remain valid only when they communicate meaning, such as validation, accessible focus, or a drop target.
- Do not use backdrop blur for ordinary chrome. Transparency must remain slight enough to preserve contrast without glassmorphism.
- Use primitives exported from `@/design` for buttons, cards, inputs, badges, dialogs, tabs, and spinners.
- Do not copy primary button styles into feature components. Use `<Button tone="accent" surface="solid">`.
- Do not introduce new dominant UI colors in feature screens. Use the logo palette:
  - `--logo-pink`
  - `--logo-blue`
  - `--logo-violet`
- Use full logo colors for actions, CTAs, selected states, and important status controls.
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

This produces the rounded, filled, shadowed CTA shape. Its color comes from the current `--app-accent`, so role/theme accent changes flow through automatically. If the visual language changes, update `Button.tsx` and the `--button-*` CSS tokens instead of editing each usage.

## Selection Buttons

Navigation tabs, model selectors, and segmented controls use `--selection-*` for color and `--ds-shadow-*` for separation. Selected navigation may use the accent surface; inactive controls stay borderless.
