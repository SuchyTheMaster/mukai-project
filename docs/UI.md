# RetroWave Design System

## Overview

RetroWave is a synthwave-infused, gradient-soaked design system dripping with 80s nostalgia. Built for retro-themed entertainment and music platforms, it layers hot pink, electric purple, and neon blue over deep navy darkness. Every surface pulses with neon glow, every button carries a gradient, and the entire experience feels like driving through a cyberpunk cityscape at midnight. This is maximalism with a purpose.

---

## Branding / App Header

- Główny branding aplikacji znajduje się na górze lewej kolumny roboczej i pokazuje logo oraz nazwę `MUKAI`; pod nazwą widoczny jest mniejszy napis `Music to Karaoke AI Creator`.
- Logo jest widoczne obok nazwy w pierwszym widoku i globalnym shellu aplikacji; nie może występować wyłącznie jako mała ikona w nawigacji.
- W lewym panelu logo ma obszar `80x100px`, grafika wypełnia go w trybie `contain`, napis `MUKAI` ma rozmiar `63px`, a slogan ma rozmiar `13.2px` i pozostaje pod nim z `line-height: 1`.
- Logo musi być skalowane do rozmiaru proporcjonalnego względem tekstu, przycisków i spacingu headera, także wtedy, gdy dostarczony oryginał jest duży.
- Tekst alternatywny logo: `MUKAI - Music to Karaoke AI Creator`.
- Branding pozostaje zgodny z RetroWave: ciemne tło, neonowe akcenty, czytelny kontrast i brak jasnych powierzchni.
- Jeśli logo nie zostało jeszcze dostarczone, UI może pokazać sam tekst nazwy albo prosty placeholder tekstowy, ale nie generuje zastępczego logo.

## App Shell Layout

- Globalny shell nie ma stałego headera pełnej szerokości; branding `MUKAI` zajmuje tylko szerokość lewej kolumny, dzięki czemu środkowa i prawa kolumna zaczynają się od góry strony z zachowaniem paddingu.
- Po lewej stronie znajduje się pływająca kolumna robocza. Jej górny panel zawiera branding, upload audio, krótkie podsumowanie pliku, podgląd covera oraz akcje covera przed utworzeniem zadania.
- Akcja `Od nowa` znajduje się w lewej kolumnie bezpośrednio pod brandingiem i nad sekcją audio. Jest ukryta wyłącznie w całkowicie pustym stanie początkowym.
- Po utworzeniu zadania lewa kolumna pokazuje sekcję `WGRANE AUDIO`, dane pliku i nieklikalny podgląd covera; obszar uploadu audio oraz akcje covera są wtedy ukryte.
- Lista `Ustawienia zadania` w lewej kolumnie pokazuje tylko grupy ustawień już zatwierdzone przez użytkownika. Po późniejszej edycji zatwierdzone wartości są aktualizowane, a niezatwierdzone formularze etapów nie pojawiają się w tej liście.
- Lista `Ustawienia zadania` używa większego odstępu `16px` pod wierszami `Język` i `Sylabizacja`, żeby rozdzielić metadane, główne modele i ustawienia zaawansowane; w grupie transkrypcji pokazuje też finalne `Pozycjonowanie`.
- Główny obszar pracy pomiędzy kolumnami pokazuje właściwą zawartość aktywnego widoku: upload, status przetwarzania, edytor albo eksport.
- Po prawej stronie znajduje się pływająca kolumna etapów pipeline'u. Nad listą pipeline'u pokazuje aktualny etap, a niżej od razu wszystkie spodziewane etapy.
- W widoku `Dopasowanie` prawa kolumna jest domyślnie ukryta, żeby zwiększyć przestrzeń roboczą edytora, ale użytkownik może ją pokazać i ponownie ukryć.
- Na małych ekranach prawa kolumna etapów musi zmienić się w zwijany panel albo poziomy pasek, tak żeby nie zasłaniać formularzy, edytora ani przycisków.
- `docs/assets/background.png` jest źródłem subtelnego fragmentu tła umieszczanego u góry i wyśrodkowanego poziomo (`top center`). Tło nie powinno być kotwiczone do lewej ani prawej strony. Musi wtapiać się w `surface-base`, nie obniżać kontrastu tekstu i nie zastępować ciemnej bazy RetroWave.

## Brand Assets

