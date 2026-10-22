---
name: change-map
description: Plans and signs off architecture changes before code is written, then checks the result. Use it for every new feature, change to a feature, or refactoring - before building anything. Write the implementation plan, add the change-manifest, get the architecture items approved, build, finalize. Also /change-map (status) and /change-map check (architecture audit and map).
when_to_use: The user asks to build, add, implement or change a feature, page, screen, route, API endpoint, table or integration; to refactor, restructure, split, merge, rename or move code, modules or folders; to add a package or environment variable; or to "fix the architecture findings". German - "bau", "füge hinzu", "neue Seite", "neue Tabelle", "Feature umsetzen", "ändere", "refaktoriere", "umbauen", "Code verschieben", "behebe die Architektur-Findings". Also when a plan was approved in plan mode, when a change-map hook denies an edit or reports an import, and when asked about the architecture or what changed outside the workflow. Skip typos, small bug fixes, tests and docs inside one unit.
argument-hint: "[check]"
---

# change-map

change-map shows what a plan changes in the architecture, gets those changes signed off by the user before anything is built, and compares plan and result afterwards. **You write claims** (the manifest, reasons, amendments). **The commands produce facts** (findings, the map, approvals, the report). Never state a fact a command didn't give you, and never write a record file yourself.

Run every command from the project root as `npx change-map …`. In the commands below, `<plan>` is the implementation plan's path and `<slug>` the manifest's `slug`.

**Never redirect or hide change-map's output** (no `>/dev/null`, `2>&1`, `| tail`, `| head`): read what each command prints. Hooks show the user the map and the report on their own; you don't open files or pass flags for that.

## When to use

When to use change-map: use the change-map workflow for every new feature, change to a feature, or refactoring. Skip it only for a change that stays inside one unit and adds no source file, dependency, table, package, environment key or export: typos, small bug fixes, tests, docs.

The user doesn't have to mention change-map. A plain request ("add a wishlist page", "move the cart code into its own module", "bau eine neue Seite für …") is enough. If you're unsure whether the rule applies, apply it: with no architecture changes the workflow costs one command and one line (step 3).

The session briefing (added at session start) already shows the units, allowed dependencies, entry points, tables, open findings and any active plan. Use it while planning; don't re-derive the architecture by reading the rules config (e.g. the eslint config).

Entry points:
- **Plan workflow**, steps 0–7: a feature or refactoring was asked for, a plan was written or approved in plan mode, or you are implementing or finishing one.
- **`/change-map`** typed by the user (below).
- **Audit** (at the end): "check the architecture", "what changed outside the workflow", no plan.

## Local mode

If the session briefing says **Local mode** (the project has `.change-map/config.json` instead of `change-map.config.json`), the user is trying change-map on their own machine, and change-map must leave no trace in the repository. Everything below applies, with these differences:

- **Commands**: run change-map as the briefing's "Run change-map as" line says, wherever this skill says `npx change-map`. There is no change-map in `package.json`.
- **Manifest**: never edit the plan file. Write the manifest (exactly the YAML that would go into the `change-manifest` block, without the fences) to `.change-map/plans/<slug>.yaml`, with `plan: <plan>` as its first line. Amendments go into that file too. Pass either the plan file or the sidecar as `--plan`; both work.
- **Files**: records, maps and caches live in `.change-map/` (excluded from git). Never add a change-map file to git, never add a change-map block to `CLAUDE.md`, never add change-map to `package.json`.
- **Commit** (step 7): commit the code only; there is no record folder to commit.
- The user switches the project to shared mode with `change-map share`; run it only when they ask.

## /change-map (typed by the user)

- `/change-map` with no arguments: run `npx change-map status` and relay its output verbatim. Nothing else.
- `/change-map check`: run `npx change-map review --audit --open` and relay as in the audit section.
- Anything else after `/change-map` (e.g. `/change-map add a wishlist`): a request to plan that change with this workflow.

## 0. Preflight (once per session)

- Neither `change-map.config.json` nor `.change-map/config.json` (local mode) in the project: tell the user the project isn't set up for change-map and suggest `npx change-map init`, which shows a proposal first. Stop here. Never run `init --write` without the user's OK.
- Run `npx change-map doctor` and read its `Workflow` block.
  - **W4** (approval hooks) missing: answers can't be recorded. Say so and stop.
  - **W3** (gate) missing: say so, and continue only if the user agrees.
  - **W6** (report hooks) missing: the user may not get the map and the report. Say so and suggest `npx change-map report install-hooks`; continue.
  - P-requirement gaps: mention them, don't fix them.

## 1. Plan: add the change manifest

