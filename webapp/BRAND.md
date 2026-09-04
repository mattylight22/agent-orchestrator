# Agent God Mode web brand guide

Agent God Mode should feel like a precise, premium command center for serious software work. The visual language is editorial and architectural—not futuristic, decorative, or generically “AI.”

## Palette

| Role | Light | Dark | Use |
| --- | --- | --- | --- |
| Obsidian | `#171612` | `#171612` | Dark fields, footer, icon ground, high-emphasis text |
| Graphite | `#24221D` | `#24221D` | Layered dark surfaces |
| Warm ivory | `#F5F0E6` | `#F5F0E6` | Main light canvas and dark-theme text |
| Raised ivory | `#FCF9F2` | — | Light cards and elevated surfaces |
| Brass | `#B08A45` | `#D0AF6A` | Primary action, focus, selection, small structural accents |
| Muted steel | `#4F6F78` | `#89A7AF` | Informational links and low-severity state only |
| Green | `#2F8064` | `#67AE8F` | Connected, complete, clean, success |
| Amber | `#946D2C` | `#C39A51` | Warning and pending attention |
| Red | `#A94742` | `#CF706A` | Error, destructive action, critical findings |

Brass is not a surface color. Use it for the single primary action in a region, active/focus indicators, or a small icon detail. Green, amber, red, and steel must communicate state and must not become decorative brand colors.

## Typography and iconography

- Public display headings use the native editorial serif stack: Iowan Old Style, Palatino, Book Antiqua, Georgia.
- Product UI, labels, and body copy use the existing system sans stack. Branches, SHAs, provider IDs, and logs use SF Mono-compatible monospace.
- Use the black-backed Zeus mark without recoloring it. Keep it square, preserve clear space, and never add glow, gradient, or colored filters.
- Use Lucide outline icons at restrained sizes. Icons clarify actions and structure; they do not decorate headings unnecessarily.

## Components and interaction

- Primary buttons use brass with obsidian text. Secondary actions use neutral surfaces and hairline borders.
- Only one visually dominant primary action should appear in a region.
- Focus uses a clearly visible brass ring with at least a 3px visual footprint. Hover and pressed states change tone without shifting layout.
- Disabled controls retain their shape and label while reducing contrast. Loading labels remain the same width where practical.
- Status colors are always paired with text, iconography, or both. Never rely on color alone.
- All normal text and interactive states must meet WCAG AA contrast in both themes.

## Composition

- Prefer warm neutral fields, exact separators, 8–12px radii, and minimal elevation.
- Public pages alternate warm-ivory editorial sections with deliberate obsidian sections.
- Avoid gradients, neon effects, glowing orbs, glass-heavy cards, purple/blue branding, oversized dashboard cards, and stock AI imagery.
- Product demonstrations use accurate code-native diagrams. Never put fabricated operational records into the real dashboard or expose private repository data in marketing materials.