- `docs/assets/` jest katalogiem źródłowym dla materiałów marki dostarczonych agentowi do przygotowania UI.
- `docs/assets/logo.png` jest źródłem logotypu dla headera.
- `docs/assets/background.png` jest źródłem dekoracyjnego fragmentu tła.
- `docs/assets/favicon.png` jest jedynym źródłem favicon.
- Agent AI wdrażający UI ma najpierw sprawdzić `docs/assets/` i na tej podstawie przygotować assety używane przez aplikację.
- Frontend nie importuje i nie linkuje bezpośrednio plików z `docs/assets/`; katalog ten nie jest źródłem runtime ani builda aplikacji.
- Wynikowe assety aplikacyjne umieszczać w `frontend/public/brand/`.
- Domyślna wynikowa nazwa logo: `frontend/public/brand/mukai-logo.png`.
- Domyślna wynikowa nazwa tła: `frontend/public/brand/mukai-background.png`.
- Favicony generować z `docs/assets/favicon.png` jako skalowane pliki runtime/build:
  - `frontend/public/brand/favicon-256.png`
  - `frontend/public/brand/favicon-128.png`
  - `frontend/public/brand/favicon-64.png`
  - `frontend/public/brand/favicon-32.png`
  - `frontend/public/brand/favicon-16.png`
- Frontend ma używać powyższych plików w standardowych deklaracjach favicon z atrybutem `sizes`; nie używać `docs/assets/favicon.png` bezpośrednio w buildzie ani runtime.
- Jeśli dostępnych jest kilka wariantów źródłowego logo, użyć wariantu PNG najlepiej pasującego do headera i zachować proporcjonalne skalowanie w UI.
- Nie generować ani nie zastępować logo, jeśli plik źródłowy nie został dostarczony w `docs/assets/`.
- Brak logo, tła albo wygenerowanych favicon nie może powodować błędu builda, ale implementacja musi wtedy pokazać fallback tekstowy dla logo i pominąć brakujące deklaracje favicon.

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

## Core Tokens

Surfaces:

- **surface-base** (#0A0A2E): Primary app background.
- **surface-raised** (#12123A): Cards, panels, list containers.
- **surface-sunken** (#060620): Inputs, waveform lanes, recessed editor tracks.
- **surface-overlay** (#1C1C4A): Tooltips, popovers, menus, modal overlays.
- **surface-gradient** (linear-gradient(135deg, #0A0A2E, #1C1C4A)): Large visual bands and empty states.

Content:

- **content-primary** (#FFFFFF): Main text on dark surfaces.
- **content-secondary** (#C8C8FF): Secondary labels, list text, inactive controls.
- **content-tertiary** (#8F8FC7): Form labels, helper text, metadata, subtle captions.
- **content-disabled** (#FFFFFF at 35%): Disabled text and icons.
- **content-inverse** (#0A0A2E): Text on bright neon fills when white would not be appropriate.

Borders:

- **border-default** (#2D2D66): Default card, input, list and divider borders.
- **border-strong** (#4A4AA0): Hovered inputs, active panel edges and stronger separators.
- **border-neon** (#FF006E at 55%): Elevated cards and focused feature panels.
- **border-error** (#FF3366): Error inputs and destructive validation states.

Semantic fills:

- **success-fill** (#00F5A0 at 15%): Success chips and low-emphasis success states.
- **warning-fill** (#FFD700 at 15%): Warning chips and review-required states.
- **error-fill** (#FF3366 at 15%): Error chips and destructive low-emphasis states.
- **info-fill** (#3A86FF at 15%): Informational chips and neutral guidance states.

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
Sizes: Small (8px 18px, 12px, 34px), Medium (12px 20px, 14px, 44px), Large (16px 36px, 16px, 52px).
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
- W formularzach ustawień modeli helper może pokazywać techniczną nazwę parametru (`threshold`, `vad_onset`, `speech_pad_ms`); opis użytkowy pozostaje w polskiej etykiecie i tooltipie otwieranym ikoną informacji.
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
- **Done**: success-fill, success text.
- **Processing**: info-fill, info text plus subtle reduced-motion-safe pulse.
- **Pending**: transparent or surface-sunken fill, content-tertiary text, border-default border.
- **Failed**: error-fill, error text.

### Progress Bars
surface-sunken track, radius-pill corners, 6px height for compact stage rows and 10px for focused panels. Determinate fill uses electric blue; completed fill uses success; failed fill uses error. Indeterminate progress may animate a restrained blue highlight and must become static under reduced motion.
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
