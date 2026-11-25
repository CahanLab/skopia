# Panels redesign

Date: 2026-11-25. Approved by Patrick in conversation ("I agree with your
recommendations/plan"); figure saving was moved to `docs/ROADMAP.md`.

## Intent

The Panels tab (the multi-panel embedding compositor, `centerPanelView ===
'figure'`, `FigureBuilder` + `FigurePanel`) takes too long to turn into a good
figure. Getting in needs a detour through the Cells pane, each panel is
coloured with its own small pickers instead of the Genes and Cells panes
everyone already uses, the overlay is a per-panel checkbox that imports the
Embedding tab's highlight layers, titles are "Panel N" until typed into a
sidebar box, and a panel coloured by clusters has no labels.

Success: open Panels, click a panel, click genes / sets / a Cells-pane
*Color* button, and have titled, labelled panels with one shared overlay,
without visiting a sidebar picker.

## Goals

1. **No create step.** Opening Panels with no figure makes a 2×2 figure of
   every cell on the current embedding. *Crop to selection* (and *All cells*
   to undo it) lives in the Panels toolbar. The Cells pane's *Create figure*
   button goes; the empty state stops claiming a selection is required.
2. **Colour from the main panes.** While Panels is showing, a gene click, a
   set's colour button, bivariate colouring, a score-matrix column, and a
   Cells-pane *Color* button colour the active panel instead of the
   Embedding tab. Panel 1 starts active and outlined. Expression values are
   computed as Display computes them (transform, clip, layer, per-gene
   normalization, aggregation, UCell).
3. **The figure owns its overlay.** One list of highlight layers on the
   figure, shared by every panel; each panel has a *show overlay* switch (on
   by default). While Panels is showing, the Genes pane's 🖍 tools and the
   Genes → Color overlay list edit the figure's layers. *Copy from Embedding*
   seeds them from the dataset's layers.
4. **Titles.** A panel's title is the gene, set, column or "A vs B" of its
   colouring and follows it until the user edits it. Click the title on the
   panel to edit it in place; clearing it returns to the automatic title.
5. **Category labels.** A panel coloured by a category column gets *labels on
   plot* and a font size, placed by `lib/labelLayout` at per-category median
   centroids (the Embedding tab's rule, moved to a shared function), and
   drawn into the PNG export.
6. **Bugs on the way.** Points draw at the Embedding tab's radius (they were
   half); a new figure takes background, point size and opacity from the
   current Display settings; a figure records its dataset slot, fetches from
   it, and says so when the active dataset differs (colouring is routed only
   while they match).

## Non-goals

- Persisting the figure (to `uns` or as a Figures-tab kind): roadmap.
- Text annotations or colour bars in the PNG export (unchanged gaps).
- A category legend per panel.
- Making the Genes pane's "current colouring" indicators follow the active
  panel; they keep describing the Embedding tab.

## Approaches considered for routing colour

- **Intercept the actions (chosen).** `useDataActions` colour functions and
  the store's highlight-layer actions check one predicate, "Panels is showing
  with a figure on the active dataset", and write to the figure instead.
  The Embedding's own colour state is never touched.
- **Bind the global colour state to the active panel.** Load the panel's
  colouring into the dataset's colour fields on activation and write changes
  back. Rejected: it rewrites per-dataset state (`DatasetState`,
  `syncFlatFields`) on every panel click and must restore it on every exit,
  which is where the app has already had wrong-dataset bugs.

## Design

- `store.ts`: `Figure` gains `slot`, `overlayLayers`, `activePanelId`;
  `FigurePanel` gains `titleEdited`, `genesDown`, `scoreSource`,
  `bivariateGenes1/2` + labels, `showLabels`, `labelFontSize`, and
  `showHighlightOverlay` defaults on; `expressionTransform` goes (Display
  decides). `colorFigurePanel(id, spec)` applies a colour spec and the
  automatic title. `addHighlightLayer` / `update…` / `remove…` /
  `clearAllHighlights` route to the figure under the predicate.
- `lib/figurePanels.ts` (pure, tested): the predicate and the editable layer
  list, colour specs per source, automatic titles, the fetch request for a
  panel from its spec + Display settings, and category centroids.
- `hooks/useData.ts`: each colour action returns early through the panel
  route; `nextHighlightColor` reads the editable list.
- `GenePanel` / `CellPanel`: read highlight layers through the editable-list
  selector.
- `FigureBuilder`: auto-create, crop / all cells, active panel in the store,
  overlay section, label controls, slot notice; drops the transform picker.
- `FigurePanel`: requests from `lib/figurePanels`, figure overlay, radius,
  inline title editing, label overlay (`data-panel-labels`).
- `utils/exportFigure.ts`: draws the label overlay's text.

## Left to the builder

Exact control layout in the sidebar, the hint text, and whether the manual
colour pickers stay as a fallback (they may: they are the only way to set
"none" or to colour without the panes).
