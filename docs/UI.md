# RetroWave Design System

## Overview

RetroWave is a synthwave-infused, gradient-soaked design system dripping with 80s nostalgia. Built for retro-themed entertainment and music platforms, it layers hot pink, electric purple, and neon blue over deep navy darkness. Every surface pulses with neon glow, every button carries a gradient, and the entire experience feels like driving through a cyberpunk cityscape at midnight. This is maximalism with a purpose.

---

## Colors

- **Hot Pink** (#FF006E): Primary CTA, hero elements
- **Purple** (#8338EC): Secondary actions, gradients
- **Electric Blue** (#3A86FF): Links, info, tertiary accent
- **Surface Base** (#0A0A2E): App background
- **Surface Gradient** (linear-gradient(135deg, #0A0A2E, #1C1C4A)): Hero sections
- **Success** (#00F5A0): Success (neon green)
- **Warning** (#FFD700): Warning (neon gold)
- **Error** (#FF3366): Error (bright red-pink)
- **Info** (#3A86FF): Info (electric blue)

## Typography

- **Headline Font**: Bebas Neue
- **Body Font**: Poppins
- **Mono Font**: IBM Plex Mono

- **h1**: Bebas Neue 56px regular, 1.05 line height
- **h2**: Bebas Neue 44px regular, 1.1 line height
- **h3**: Bebas Neue 32px regular, 1.15 line height
- **h4**: Poppins 22px medium, 1.25 line height
- **body**: Poppins 15px light, 1.6 line height
- **small**: Poppins 13px regular, 1.5 line height
- **tiny**: Poppins 11px regular, 1.4 line height
- **mono**: IBM Plex Mono 13px regular, 1.5 line height

---

## Spacing

Base unit: 8px
- **sp-1**: 4px
- **sp-2**: 8px
- **sp-3**: 16px
- **sp-4**: 24px
- **sp-5**: 32px
- **sp-6**: 48px
- **sp-7**: 64px
- **sp-8**: 96px

## Border Radius

- **radius-sm** (4px): Chips, badges
- **radius-md** (8px): Cards, inputs, buttons
- **radius-lg** (12px): Modals, large panels
- **radius-pill** (9999px): Tags, special badges

## Elevation (Neon Glow)

- **glow-pink-sm**: 8px glow #FF006E at 40%. Subtle hover.
- **glow-pink-md**: 20px glow #FF006E at 50%. Cards, focus.
- **glow-pink-lg**: 40px glow #FF006E at 60%. Hero elements.
- **glow-purple-sm**: 8px glow #8338EC at 40%. Secondary hover.
- **glow-purple-md**: 20px glow #8338EC at 50%. Secondary focus.
- **glow-blue-sm**: 8px glow #3A86FF at 40%. Tertiary hover.
- **glow-blue-md**: 20px glow #3A86FF at 50%. Tertiary focus.
- **glow-combo**: 20px glow #FF006E at 30%, 40px glow #8338EC at 20%. Dual glow.

## Components

### Buttons
#### Primary (Pink-to-Purple Gradient)
`linear-gradient(135deg, #FF006E, #8338EC)` fill, #FFFFFF text, no border, radius-md (8px) corners. 1px tracking. uppercase text-transform. Hover: `brightness(1.15)` + glow-pink-md. Active: `brightness(0.9)`.
#### Secondary (Electric Blue Outline)
transparent, electric-blue text, 2px electric-blue border, radius-md corners. Hover: background #3A86FF at 12% + glow-blue-sm.
#### Ghost
transparent, content-secondary text, no border. Hover: text hot-pink.
#### Destructive
error (#FF3366) fill, #FFFFFF text, no border, radius-md corners. Hover: `brightness(1.15)` + 16px glow #FF3366 at 50%.
#### Sizes
Sizes: Small (8px 18px, 12px, 34px), Medium (12px 28px, 14px, 44px), Large (16px 36px, 16px, 52px).
#### Disabled State
0.35 opacity.
- disabled cursor
- No glow, no gradient animation
---

### Cards
#### Default
surface-raised (#12123A) fill, 1px border-default border, radius-md (8px) corners, no shadow. sp-4/(24px) padding.
#### Elevated (Neon Card)
surface-raised fill, 1px border-neon border, radius-md corners, glow-pink-md shadow. sp-4 padding.
---

### Inputs
surface-sunken (#060620) fill, content-primary text, 2px border-default border, radius-md (8px) corners. Poppins 15px regular. 10px/16px padding.
- **Default**: border-default border color, no shadow.
- **Hover**: border-strong border color, no shadow.
- **Focus**: hot-pink border color, glow-pink-sm shadow.
- **Error**: error border color, 8px glow #FF3366 at 30% shadow.
- **Disabled**: border-default border color, none, 35% opacity shadow.
#### Label
content-tertiary text. Poppins 12px medium uppercase tracking 0.5px. 6px margin-bottom.
#### Helper Text
content-tertiary (default) | error (error state) text. Poppins 12px regular. 4px margin-top.
---

### Chips
#### Filter Chip
transparent, content-secondary text, 1px border-default border, radius-pill corners. 4px/14px padding. Active: background `linear-gradient(135deg, #FF006E, #8338EC)`, text #FFFFFF, border transparent.
#### Status Chip
radius-pill corners. 11px medium. 4px/12px padding.
- **Live**: #00F5A0 at 15% fill, #00F5A0 text.
- **Upcoming**: #FFD700 at 15% fill, #FFD700 text.
- **Ended**: #FF3366 at 15% fill, #FF3366 text.
- **Featured**: #FF006E at 15% fill, #FF006E text.
---

### Lists
transparent, content-secondary, 15px text. 1px border-default divider, 12px 16px item padding, neon badges, play icons trailing elements. Hover: background #FF006E at 6%. Active: background #FF006E at 12%.
---

### Checkboxes
20px x 20px, 2px border-strong border, 4px corners. Transparent unchecked background, `linear-gradient(135deg, #FF006E, #8338EC)` checked background, #FFFFFF, 2px stroke checkmark. Focus: glow-pink-sm. Disabled: 35% opacity.
---

### Radio Buttons
20px x 20px, 2px border-strong border. circle shape. Unchecked: Transparent fill. Selected: hot-pink border, inner dot 8px gradient #FF006E to #8338EC. Focus: glow-pink-sm. Disabled: 35% opacity.
---

### Tooltips
surface-overlay (#1C1C4A) fill, content-primary, 12px text, radius-sm (4px) corners, 1px border-default border, glow-purple-sm shadow. 6px/12px padding, 5px, matching background arrow, 240px max width.
---

## Do's and Don'ts

1. **Do** use pink-to-purple gradients as the signature visual element for primary actions and hero sections.
2. **Don't** apply neon glow to every element simultaneously; let key actions glow and let supporting elements stay dark.
3. **Do** use Bebas Neue at large sizes (32px+) in uppercase for that authentic retro display feel.
4. **Don't** use light backgrounds anywhere; the deep navy base is essential to neon visibility.
5. **Do** animate glow effects with subtle pulse transitions for interactive elements.
6. **Don't** combine all three neon colors (pink, purple, blue) in a single component; pick two maximum.
7. **Do** use tracking and uppercase styling on buttons and labels for the synthwave aesthetic.
8. **Don't** use gradients on body text; reserve gradients for backgrounds, buttons, and decorative elements.
9. **Do** provide reduced-motion alternatives that replace glow animations with static borders.
10. **Do** ensure white text meets minimum 4.5:1 contrast against all dark surface variants.