# Design Update — Floral Corner + Golden Heart (6 Nov 2026)

## Changes delivered
- **Four corners**: Completely redesigned `assets/floral-corner.svg` to match the provided Image 1 aesthetic — dark botanical-green hibiscus-style flowers with champagne-gold vines, leaves, filigree swirls and seed accents. Applied to all four corners on every screen (login + all app menus).
- **Centre**: New `assets/gold-floral-heart.svg` recreating the symmetrical golden floral-heart / paisley pattern from Image 2. Rendered as a soft, non-interfering watermark behind page content and more prominently on the login screen.
- **CSS**: `css/floral-finish.css` rewritten for higher-fidelity placement, refined opacity, mobile scaling and consistent luxury treatment across sidebar, topbar, panels and navigation.
- **Theme continuity**: Ivory / champagne-gold / deep forest-green palette maintained and reinforced on every menu and page. No business logic, Supabase calls or data workflows were altered.

## Files touched
- `assets/floral-corner.svg` (replaced)
- `assets/gold-floral-heart.svg` (new)
- `css/floral-finish.css` (rewritten)
- Minor conflict cleanup in `css/luxury-botanical.css`

## How to verify
Open `index.html` in a modern browser. You should see:
1. Matching dark-green + gold floral ornaments in all four corners.
2. A subtle golden heart pattern centred behind the main content area on every page.
3. Stronger heart presence on the login card background.
