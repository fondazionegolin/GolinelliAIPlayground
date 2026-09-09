# Design System

This folder is the single source of truth for product UI.

## Rules

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

Navigation tabs, model selectors, and segmented selection controls should use the `--selection-*` tokens. Selected navigation can use full `--app-accent`; selector pills should use the soft `--selection-bg` surface with `--selection-border`.
