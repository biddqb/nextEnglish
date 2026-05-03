## Overview

ElevenLabs reads like a quietly editorial print magazine that happens to be a voice-AI product. The base canvas is off-white `{colors.canvas}` (#f5f5f5) holding warm near-black ink `{colors.ink}` (#0c0a09). The brand voltage is **photographic, not chromatic**: soft pastel atmospheric gradient orbs (mint, peach, lavender, sky, rose) drift through the page as the only "color" moments. There is no neon accent, no saturated CTA color, no dark-canvas dev-tools atmosphere.

Type pairs **Waldenburg Light** (custom serif at weight 300) for display with **Inter** for body, navigation, captions. The display weight at 300 is the editorial signature — never bold, never heavy.

CTAs are subtle: a near-black ink pill (`{component.button-primary}`) is the primary, a transparent outline (`{component.button-outline}`) is the secondary. The brand trusts atmospheric photography and modest type weights to carry brand work.

**Key Characteristics:**
- Off-white canvas, warm near-black ink. No saturated CTA color.
- Single primary action: ink pill at `{rounded.pill}`. Atmospheric gradients carry visual brand voltage.
- Display runs Waldenburg Light at weight 300 — editorial magazine voice.
- Body runs Inter at 400 with subtle letter-spacing (+0.15-0.18px).
- Pastel gradient orbs (5 tokens: mint, peach, lavender, sky, rose) used as atmospheric brand decoration only.
- Soft pill geometry (`{rounded.pill}` for CTAs, `{rounded.xl}` for cards).
- 96px section rhythm.

## Colors

### Brand & Accent
- **Ink Primary** (`{colors.primary}` — #292524): The primary action color — warm near-black pill. Used scarcely.
- **Ink Primary Active** (`{colors.primary-active}` — #0c0a09): Press state.

### Surface
- **Canvas** (`{colors.canvas}` — #f5f5f5): Off-white page floor.
- **Canvas Soft** (`{colors.canvas-soft}` — #fafafa): Lighter band for subtle alternating sections.
- **Canvas Deep** (`{colors.canvas-deep}` — #0c0a09): Same as ink — used for the rare dark-mode hero (Agents page).
- **Surface Card** (`{colors.surface-card}` — #ffffff): Pure white card.
- **Surface Strong** (`{colors.surface-strong}` — #f0efed): Badges, voice-icon plates.
- **Surface Dark** (`{colors.surface-dark}` — #0c0a09): Dark hero/CTA band canvas.
- **Surface Dark Elevated** (`{colors.surface-dark-elevated}` — #1c1917): Cards on dark canvas.

### Hairlines
- **Hairline** (`{colors.hairline}` — #e7e5e4): Default 1px divider.
- **Hairline Soft** (`{colors.hairline-soft}` — #f0efed): Lighter divider.
- **Hairline Strong** (`{colors.hairline-strong}` — #d6d3d1): Stronger panel outline.

### Text
- **Ink** (`{colors.ink}` — #0c0a09): Display, primary text.
- **Body** (`{colors.body}` — #4e4e4e): Default running-text.
- **Body Strong** (`{colors.body-strong}` — #292524): Same as primary — emphasis.
- **Muted** (`{colors.muted}` — #777169): Sub-titles.
- **Muted Soft** (`{colors.muted-soft}` — #a8a29e): Disabled text.
- **On Primary** (`{colors.on-primary}` — #ffffff): White text on ink pill.
- **On Dark** (`{colors.on-dark}` — #ffffff): White text on dark hero.
- **On Dark Soft** (`{colors.on-dark-soft}` — #a8a29e): Muted off-white on dark.

### Atmospheric Gradient Stops (signature)
- **Gradient Mint** (`{colors.gradient-mint}` — #a7e5d3): Mint green orb.
- **Gradient Peach** (`{colors.gradient-peach}` — #f4c5a8): Peach orb.
- **Gradient Lavender** (`{colors.gradient-lavender}` — #c8b8e0): Lavender orb.
- **Gradient Sky** (`{colors.gradient-sky}` — #a8c8e8): Sky-blue orb.
- **Gradient Rose** (`{colors.gradient-rose}` — #e8b8c4): Rose orb.

These appear ONLY as soft radial-gradient atmospheric orbs inside `{component.gradient-orb-card}` and as background atmospheric blooms behind hero copy. Never as button fills, never as text colors.

### Semantic
- **Success** (`{colors.semantic-success}` — #16a34a): Confirmation.
- **Error** (`{colors.semantic-error}` — #dc2626): Validation errors.

## Typography

### Font Family
**Waldenburg Light** is the licensed display serif at weight 300. **Inter** carries body, navigation, captions, and buttons. Fallback: `'Times New Roman', serif` for Waldenburg, `sans-serif` for Inter.

### Hierarchy

| Token | Size | Weight | Line Height | Letter Spacing | Use |
|---|---|---|---|---|---|
| `{typography.display-mega}` | 64px | 300 | 1.05 | -1.92px | Homepage hero h1 |
| `{typography.display-xl}` | 48px | 300 | 1.08 | -0.96px | Subsidiary heroes |
| `{typography.display-lg}` | 36px | 300 | 1.17 | -0.36px | Section heads |
| `{typography.display-md}` | 32px | 300 | 1.13 | -0.32px | Sub-section heads |
| `{typography.display-sm}` | 24px | 300 | 1.2 | 0 | Card group titles |
| `{typography.title-md}` | 20px | 500 | 1.35 | 0 | Component titles — Inter |
| `{typography.title-sm}` | 18px | 500 | 1.44 | 0.18px | List labels |
| `{typography.body-md}` | 16px | 400 | 1.5 | 0.16px | Default body — Inter |
| `{typography.body-strong}` | 16px | 500 | 1.5 | 0.16px | Emphasized body |
| `{typography.body-sm}` | 15px | 400 | 1.47 | 0.15px | Footer body |
| `{typography.caption}` | 14px | 400 | 1.5 | 0 | Photo captions |
| `{typography.caption-uppercase}` | 12px | 600 | 1.4 | 0.96px | Section labels, badges |
| `{typography.button}` | 15px | 500 | 1.0 | 0 | CTA pill |
| `{typography.nav-link}` | 15px | 500 | 1.4 | 0 | Top-nav menu |

### Principles
- **Display weight stays at 300.** Waldenburg Light is the editorial signature. Never bold display copy.
- **Subtle letter-spacing on body.** Inter at +0.15-0.18px tracking — slightly looser than default Inter for a more editorial feel.
- **Negative letter-spacing on display.** Waldenburg pulls -0.32px to -1.92px tighter on display sizes.

### Note on Font Substitutes
Waldenburg is licensed. Open-source substitute: **EB Garamond** at weight 300 (slightly more humanist) or **GT Sectra** (closer to Waldenburg's modernity). Use Inter directly for body — it's the same family ElevenLabs uses.

## Layout

### Spacing System
- **Base unit:** 4px.
- **Tokens:** `{spacing.xxs}` 4px · `{spacing.xs}` 8px · `{spacing.sm}` 12px · `{spacing.base}` 16px · `{spacing.md}` 20px · `{spacing.lg}` 24px · `{spacing.xl}` 32px · `{spacing.xxl}` 48px · `{spacing.section}` 96px.
- **Section padding:** 96px.

### Grid & Container
- Max content width: ~1200px.
- Editorial body: 12-column grid.
- Feature card grids: 2-up at desktop for hero splits, 3-up for benefit grids.
- Footer: 5-column at desktop.

### Whitespace Philosophy
Generous editorial pacing — print-magazine feel. 96px between bands; cards inside bands sit close (16-24px gap). The atmospheric gradient orbs occupy generous breathing space without competing with copy.

## Elevation & Depth

The system uses **hairline + soft drop**. Cards float above the off-white canvas via 1px hairlines and a single subtle shadow tier. Atmospheric depth comes from gradient orbs.

| Level | Treatment | Use |
|---|---|---|
| Flat (canvas) | `{colors.canvas}` (#f5f5f5) | Body bands, footer |
| Card | `{colors.surface-card}` (#ffffff) | Content cards |
| Hairline border | 1px `{colors.hairline}` | Card outlines |
| Soft drop | `0 4px 16px rgba(0, 0, 0, 0.04)` | Hovered cards (single shadow tier) |
| Gradient orb | Radial gradient with one of `{colors.gradient-*}` | Atmospheric depth — never a card surface |

### Decorative Depth
- **Pastel gradient orbs** are the brand's strongest atmospheric pattern. Soft radial blooms in mint, peach, lavender, sky, or rose drift through hero bands and feature sections without containing any content — they are pure atmosphere.

## Shapes

### Border Radius Scale

| Token | Value | Use |
|---|---|---|
| `{rounded.none}` | 0px | Reserved |
| `{rounded.xs}` | 4px | Inline tags |
| `{rounded.sm}` | 6px | Compact rows |
| `{rounded.md}` | 8px | Form inputs |
| `{rounded.lg}` | 12px | Compact cards |
| `{rounded.xl}` | 16px | Feature cards, pricing tiers |
| `{rounded.xxl}` | 24px | Gradient orb cards (extra-soft) |
| `{rounded.pill}` | 9999px | All CTA buttons, badges |
| `{rounded.full}` | 9999px | Voice icon circles, avatars |

## Components

### Top Navigation

**`top-nav`** — Background `{colors.canvas}`, text `{colors.ink}`, height 64px. Layout: ElevenLabs wordmark left, primary horizontal menu (Creative / Agents / Video / Pricing / Enterprise / Docs), Sign In + "Try free" primary CTA right.

### Buttons

**`button-primary`** — Near-black ink pill. Background `{colors.primary}`, text `{colors.on-primary}`, type `{typography.button}` (15px / 500), padding 10px × 20px, height 40px, rounded `{rounded.pill}`.

**`button-primary-active`** — Press state. Background `{colors.primary-active}`.

**`button-outline`** — Transparent pill with 1px ink border. Background transparent, text `{colors.ink}`, 1px `{colors.hairline-strong}` border.

**`button-tertiary-text`** — Inline ink text link.

### Hero & Atmospheric

**`hero-band`** — Background `{colors.canvas}`, full-width display headline in `{typography.display-mega}` (64px / 300 / -1.92px), subhead in `{typography.body-md}`, two CTAs, and an atmospheric gradient orb behind the centered headline.

**`gradient-orb-card`** — A large card with a soft radial-gradient orb behind centered display copy. Background `{colors.canvas-soft}`, rounded `{rounded.xxl}` (24px), padding 32px. Each variant uses one of the five gradient tokens (`gradient-mint`, `gradient-peach`, `gradient-lavender`, `gradient-sky`, `gradient-rose`).

**`audio-waveform-card`** — A waveform visualization card. Background `{colors.surface-card}`, rounded `{rounded.xl}`, padding 24px. Holds a play button + waveform glyph + voice metadata.

### Cards

**`feature-card`** — 2-up or 3-up grids. Background `{colors.surface-card}`, text `{colors.ink}`, rounded `{rounded.xl}`, padding 24px, 1px hairline border.

**`product-card-stack`** — Stacked product preview cards. Background `{colors.surface-card}`, rounded `{rounded.xl}`, no padding (children fill the card edge-to-edge).

**`testimonial-card`** — Quote card. Background `{colors.surface-card}`, text `{colors.body}`, rounded `{rounded.xl}`, padding 32px.

### Voice Library

**`voice-row`** — Horizontal row in voice list. Background transparent, 1px hairline divider. Layout: 32px circular voice icon (`{component.voice-icon-circular}`) left, voice name + accent stack, optional preview button right.

**`voice-icon-circular`** — Background `{colors.surface-strong}`, rounded `{rounded.full}`, 32px diameter. Holds initials or voice glyph.

### Pricing

**`pricing-tier-card`** — Background `{colors.surface-card}`, rounded `{rounded.xl}`, padding 32px, 1px hairline border.

**`pricing-tier-featured`** — Featured tier inverts. Background `{colors.surface-dark}`, text `{colors.on-dark}`. Same shape, dark inversion.

### Forms & Tags

**`text-input`** — Background `{colors.surface-card}`, text `{colors.ink}`, rounded `{rounded.md}` (8px), padding 12px × 16px, height 44px, 1px `{colors.hairline-strong}` border. On focus, border thickens to 2px ink.

**`badge-pill`** — Background `{colors.surface-strong}`, text `{colors.ink}`, type `{typography.caption-uppercase}`, rounded `{rounded.pill}`, padding 4px × 10px.

### CTA / Footer

**`cta-band`** — Pre-footer. Background `{colors.canvas}`, centered display headline in `{typography.display-lg}`, single ink pill CTA. 96px padding.

**`footer`** — Closing footer. Background `{colors.canvas}`, text `{colors.body}`. 5-column link list. 64×48px padding.

**`footer-link`** — Background transparent, text `{colors.body}`, type `{typography.body-sm}`.

## Do's and Don'ts

### Do
- Reserve `{colors.primary}` (ink pill) for primary CTAs.
- Use Waldenburg Light at weight 300 for every display headline. Never bold.
- Use Inter at +0.15-0.18px tracking for body — the editorial dialect.
- Use atmospheric gradient orbs (mint/peach/lavender/sky/rose) as decoration only.
- Use the pill shape for every CTA and badge.

### Don't
- Don't introduce a saturated brand action color. Ink pill is the only CTA color.
- Don't bold display copy. Display sits at weight 300 — bolding shifts the brand voice from editorial to consumer-marketing.
- Don't use gradient orbs as button fills, text colors, or component backgrounds. They are pure atmosphere.
- Don't use sharp `{rounded.none}` (0px) on CTAs. Pill geometry is the brand button.
- Don't drop body Inter to weight 300 to match Waldenburg — body stays at 400/500 for legibility.
- Don't extract a CTA color from a third-party widget (cookie consent, OneTrust). The brand's CTA color is what appears on actual product CTAs.

## Responsive Behavior

### Breakpoints

| Name | Width | Key Changes |
|---|---|---|
| Mobile | < 640px | Hero h1 64→32px; feature cards 1-up; nav hamburger; gradient orbs shrink. |
| Tablet | 640–1024px | Hero h1 48px; feature cards 2-up. |
| Desktop | 1024–1280px | Full hero h1 64px; feature cards 3-up. |
| Wide | > 1280px | Content caps at 1200px. |

### Touch Targets
- Primary pill at 40px height — at WCAG AA, padded for AAA.
- Voice icon circles 32px — padded row creates effective 48px tap zone.

### Collapsing Strategy
- Top nav switches to hamburger below 768px.
- Feature grid: 3-up → 2-up → 1-up.
- Gradient orbs reduce diameter at every breakpoint but never disappear.

## Iteration Guide

1. Focus on a single component at a time.
2. CTAs default to `{rounded.pill}`. Cards use `{rounded.xl}` (16px).
3. Variants live as separate entries.
4. Use `{token.refs}` everywhere — never inline hex.
5. Hover state never documented.
6. Waldenburg 300 for display, Inter 400/500 for body.
7. Gradient orbs scoped to atmospheric decoration.

## Known Gaps

- Waldenburg is a licensed typeface; EB Garamond / GT Sectra are documented substitutes.
- Animation timings (orb drift, waveform pulse, hero entrance) out of scope.
- In-product surfaces (voice library editor, agent playground) only partially captured via marketing mockups.
- Form validation states beyond focus not visible on captured surfaces.

---

# App Shell Extensions (nextEnglish)

The base UI_DESIGN.md above defines a marketing/brand language. nextEnglish is an
application — it needs patterns the marketing system didn't cover. This section
extends UI_DESIGN.md without overriding it. Brand language carries: ink pill, off-white
canvas, Waldenburg Light 300 display, atmospheric gradient orbs as accent only.

Generated by /plan-design-review on 2026-04-30.

## App Shell

**`app-window`** — Min size 960×640. Background `{colors.canvas}`. Tauri-native title
bar (no custom chrome).

**`app-sidebar`** — Background `{colors.canvas-soft}` (#fafafa), 1px `{colors.hairline-strong}`
right divider. Width 280px expanded, 56px collapsed. Auto-collapses below 1100px window
width; user can toggle with Cmd/Ctrl+\\. Sidebar header = "+ New clip" outline pill
(`{component.button-outline}`) full-width with `{spacing.base}` (16px) padding.

**`app-topbar`** — Adapted from `{component.top-nav}`: 64px height, background
`{colors.canvas}`, 1px `{colors.hairline}` bottom divider. Layout: nextEnglish wordmark
left in `{typography.title-md}`; current segment breadcrumb center `{typography.body-md}`
muted ("Lex Fridman · Segment 3 of 12"); settings cog icon-button right.

**`app-main`** — Background `{colors.canvas}`, padding `{spacing.app-section}` (48px) top
+ `{spacing.xl}` (32px) horizontal. New token `{spacing.app-section}` = 48px replaces the
96px marketing-section rhythm; 96px feels too generous inside an app window.

## Sidebar Patterns

**`clip-row`** — Adapts `{component.voice-row}`. 64px height, `{spacing.sm}` (12px)
horizontal padding. Layout: 32px circular thumbnail (`{component.voice-icon-circular}`,
shows YouTuber avatar or initials), title in `{typography.body-strong}`, sub-line
"12 segments · 2h ago" in `{typography.caption}` `{colors.muted}`. Active state:
background `{colors.surface-strong}`, no other treatment. Hover: background
`{colors.surface-strong}` at 50% opacity.

**`clip-row-collapsed`** — When sidebar collapsed (56px width), only the 32px circular
thumbnail shows, centered. Tooltip shows clip title on hover.

**`segment-row`** — Different from `clip-row`. Used in main pane when a clip is selected.
Layout: timestamp `{typography.caption-uppercase}` `{colors.muted}` left ("00:14 → 00:23"),
segment text in `{typography.body-md}` truncated to one line with ellipsis. 48px height,
`{spacing.base}` (16px) padding. 1px `{colors.hairline}` bottom divider between rows.
Active segment: background `{colors.surface-strong}`, left border 2px `{colors.ink}`
inset.

## Media Controls

**`record-button`** — Circular ink pill at `{rounded.full}`. Idle: 64px diameter,
`{colors.primary}` background, white mic glyph centered, `{typography.caption}` muted
caption "Press to record · Space" below at `{spacing.xs}` (8px) gap. Listening/recording:
grows to 80px (200ms ease-out), soft `{colors.gradient-peach}` radial orb behind at 120px
diameter with low opacity, mic glyph stays. Caption updates to "Listening…" Returns to
64px on stop.

**`level-meter`** — Five-tick horizontal hairline meter below `record-button` during
recording. Each tick is 24×2px, `{colors.hairline-strong}`, fills to `{colors.ink}` based
on input RMS. `{spacing.xs}` (8px) gap between ticks. 32px gap from `record-button` to
meter.

**`scrubber`** — Reference audio playback control. 4px height bar, `{colors.hairline}`
unfilled track, `{colors.ink}` filled track. 12px circular handle `{colors.ink}` on track
(`{rounded.full}`). Time labels left/right in `{typography.caption}` `{colors.muted}`.
Click track = seek. Drag handle = scrub.

**`play-button`** — Smaller variant of `record-button`. 40px diameter, white play glyph
on `{colors.primary}` background. Toggles to pause glyph during playback. Lives next to
`scrubber` left.

## Score Card

**`score-card`** — The single most important component. Background transparent (sits on
`{colors.canvas}`), padded `{spacing.xl}` (32px) on all sides, max-width 480px centered.

Layout top-to-bottom:
1. **Score number** in `{typography.display-mega}` (64px, Waldenburg Light 300, -1.92px
   tracking), `{colors.ink}`. Centered. Tweens from 0 over 600ms ease-out on reveal.
2. **Score label** `{typography.caption-uppercase}` `{colors.muted}` below number,
   "OVERALL". `{spacing.sm}` (12px) gap from number.
3. **Three sub-metrics** in a horizontal row, `{spacing.xl}` (32px) gap between:
   - "WORDS" label `{typography.caption-uppercase}` muted, value `{typography.title-md}`
     ink (e.g., "92%")
   - "CADENCE" same treatment
   - "PITCH" same treatment, value reads "—" if pitch correlation is unreliable
4. **Reference text** `{spacing.xxl}` (48px) below sub-metrics, in `{typography.body-md}`
   `{colors.body}`. Words rendered inline. Mispronounced words: 1px solid
   `{colors.hairline-strong}` underline, NO color change. Missed words: strikethrough in
   `{colors.muted-soft}`.
5. **Try-again pill** `{component.button-primary}` "Try again · Space" below reference
   text, `{spacing.xl}` (32px) gap.

**`score-card-history-line`** (v2) — Inline sparkline above the score number on segments
the user has practiced before. 1px `{colors.muted-soft}` trace of the last 10 attempt
scores. No fill. 80×24px. Today's attempt is the rightmost point, dot
`{colors.ink}` `{rounded.full}` 4px diameter. No axis labels.

## Empty States

**`empty-state-hero`** — Used for first launch, no-clips, error-recovery. Centered in
main pane. Single soft `{colors.gradient-mint}` orb at 320px diameter, 30% opacity,
positioned 80px above the headline. Below orb: `{typography.display-lg}` headline
`{colors.ink}` (e.g., "Sound like the people you listen to."). Below headline:
`{typography.body-md}` `{colors.muted}` one-sentence description, max-width 480px.
Below description: a single `{component.text-input}` (URL paste) or
`{component.button-primary}` (CTA), centered.

**`empty-state-inline`** — For empty segment lists, empty score history. Centered in the
container. `{typography.body-md}` `{colors.muted}` one-line message, no orb, no
illustration. Optional outline pill below for the primary action.

## Notifications & Errors

**`inline-error`** — Errors live with their cause, never as toasts. Below the offending
input: `{typography.body-sm}` `{colors.semantic-error}` text, `{spacing.xs}` (8px) gap
from input. No icon. Auto-clears on input change.

**`toast-success`** — Bottom-center, 24px above window edge. Background
`{colors.surface-dark}`, text `{colors.on-dark}`, `{typography.body-sm}`,
`{rounded.pill}`, padding 12px × 24px. Auto-dismisses after 2s. Used ONLY for
fire-and-forget actions (e.g., "Clip added", "Settings saved"). Never for errors.

**`toast-progress`** — Same shape as `toast-success` but persists with a thin progress
bar at the bottom edge. Used for background ingest progress. Click to dismiss or expand
to a detail dialog.

## Modal / Dialog

**`dialog`** — Centered overlay. Backdrop `{colors.ink}` at 12% opacity, no blur.
Container: `{colors.surface-card}` background, `{rounded.xl}` (16px),
`{spacing.xl}` (32px) padding, max-width 560px. Header `{typography.display-md}`,
body `{typography.body-md}` `{colors.body}`, action row at bottom right with secondary
outline pill + primary ink pill, `{spacing.base}` (16px) gap between them.

**`dialog-trim`** — Specific dialog for the 15-min cap from eng review A5A. Title:
"Trim to a 15-minute window". Body: dual-handle range slider on a horizontal waveform
(audio peaks at 1px hairline). Two `{typography.caption-uppercase}` time labels
showing start/end. Secondary outline "Cancel" + primary ink "Trim & Add". Slider track
selected region fills `{colors.ink}` at 8% opacity.

## Focus & Keyboard

**Focus ring (universal):** 2px solid `{colors.ink}` outline, 2px offset, no border-radius
override (matches the element's existing radius). Never remove the default browser focus
without replacing.

**Keyboard map:**

| Shortcut | Action |
|---|---|
| `Space` | Play/pause reference (idle) · Toggle record (in session) |
| `Cmd/Ctrl+R` | Start recording attempt |
| `Esc` | Stop recording / close dialog |
| `Cmd/Ctrl+1..9` | Jump to segment N of current clip |
| `↑ / ↓` | Navigate sidebar clip list |
| `Enter` | Open selected clip |
| `Cmd/Ctrl+,` | Open settings |
| `Cmd/Ctrl+\\` | Toggle sidebar collapse |
| `Cmd/Ctrl+N` | Focus the URL paste input |
| `Cmd/Ctrl+T` | Open trim dialog for current clip |

## ARIA

- Record/play/stop icon buttons: `aria-label` always set ("Record attempt", "Play reference", "Stop recording").
- Score number on reveal: container has `aria-live="polite"`. Screen reader announces "Score 78. Words 92 percent. Cadence 78 percent."
- Sidebar: `<nav aria-label="Clip library">`. Each clip row: `<button>` with descriptive name.
- Reference text in ScoreCard: mispronounced words wrapped in `<span aria-label="mispronounced: consensus">consensus</span>`.

## Animation (timings)

| Action | Duration | Easing |
|---|---|---|
| Score number tween | 600ms | ease-out |
| Sidebar collapse/expand | 200ms | ease-in-out |
| Record button grow/shrink | 200ms | ease-out |
| Empty-state orb drift | 12s | linear infinite |
| Toast slide-up + fade | 250ms | ease-out |
| Dialog overlay fade | 150ms | ease-out |
| Score reveal | 400ms after analysis stops | ease-out |

## Tokens to add

```
{spacing.app-section} = 48px        // replaces 96px inside app window
{component.app-sidebar}              // see App Shell
{component.app-topbar}
{component.app-main}
{component.clip-row}
{component.clip-row-collapsed}
{component.segment-row}
{component.record-button}
{component.level-meter}
{component.scrubber}
{component.play-button}
{component.score-card}
{component.score-card-history-line}  // v2
{component.empty-state-hero}
{component.empty-state-inline}
{component.inline-error}
{component.toast-success}
{component.toast-progress}
{component.dialog}
{component.dialog-trim}
```
