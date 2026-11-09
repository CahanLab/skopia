# .obs column merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pool same-labelled `.obs` columns in a combine by default, pool differently named ones on request, and merge columns of a loaded dataset from the .obs manager.

**Architecture:** Backend first: the combine suggestion rule and `obs_merge_into` live beside the existing policy code in `adaptor.py`; `merge_obs_columns` joins the other .obs manager methods and gets a codegen entry. Frontend: `lib/combineColumns.ts` owns the `same:<target>` policy encoding and the request split; `lib/obsManager.ts` owns the default merged name; the two components wire them.

**Tech Stack:** FastAPI + pandas (backend, pytest), React + Zustand (frontend, vitest for libs, Playwright MCP for the browser check).

**Spec:** `docs/superpowers/specs/2026-11-04-obs-column-merge-design.md`

## Global Constraints

- Jaccard threshold for "shared labels" is 0.5; numeric-looking vocabularies (`^-?\d+(\.\d+)?$`) never merge by default.
- Default for a cross-name merge stays `separate`; the hint names the candidate.
- Every `_log_action` has a codegen REGISTRY entry (`test_codegen` pins it).
- Route errors: `ValueError → 400`, `KeyError → 404`.
- No new frontend lint; `npx tsc --noEmit` and `npx vitest run` must pass.

## Review Focus

1. A label column whose values are all NaN in one dataset: `labels` must not divide by zero; suggestion falls back to `separate` (Task 1 test).
2. `obs_merge_into` with a source that the user also set to `drop`: the alias wins and the column is merged (Task 2 test pins the recorded policy).
3. `same:<target>` left in the frontend policy after the target's file is removed: `seedPolicy` must drop it, since the backend rejects an unknown target (Task 3 test).
4. Merging categorical columns whose categories are integers (`pd.Categorical([1, 2])`) with a string column: labels class, categories compared as strings (Task 5 test).
5. `.obs` manager merge with the colour-by column as a dropped source: colour-by must reset (Task 6, `forgetObsColumn`).

---

### Task 1: Combine suggests `merge` for same-named columns with shared labels

**Files:**
- Modify: `backend/skopia/adaptor.py` (`_suggest_obs_policy`, `describe_combine_columns`, `_resolve_policy`)
- Test: `backend/tests/test_combine_columns.py`

**Interfaces:**
- Produces: `_label_overlap(frames, name) -> dict | None` returning `{'shared': int, 'union': int, 'numeric': bool}` for a `category`/`string` column held by >= 2 frames, else `None`; `_suggest_obs_policy(datasets, kind, n_unique, overlap=None)`; describe entries gain `labels` (the overlap dict without `numeric`, or `None`).

- [ ] Step 1: Tests (RED): `test_a_label_shared_by_every_dataset_defaults_to_merge` (cell types `a,b,c` in both → `suggested == 'merge'`, `labels == {'shared': 3, 'union': 3}`, reason contains `same 3 labels`); `test_a_label_mostly_shared_defaults_to_merge` (`a,b,c` vs `a,b,d` → merge, reason `2 of 4 labels shared`); `test_numeric_looking_labels_stay_separate` (`'0','1','2'` both → separate, reason mentions `numbers`); `test_a_label_with_little_overlap_stays_separate` (`a,b` vs `c,d`); `test_an_all_missing_label_column_stays_separate` (one dataset all NaN); `test_resolve_policy_uses_the_same_rule` (combine with no policy pools the shared cell types into one column).
- [ ] Step 2: Run `pytest tests/test_combine_columns.py -q` → the new tests fail on `suggested`/`labels`.
- [ ] Step 3: Implement `_label_overlap`, thread `overlap` through `_suggest_obs_policy` and `_resolve_policy`; share one helper between describe and resolve so they cannot drift.
- [ ] Step 4: Run the file → PASS. Commit `feat(combine): pool same-named label columns that share a vocabulary`.

### Task 2: `obs_merge_into` pools differently named columns

**Files:**
- Modify: `backend/skopia/adaptor.py` (`describe_combine_columns`, `combine_datasets`), `backend/skopia/api/routes.py` (`CombineSpatialRequest.obs_merge_into: dict[str, str] = {}`)
- Test: `backend/tests/test_combine_columns.py`

**Interfaces:**
- Produces: `combine_datasets(..., obs_merge_into: dict[str, str] | None = None)`; describe entries gain `same_as: list[{name, shared, union}]`; `uns['skopia_combine']['obs_merge_into']`.

- [ ] Step 1: Tests (RED): `test_merge_into_pools_two_names_into_the_target` (`celltype` in A, `cell_type` in B → one `cell_type` column, every cell valued, categories union in order, uns records the mapping, resolved policy for both is `merge`); `test_merge_into_overrides_a_drop_on_the_source`; `test_merge_into_refuses_unknown_self_chain_and_shared_holders` (four `pytest.raises(ValueError)` with message fragments); `test_describe_names_a_same_as_candidate` (`same_as[0]['name'] == 'cell_type'`, reason mentions `looks like`); `test_same_as_skips_numeric_vocabularies`; `test_combine_route_accepts_obs_merge_into` and a 400 for a chain.
- [ ] Step 2: Run → FAIL (unexpected kwarg / KeyError).
- [ ] Step 3: Implement `_resolve_merge_into(frames, labels, merge_into, resolved) -> dict[str, str]` validating per spec, then in `combine_datasets` map `merged_obs[source] = merged_obs[target]`; add `same_as` in describe reusing `_label_overlap` across disjoint holders.
- [ ] Step 4: Run file → PASS. Commit `feat(combine): merge differently named columns with obs_merge_into`.

