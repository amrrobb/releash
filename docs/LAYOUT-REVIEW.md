# Layout review — live site, 4 Oct 2026

Scope: layout only (no copy, feature or label changes; driver contract in `web/rehearsal/contract-check.mjs`
untouched). Captured live with `web/rehearsal/layout-shots.mjs` at 1440×900, 1280×800, 1920×1080, 390×844 and
375×812, full page and above the fold. Before: `web/screenshots/layout/before/`, after: `web/screenshots/layout/after/`.
Compared against `docs/mockups/01–04`.

Checklists applied: **better-layout** (BL: group with space, shared edges, order by importance, hold structure
until it breaks, plan for growth), **ui-ux-pro-max** (UX: §2 touch targets 44px / 8px spacing, §5 no horizontal
scroll, mobile-first), **better-ui** (BU: surface depth, optical alignment).

Horizontal overflow: none on any page at any viewport (scrollWidth == viewport everywhere, before and after).
/demo at 1920×1080: scrollHeight 1080 before and after (fits, no scroll).

Ranked by visibility to a judge.

| # | Sev | Page × viewport | Issue | Rule | Fix | Min | Status |
|---|-----|-----------------|-------|------|-----|-----|--------|
| L1 | HIGH | /demo 721–1500px (1280 worst) | "Without Releash" wrapped to two lines because title + pill + address shared one row; its equity figure sat ~33px below the With side, so the core With/Without comparison read misaligned. At 1440 the addresses floated top-right on a different baseline from the titles. | BL shared edges; BL plan for growth | Title `nowrap`; address on its own line under the title on both sides between 721 and 1500px (inline stays at 1920, where it fits and the 1080 frame is tight). | 10 | Fixed |
| L2 | HIGH | /demo 390, 375 | Scenario bar: label shared a row with "Friday close", the other two choices wrapped to full width, so three equal options rendered at two widths. | BL group with space; UX §2 | Phone scenario bar is a one-column grid: label above, three equal full-width buttons (44px), result, Reset. | 8 | Fixed |
| L3 | HIGH | /app 1440, 1280, 1920 | Ceiling labels "Current debt" / "Your ceiling" collided ("Current debtYour ceiling") when debt and ceiling are close. | BL plan for growth | Each label anchors on its own mark and grows away from the other with a 6px gap (`Agent.tsx` transforms only). | 6 | Fixed |
| L4 | MEDIUM | /app ≥1001px | Activity list (700px max) set the row height, leaving ~280px of empty card under Agent permissions; uneven column. | BL group with space; BU surface depth | `contain: size` on the feed card so the permissions card sets the row; the list scrolls inside (`flex: 1`). Page 1606 → 1409px. | 6 | Fixed |
| L5 | MEDIUM | /demo 390, 375 | Market block stacked state over price, ~70px before the scenario bar; the comparison started below the fold. | BL order by importance | Phone market block on one line (state, then price). | 5 | Fixed (batch 2) |
| L6 | LOW | / 390, 375 | "Built on" strip: the decorative side rules took row slots and orphaned "World ID · Jev" beside a lone rule. | BL shared edges | Rules hidden on phones, wrap centred. | 3 | Fixed |
| L7 | LOW | / all desktop | Steps: subtitle and body 10px apart read as two groups (mockup: one). | BL group with space (intra < inter) | `.why` margin 10 → 4px. | 2 | Fixed |
| L8 | LOW | /demo ≥1001px | Activity card bottom note sits under a large blank band when the agent card is taller. | BL group with space | Not changed: the band is the list's reserved space for new rows; filling it would reflow on every event. | — | Not fixed (by design) |
| L9 | LOW | / 1440 | Hero has generous top padding (eyebrow 170px from top vs mockup ~130). | mockup parity | Left: changing hero padding shifts the recorded video marks. | 5 | Not fixed |
| L10 | LOW | /demo 390 | The core comparison still starts just below an 844px fold (scenario bar is 3 × 44px targets). | UX §2 vs BL order | Accepted: shrinking targets below 44px fails the contract check; order is header → scenario → comparison → agent, as in the mockup. | — | Not fixed |
| L11 | MEDIUM | /demo, /app 390, 375 | "Renew with World ID (simulated)" wrapped onto two lines beside its arrow inside the full-width primary button. | BL plan for growth; UX §2 | Phone action buttons: 14px inline padding, 8px gap, 15px type; one line down to 375px, still ≥44px tall. | 3 | Fixed |

Verified with: `contract-check.mjs` (all ok), `axe-contrast.mjs`, after-shots at every viewport above. Not verified:
RTL mirror and 200% zoom (no RTL locale shipped).
