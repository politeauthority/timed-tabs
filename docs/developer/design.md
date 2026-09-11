# Design resources

Rendered artwork the extension ships and people can borrow: for the UI pages, the
README, the AMO listing, mockups, and for judging the mark at a size the toolbar never
shows it at.

## `src/icons/clock/` — the ring at every position

The toolbar ring, drawn from the same geometry the extension paints with
(`src/shared/icon-art.js`), at 128 pixels, one file per five percent of time remaining.
Every file is there twice, as a PNG and as an SVG of the same shapes.

| File | What it is |
| --- | --- |
| `ring-100` … `ring-005` | The live ring with that much time left, hands on, coloured where the green → yellow → red ramp is at that point. `ring-100` is the identity mark, the full green ring. |
| `ring-000` | Expired: the solid disc with the exclamation knocked out. |
| `expired-100` … `expired-005` | The same positions for a tab that has stopped counting. Hands on, ramp coloured by default; pass `--muted` for a colour off the ramp. |
| `expired-000` | The empty ring with no hands, just the faint track. |
| `expired-000-hands` | The empty ring keeping its hands at full strength. |
| `expired-000-muted` | The empty ring with hands as faint as the spent track, in the ring's own colour. |
| `sheet.svg` | Every frame above laid out on a light and a dark toolbar strip, the live set first and the stopped set below it. Open it to see the whole ramp at once. |

Numbers in the names are **time remaining**, in percent, which is what the ring shows.
Inside the code the same quantity is `progress`, which is time *spent*: `ring-075` is
`progress: 0.25`.

The set drains clockwise from twelve, the way the hands move. The live button still
drains anticlockwise, the direction every user already has, until the
`primary-icon-interactive` flag is folded in; see [building.md](building.md).

## Regenerating

```sh
npm run icons:swatch
```

writes the whole directory again. Run it after any change to `icon-art.js` and commit
what it writes, the same way `npm run icons` keeps the packaged icon set honest. There is
no drift check for this set yet.

### Colours

Each part of each set can be given a colour of its own, as a `#rrggbb` flag:

```sh
npm run icons:swatch -- --color=#2ecc71                 # fix the live ring's colour, no ramp
npm run icons:swatch -- --track=#1b3a2a                 # the spent part of the live ring, solid
npm run icons:swatch -- --muted=#707d91                 # the stopped set, off the ramp
npm run icons:swatch -- --muted-track=#33363c           # the spent part of the stopped ring
```

Without `--track` or `--muted-track`, the spent part is the ring's own colour at 20%
opacity, which is how the toolbar draws it. `#707d91` is the slate the paused clock uses
(`STATE_COLORS.paused` in `src/shared/color.js`), the natural choice for a muted set.

## Using the files

- **In the extension.** The directory is under `src/`, so every build packages it and an
  extension page reaches a frame by relative path: from `src/ui/`, that is
  `../icons/clock/ring-075.svg`, or `browser.runtime.getURL("icons/clock/ring-075.png")`
  from anywhere. Prefer the SVGs there; they scale to whatever the layout needs. For a
  ring that has to follow a live value, draw it instead with `drawDial` from
  `src/shared/icon-art.js` on a canvas, which is what the toolbar does, rather than
  swapping between twenty static files.
- **Store listing and README.** Use the PNGs; AMO and GitHub both render them, and the
  SVGs use `opacity` on strokes, which some image pipelines flatten badly.
- **Mockups.** The SVGs scale without loss. Each is a 32-unit viewBox, so they drop into
  a design at any size; the geometry is hinted for the 48px-and-up render, which is the
  right one above toolbar size.
- **A new state for the button.** Do not hand-edit anything here. Add the option to
  `dialShapes` in `icon-art.js`, cover it in `tests/icon-art.test.js`, add a frame to
  `scripts/icon-swatch.mjs`, regenerate, and describe the new file in the table above.
  The `hands`, `mutedHands`, `clockwise` and `trackColor` options are all there to be
  combined; `expired-000-muted` is `{ progress: 1, mutedHands: true }`.