Planning runs as usual (brainstorming, design spec, implementation plan, all in the chat). Nothing is built before step 4 is done.

- **Superpowers**: right after `writing-plans` saved the plan. Do steps 1–4 first, and offer its execution choice only after the sign-off is complete.
- **Plan mode**: when the user approves a plan, a hook saves it to the plan folder (e.g. `docs/plans/<date>-<slug>.md`) and tells you the path. Approving in plan mode is not the architecture sign-off: continue here with that file. Never delete it.
- **No plan yet** (the user just asked for a feature): write the implementation plan yourself to `docs/plans/<YYYY-MM-DD>-<slug>.md` (or the project's first plan folder), with the files to touch and the steps, and discuss it in the chat as usual.

Append a `## Change manifest` section to the plan file with exactly one fenced `change-manifest` block (YAML). The example is from a Next.js project (adapter `nextjs-eslint`, rules in an eslint config); paths and sides follow your project's stack:

````markdown
## Change manifest

```change-manifest
version: 1
title: Wishlist
slug: wishlist
summary: Signed-in customers can save products to a wishlist and find them again later. Shopping, the cart and checkout work as before.
why: Customers ask for a way to remember products without putting them in the cart.
unchanged: Nothing changes for customers who don't use the wishlist. The cart, checkout and product pages stay as they are.
steps:
  - title: Add a wishlist part
    text: A new part, shop/wishlist, keeps each customer's saved products. It shows them with the catalog's product data.
    units: [shop/wishlist, shop/catalog]
files:
  - path: src/shop/wishlist/index.ts
    change: new
    purpose: Public surface of the wishlist feature.
  - path: src/shop/wishlist/wishlist.ts
    change: new
    purpose: Add, remove and list wishlist entries per user.
  - path: eslint/units.mjs
    change: changed
    purpose: Dependency rules for shop/wishlist.
signoff:
  - kind: unit-new
    subject: { unit: shop/wishlist }
    reason: Wishlists have their own state and page, separate from the cart.
    plain: A new box for everything about wishlists.
  - kind: edge-new
    subject: { from: shop/wishlist, to: shop/catalog }
    reason: The wishlist shows catalog products.
```
````

- **files**: every file the plan creates, changes or deletes (`new` / `changed` / `deleted`), each with a one-line purpose. Give paths only; units are derived from them.
- **signoff**: one item for every architecture change, each with a reason the user can judge:
  - new units, unit renames or moves
  - new dependencies between units: declare them between the parts the rules name (e.g. `battery-diff -> notifications`); that covers imports from the parts inside (`battery-diff/comparison`)
  - allowed dependencies that become forbidden (rules tightened)
  - new tables or changed ownership
  - new or removed public exports
  - moves between the sides of a unit's public surface (Next.js: client/server)
  - new packages (e.g. npm)
  - new environment variables or config keys
  - permission or auth changes
  - accepted findings

  Kinds and subject shapes: [manifest.md](manifest.md).
- **expectedEdges** / **removedEdges**: dependencies the rules already allow (no sign-off) and dependencies that go away. Never make an allowed dependency an `edge-new` item, and never add an export item for an export that only moves to another file: `review` rejects both, so the user is only asked what needs a decision.
- **Story**: `summary`, `why`, `unchanged` and `steps` (each with the `units` its changes touch). The map's overview is built from them; `review` warns when a plan with sign-off items has none.
- The manifest describes the plan, nothing more. If writing it shows a gap in the plan (e.g. a package the plan didn't mention), fix the plan with the user first.

### Write for the user

The person who reads the map and answers the questions may not read code. Everything you write in the manifest (`summary`, `why`, `unchanged`, `steps`, `plain`, file purposes, sign-off reasons) follows these rules:

- Short sentences, everyday words.
- Explain every name once: "billing/invoices, the new part that makes invoices".
- No code identifiers unless they are needed to tell things apart; then say what they are ("the formatInvoice function").
- Say what users will notice and what they won't. `summary` says both; `unchanged` says what stays the same.
- One step per thing the user can picture ("Move the invoice code"), not per file or commit. `before` / `after` lines are short ("orders ⇄ billing", "orders → billing only").
- `plain` is one sentence for a non-developer, next to the subject the question already names. The reason says why, in words the user can judge.
- `plain` and the reason end up in the sign-off question, and the reader may not be a native English speaker. Write full sentences with a verb, at most about 15 words each, one idea per sentence. No semicolons, no fragments ("Needed for …", "A shared way to …"), no idioms. `plain` says what the thing does ("It shows which products had an open issue on a given day."); the reason says what the user gets from it ("The score and its 7-day trend need it. It reads the issue history, so reopened issues are counted correctly.").

## 2. Check and fix (loop)

```
npx change-map review --plan <plan>
```

- Exit 0: no errors.
- Exit 1: errors, listed with their codes and messages.
- Exit 2: the manifest doesn't parse or validate (message on stderr).

Fix **declarations only**:
- a missing `unit-new`
- a missing item for a guarded file
- a wrong path or kind
- a duplicate item
- an `edge-new` item for a dependency that's already allowed (`edge-already-allowed`: move it to `expectedEdges`)
- an export item for an export that only moves to another file (`export-unchanged`: remove it)
- an `edge-new` item another one already covers (`edge-covered-by-item`: remove it)
- invalid YAML

Never change the design to make the check pass: a different unit layout, dropping a dependency the plan needs, accepting a finding. Those decisions belong to the user.

**Stop after 3 runs** that still end in exit 1 or 2, or as soon as only a design change would help. Show the user the remaining findings verbatim and say what you tried. They decide: change the plan, or accept a finding (a `finding-accepted` item, asked like any other).

Warnings (`unit-without-rules`, `unmapped-rule`, `existing-violation`) don't block. Mention them once when you show the map.

## 3. Show the map

`review` writes the map on every run to `.change-map/<slug>.html` (gitignored working files). It opens on an overview in plain words (summary, steps, what the user decides, what needs no decision) with a numbered change list as the second tab.

**You don't open the map.** When you ask the sign-off question (step 4), a hook renders the map again if it is older than the plan, opens it in the user's browser and shows the user its path (in a cloud session, only the path). Whether it opens is the config's `openMap`, not a flag. If the user asks to see the map at another time, run `npx change-map review --plan <plan> --open` and give the path. If you have a tool that sends files to the user, send the map file too.

**No sign-off items** (`review` prints `No sign-off items.`): don't show the map and don't ask anything. Run `npx change-map signoff start --plan <plan>` (it opens the record, which is approved right away), tell the user one line, `No architecture changes to sign off. Map: .change-map/<slug>.html`, and go to step 5.

## 4. Sign-off

```
npx change-map signoff start --plan <plan>
```

It prints `{ "record", "questions": […], "approved", "total" }`. `questions` holds one question: "Do you approve all N decisions for "<title>"?", with the answers **Approve all** and **Not yet**. The user reads and clicks through the decisions in the map; don't list them again in the chat.

1. Tell the user in one line: how many decisions, and that the map (`.change-map/<slug>.html`, opened by a hook when you ask) shows each one before they answer.
2. Call `AskUserQuestion` with **exactly** that `questions` array. A hook recognises the question by its two options and opens the map for the user. Never reword, split it into one question per decision, or pre-fill anything. A hook denies anything else. If it does, run `signoff start` again and use its new output.
3. **After the call** a hook adds a line to your context: `change-map sign-off, <record>: recorded approve for <items>. Not approved yet: …. Record status: …`, or `…: not approved, nothing recorded. The user answered …`. A `NOT recorded: …` line means: ask again.
   - **No such line = the answer was NOT recorded.** Hooks aren't installed, or change-map can't run. Don't treat the chat answer as approval and never write `approvals.json`. Tell the user, run `npx change-map doctor` to show why, and stop.

**`Record status: approved`** → step 5.

**Not approved** ("Not yet" or free text) → talk, then revise:
1. Ask in the chat what the user wants to change (a plain question, not `AskUserQuestion`), unless their answer already says it. Talk it through until it is clear which decisions change and how.
2. Revise the plan **and** the manifest together. Remove or change a decision together with the design behind it. Never ask the same plan again unchanged, unless the user wants to reconsider.
3. Run step 2 until clean, then step 3. **Run `review` before `signoff start`**: the record still holds the previous round, so the map highlights what changed since then. `signoff start` replaces it with the new round.
4. Run `signoff start` again and ask its one question. Decisions approved in an earlier round aren't asked again.

Nothing is built until the record status is `approved`.

## 5. Implement

Implement with the usual workflow (e.g. Superpowers' `executing-plans` or `subagent-driven-development`). Hooks gate architecture files and check imports after every edit, also for subagents. When you dispatch implementer subagents, add to their prompt: *"If a change-map hook denies an edit or reports an import, don't work around it. Stop and report the message back."*

If the briefing names `change-map add` / `allow` / `forbid`, create approved new parts and change approved dependencies with them instead of editing the rules by hand; they check the sign-off themselves. Never pass `--unapproved` (it is for people working without a plan).

### A new sign-off item: stop, amend, ask

When this happens:
- a hook denies an edit to an architecture-relevant file
- a forbidden import is needed for the change
- you are about to add something the step 1 list names (a package, env key, export, table, unit, …) that the approved plan doesn't contain

Then:
1. Don't make the change. Tell the user what came up and why.
2. Append an amendment to the manifest. Add `amendments:` at the end of the block if it isn't there yet; get the time from `date -u +%Y-%m-%dT%H:%M:%SZ`:

   ```yaml
   amendments:
     - id: A1                      # next free number
       at: 2026-10-16T14:03:00Z
       on: signoff
       action: add
       item:
         kind: package-new
         subject: { name: zod, dev: false }
         reason: Validates the wishlist API input.
       reason: Input validation turned out to need a schema library.
   ```

3. Run `npx change-map review --plan <plan>` (step 2 rules), then `npx change-map signoff start --plan <plan>`, and ask (step 4).
4. Approved: continue. Items approved earlier keep working meanwhile. Not approved: talk with the user, then find a way without it or change it as they say.

A forbidden import with a plain fix (go through the unit's entry point) is just fixed; no amendment.

### A plain file deviation: log it, don't ask

A file the manifest doesn't list, a planned file that isn't needed, or another change type than planned: append an `on: file` amendment with a reason. Use `action: add` with the file entry, `remove` with `target: <path>`, or `change` with `target` and the new entry. Don't ask the user about these.

### Before finalizing

```
npx change-map review --plan <plan> --implementation
```

This prints the implementation check and the file deviations, with amendment stubs. Never pass `--base` unless the user gives you a commit, and **never build a base commit yourself** (`git commit-tree`, `git stash create`, a temporary index, a throwaway branch). When an earlier step is still uncommitted, `finalize` saved a snapshot of it, and the next plan's `review --implementation` and `finalize` start from it on their own (they print `Base: change-map's snapshot …`). A `WARNING:` about the base goes to the user as it is. Act on what it prints:
- **File deviations**: fill in each stub's purpose and reason (replace every `TODO`) and append the stubs.
- `undeclared-signoff`: stop, amend, ask (above). If it names a dependency from or to a part inside a planned use (the plan has `a -> b`, it reports `a/x -> b`), that is a bug in change-map, not a reason for an amendment: tell the user and report it.
- `introduced-violation`, `entry-point-bypass`: fix the code.
- `unapproved-item`, `rejected-item`: back to step 4.

Run it again until it exits 0.

## 6. Finalize and report

```
npx change-map finalize --plan <plan>
```

Run it as its own Bash command, output not redirected. **A hook shows the user the report verbatim and opens the record's map** (the report is read from the record, so the user gets it whatever happens to the output), and adds a line to your context saying so. Don't repeat the report in the chat; refer to it ("The report is above"). A Stop hook won't let you end the turn while an approved plan's code changed without `finalize`, or while a report wasn't shown: do what its reason says. If you stopped on purpose (e.g. to ask the user something mid-implementation), say so in one line and end the turn again.

Every missing item in the report comes with what change-map found. If it lists "Missing items without an explanation", record one short note per item: why it is missing, in words the user can judge (at most 300 characters). Copy the ref from the list:

```
npx change-map explain --plan <plan> <ref> "<one or two sentences>"
```

This is your claim, shown on the map as "Claude's explanation"; say only what you know. Skip an item you can't explain. Each `explain` prints the updated report, and the hook shows it to the user again. Then, without repeating the report: for each divergence, absence or violation it lists, say in one sentence what you would do, and ask. Don't add facts to it.

**No hook line after `finalize`** (the report hooks aren't installed, W6): post the latest report **verbatim** in a code block, then the map path (and send the file if you can).

## 7. Commit

The record folder (`docs/changes/<date>-<slug>/`) belongs in the same commit as the code. Include it when you commit; if the user commits, remind them. Never commit `.change-map/`.

## Audit (no plan)

Use this for "check the architecture", "audit the architecture", "what changed outside the workflow", "show me the architecture map", or to get oriented before planning in an unfamiliar repository.

```
npx change-map review --audit --open
```

It checks the code as it is: rule violations, units without rules, and changes since the newest final record that no record covers (`undeclared-change`). It renders `.change-map/audit.html`. Relay the summary and the map path. Change nothing on your own. Offer next steps: fix a violation, or plan a change that declares the drift. The audit never blocks anything.

## Never

- Edit `approvals.json`, `record.json` or `plan.md` inside `docs/changes/`. Only change-map writes them.
- Answer, pre-fill or reword a sign-off question.
- Redirect change-map's output to `/dev/null` or cut it off, or build base commits yourself (`commit-tree`, `stash create`).
- Build before the record is `approved`, or work around a hook's denial.
