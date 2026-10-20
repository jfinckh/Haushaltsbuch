# Change manifest reference

One fenced block with the info string `change-manifest` per plan, YAML inside. `npx change-map review --plan <plan>` validates it and says what's wrong.

```change-manifest
version: 1
title: <short title>
slug: <kebab-case, used in the record folder docs/changes/<date>-<slug>/>
summary: <2-3 plain sentences: what happens, and what stays the same for users>
why: <the problem this solves, without jargon>
unchanged: <what users and the other parts won't notice>
steps:                 # the plan step by step, in plain words
  - title: <short>
    text: <1-3 short sentences>
    units: [<unit>, …]  # the units this step's changes touch
    before: [<"Today" line>]   # optional
    after: [<"After" line>]    # optional
files:
  - path: <repo-relative path>
    change: new | changed | deleted
    purpose: <one line: what changes in this file>
signoff:
  - kind: <kind>
    subject: { … }     # depends on the kind, see below
    reason: <why, in words the user can judge>
    plain: <optional: one sentence for a non-developer>
expectedEdges:         # optional: dependencies the rules already allow, no sign-off
  - { from: <unit>, to: <unit>, plain: <optional> }
removedEdges:          # optional: dependencies that go away, no sign-off
  - { from: <unit>, to: <unit>, plain: <optional> }
amendments:            # only during implementation, append-only
  - …
```

Unit IDs are folder paths relative to the unit's declared root, e.g. `shop/cart` for `src/shop/cart` with root `src`. The repository root is `.`. `change-map.config.json` says which folders are units.

## Sign-off kinds

The subject identifies *what* changes. Changing it after an answer makes that answer stale and the item is asked again. The reason can be reworded freely.

| Kind | Subject | Use for |
| --- | --- | --- |
| `unit-new` | `{ unit: shop/wishlist }` | a new unit folder |
| `unit-rename` | `{ from: shop/basket, to: shop/cart }` | renaming or moving a unit |
| `edge-new` | `{ from: shop/wishlist, to: shop/catalog }` | a new dependency: `from` imports `to` (any level) |
| `edge-remove` | `{ from: shop/cart, to: legacy }` | tightening the rules: a dependency the rules allow becomes forbidden (name the pair as the rules allow it) |
| `table-new` | `{ table: wishlistEntry, owner: shop/wishlist }` | a new table, owned by the unit that defines it |
| `table-owner-change` | `{ table: ledgerEntry, from: billing/invoices, to: billing/payments }` | moving a table's definition to another unit |
| `export-add` | `{ unit: shop, side: client, name: WishlistButton }` | a new export from a unit's entry point; the sides come from the adapter (Next.js: `client`, e.g. `index.ts`, and `server`, e.g. `server.ts`) |
| `export-remove` | `{ unit: accounts, side: client, name: legacyLookup }` | removing an export from an entry point |
| `side-move` | `{ file: src/shop/cart/total.ts, from: client, to: server }` | moving code between two sides of a unit (Next.js: client/server) |
| `package-new` | `{ name: zod, dev: false }` | a new package, e.g. from npm (`dev: true` for a dev dependency) |
| `config-key-new` | `{ key: WISHLIST_LIMIT }` | a new environment variable or config key |
| `permission-change` | `{ permission: wishlist:share, change: add }` | permission or auth changes (`add`, `remove`, `modify`) |
| `finding-accepted` | `{ code: unit-without-rules, ref: docs }` | a check finding the user decided to accept (`ref`: the element the finding names) |

Hints:
- A new unit usually comes with `edge-new` items for what it uses and what uses it. The rules config (e.g. the eslint config, or the files it imports) changes too: list it in `files`.
- An edge between a unit and its own ancestor or descendant is always allowed: no item. An item for an edge the rules already allow is an error (`edge-already-allowed`): move it to `expectedEdges`.
- Moving the code behind an export to another file (same name, same unit, same side, re-exported from the new file) is not an export change: no item. An `export-add` for an export that exists, or an `export-remove` + `export-add` of the same export, is an error (`export-unchanged`). Editing an entry point needs no item for that; the gate checks the exports after the edit.
- `removedEdges` lists dependencies that go away. Those whose importing files the plan all deletes are found automatically (unless the unit gets new files); list the others, e.g. when a changed file stops importing a unit. An entry that isn't a dependency now is a warning (`removed-edge-not-present`).
- `steps[].units` decide where each change appears on the map: a change belongs to the first step that names all of its units. Every unit named must exist or be created by the plan.
- `expectedEdges` lists dependencies the plan expects that the rules already allow. They need no sign-off; the map shows them dotted, so the user sees a new unit's whole picture before anything is built, and `finalize` reports whether they were built. List at least the other dependencies of every new unit. An entry the rules don't allow is an error (`expected-edge-not-allowed`): make it an `edge-new` item.
- Removing an allowed dependency from the rules (e.g. after fixing the imports that used it) needs an `edge-remove` item. `review` warns if the rules don't allow that pair now (`edge-already-forbidden`). Imports that still use it become violations.
- `review` warns when a new dependency closes a cycle (`planned-cycle`). Mention the cycle in the item's reason, or change the plan.
- Changing a guarded file (the rules config, the package manifest, env example files, table files, migrations; in a Next.js project: eslint config, `package.json`, `.env.example`, …) needs an item of a kind that justifies it. `review` reports `guarded-file-without-signoff` otherwise.
- Only add `finding-accepted` after the user said so.

## Amendments

Changes during implementation are appended under `amendments:`. Earlier entries are never edited. Each has a unique `id` (`A1`, `A2`, …), a UTC timestamp `at` (`date -u +%Y-%m-%dT%H:%M:%SZ`), `on` (`signoff` or `file`), an `action` and a `reason`.

| Action | Needs | Effect |
| --- | --- | --- |
| `add` | `item` (no `target`) | appends a new sign-off item or file entry |
| `change` | `target` + `item` | replaces the item (target: its key, e.g. `edge-new:shop/wishlist->shop/catalog`) or the file entry (target: its path) |
| `remove` | `target` (no `item`) | removes it |

Examples:

```yaml
amendments:
  - id: A1
    at: 2026-10-16T14:03:00Z
    on: signoff
    action: add
    item:
      kind: config-key-new
      subject: { key: WISHLIST_LIMIT }
      reason: The maximum list size differs per shop.
    reason: The limit turned out to be configurable per deployment.
  - id: A2
    at: 2026-10-16T14:20:00Z
    on: file
    action: add
    item:
      path: src/shop/wishlist/format.ts
      change: new
      purpose: Formats wishlist entries for display.
    reason: Formatting was split out of wishlist.ts.
  - id: A3
    at: 2026-10-16T14:25:00Z
    on: file
    action: remove
    target: src/shop/catalog/index.ts
    reason: The catalog's entry point already exported what was needed.
```

A sign-off amendment needs `npx change-map signoff start --plan <plan>` and the user's answer before you continue. A file amendment doesn't.