### Task 3: Frontend policy encoding

**Files:**
- Modify: `frontend/src/lib/combineColumns.ts`
- Test: `frontend/src/lib/combineColumns.test.ts`

**Interfaces:**
- Produces: `ColumnInfo.labels?: {shared, union} | null`, `ColumnInfo.same_as?: {name, shared, union}[]`; `splitObsPolicy(policy) -> {obs_policy, obs_merge_into}`; `mergeTargets(policy) -> Record<targetName, sourceName[]>`; `seedPolicy` drops a `same:` whose target is no longer offered.

- [ ] Step 1: Tests (RED) for the three functions and `summarizePolicy` counting `same:` as merged.
- [ ] Step 2: `npx vitest run src/lib/combineColumns.test.ts` → FAIL.
- [ ] Step 3: Implement.
- [ ] Step 4: PASS. Commit `feat(combine): same-as policy encoding`.

### Task 4: Picker and request

**Files:**
- Modify: `frontend/src/components/CombineColumnsPanel.tsx`, `frontend/src/App.tsx` (`handleCombineDatasets` body)

- [ ] Step 1: Add the **Same as** optgroup (likely matches first with `k of n labels`), the disabled target select, the `labels` count in the row and reason.
- [ ] Step 2: `App.tsx` sends `...splitObsPolicy(combineObsPolicy)`.
- [ ] Step 3: `npx tsc --noEmit` → clean. Commit `feat(combine): same-as picker`.

### Task 5: `merge_obs_columns` on the adaptor, route, codegen

**Files:**
- Modify: `backend/skopia/adaptor.py` (after `duplicate_obs_column`), `backend/skopia/api/routes.py` (after duplicate route), `backend/skopia/codegen.py`
- Test: `backend/tests/test_obs_merge_columns.py` (new, self-contained)

**Interfaces:**
- Produces: `DataAdaptor.merge_obs_columns(columns: list[str], new_name: str, keep_sources: bool = True) -> dict` with keys `new_name, columns, kind, n_conflicts, n_missing, dropped`; `POST /obs/merge_columns`.

- [ ] Step 1: Tests (RED): coalesce order and categories; numeric → float; boolean ok / refused when missing; mixed kinds refused; subset column refused; fewer than two or duplicate names refused; existing new name refused; `keep_sources=False` drops sources and palettes; integer-categorical + string merge compares as strings; notebook replay equals the adaptor result (`translate` + exec, like `test_the_notebook_replays_the_rename_with_colours`); route 200 / 400 / 404.
- [ ] Step 2: Run → FAIL (AttributeError).
- [ ] Step 3: Implement adaptor method, route, codegen `merge_obs_columns` EXACT entry.
- [ ] Step 4: Run file + `tests/test_codegen.py` → PASS. Commit `feat(obs): merge columns from the .obs manager`.

### Task 6: .obs manager UI

**Files:**
- Modify: `frontend/src/lib/obsManager.ts` (`mergeDefaultName(names: string[]) -> string`), `frontend/src/hooks/useData.ts` (`mergeObsColumns`), `frontend/src/components/ObsManagerModal.tsx`
- Test: `frontend/src/lib/obsManager.test.ts` (exists? else create)

- [ ] Step 1: Tests (RED) for `mergeDefaultName`: `['cell_type__A','cell_type__B'] → 'cell_type'`; `['leiden_1','leiden_2'] → 'leiden'`; `['a','b'] → 'merged'`; `['cell_type','cell_type_copy'] → 'cell_type'` is taken so the caller appends `_merged`? No: return raw prefix; the modal applies `newNameProblem` and falls back to `<prefix>_merged`.
- [ ] Step 2: vitest FAIL → implement → PASS.
- [ ] Step 3: Modal: Merge button when `selected.size >= 2`; merge row with name input, order line, keep-sources checkbox, Merge; on success `forgetObsColumn` for dropped sources, reset colour-by if dropped, clear selection, status with conflicts.
- [ ] Step 4: `npx tsc --noEmit`. Commit `feat(obs): Merge in the .obs manager`.

### Task 7: Docs and browser verification

- [ ] CHANGELOG `[Unreleased]` entries (combine defaults + same-as; .obs manager Merge). CLAUDE.md note in the main repo (local file) under the `.obs` manager / combine paragraphs.
- [ ] Isolated stack: backend `:8100`, Vite `:5273`. Combine two h5ads written from the Grosswendt demo with `cell_type` in one and `celltype` in the other; check the picker suggests merge for the shared one and offers same-as; combine and confirm one column. Then .obs manager: tick two split columns, Merge, confirm the column and the history step.
- [ ] Full suites: `pixi run -e dev pytest -q` from the worktree backend, `npx vitest run`, `npx tsc --noEmit`.
