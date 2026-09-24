# Destiny Trackers

Weapon and armor checklists at <https://silius01.github.io/destiny-trackers/>. Static HTML/CSS/JavaScript; no build step or application server.

## Bungie inventory scan

Open **Bungie inventory scan** in either tracker. It reads the vault plus carried and equipped items on all characters in the selected Destiny account. Cross-save uses the active membership. Postmaster items are excluded.

### Connect a personal Bungie application

At <https://www.bungie.net/en/Application>, configure the application associated with your API key:

- OAuth Client Type: **Public**.
- Permissions: **Read basic user profile**, **Read Destiny Inventory and Vault**, and **Move or equip Destiny items**. The lock endpoint requires that last permission.
- Redirect URL: `https://silius01.github.io/destiny-trackers/bungie-auth.html`
- Origin Header: `https://silius01.github.io`

Enter that application's API key and OAuth client ID in the tracker and click **Save settings** or **Connect Bungie**. Both actions remember the key and client ID in this browser's `localStorage` and automatically refill both vaults after reloads or reopening. Existing credentials in a tab's session are migrated when the connection form loads. Saved settings are never included in checklist backups or scan reports.

Sign-in happens on Bungie. No client secret is used. OAuth access tokens and pending sign-in state remain in `sessionStorage`; they are not made persistent by saving the app settings. Public OAuth clients do not receive refresh tokens; reconnect with the prefilled settings after expiry. Navigate between trackers in the same browser tab to reuse the active session. Saving different app settings does not replace the credentials bound to an existing token; **Connect Bungie** starts a fresh sign-in using the new settings.

**Disconnect** signs out of the current tab while keeping the saved API key and client ID. **Forget saved settings** removes the saved key and client ID and disconnects the current tab. Checklist progress is retained. Settings are specific to this browser and site; clearing its site data removes them.

Local HTTP and `file:` previews can use **Try example scan**. Live OAuth needs the deployed HTTPS callback. Example mode cannot save checklist results or change locks.

### Troubleshooting a missed weapon

Use **Refresh definitions & scan** to redownload Bungie's item definitions and scan again. Cached tables are matched against their current content paths; a changed file is refreshed even if Bungie's manifest version label stays the same. If a definition download takes a while, the scanner refreshes the inventory snapshot before grading it.

The **Review** section identifies missing item/perk hashes, origin or damage-type mismatches, and stale catalog mappings. Missing item definitions are listed rather than silently omitted. **Export scan report** includes the actual per-copy perk names, socket indexes, selectable-option flags, catalog match, and keeper decisions. **Export last scan report** remains available after applying locks or an operation failure, with its result and any completed lock changes. Reports contain inventory details but never your API key or OAuth token.

### Recommended rolls while reviewing copies

Expand **Review … unmatched or ambiguous copies** to compare each weapon's catalog god-roll recommendation with that physical copy. All four perk columns, the priority stat, and the origin trait appear side by side. Green checkmarks identify recommended choices available on that copy, including enhanced equivalents. Suggested mods and catalog notes appear below.

Ambiguous catalog versions are shown separately. A same-name reference with a different element or origin is explicitly flagged; it does not create a catalog mapping or authorize an automatic lock decision. Missing socket data appears as **Not confirmed**. Weapons without a catalog recommendation say so and provide a direct light.gg item lookup alongside any actual perks that could be read.

Choose **Keep (lock)** or **Don't keep (unlock)** after reviewing the comparison. Choices are per instance, and the review stays open as you select them. Click a selected choice again to clear it. These choices only change game locks when you use **Save scan & apply … lock changes**; saving the checklist alone does not apply them.

## Weapon evaluation

Each physical item is identified by its 64-bit instance ID, kept as a string. Selectable perks from that instance count; the definition's potential random-roll or crafting pools do not.

- **God:** one copy matches recommendations in all four columns and its priority/masterwork stat is confirmed.
- **Good:** that same copy matches recommended column 3 and column 4 perks.
- **Basic:** owned, below those requirements.

Keeper ranking first uses coverage of the two main perk columns (3 and 4), then the number of distinct recommended choices available across those columns on that same copy. A **3 + 1** copy outranks a **1 + 1** copy even if the latter has a better barrel, magazine or masterwork. A **3 + 0** copy cannot beat a **1 + 1** copy, because matching both main columns comes first. Only recommended, available perks count; base/enhanced spellings count once.

Equal choice counts use roll tier, total matched columns, priority stat, community popularity, existing lock, then Power and stable instance ID. God/Good/Basic labels retain the definitions above: a Good roll with more main-perk choices may be the preferred keeper over a God roll with fewer choices. The preview and exported report show the choice counts. Ranking uses this catalog's recommendations, not an independent evaluation of every build. A single keeper supplies all imported perks; perks from different copies are never combined.

The catalog predates API integration and lacks Bungie item hashes. Candidates use name, element, and origin; catalog version suffixes are handled. Ambiguous versions require an explicit mapping by item hash. Unsupported weapons remain in the review list. Crafted frames with an ambiguous priority stat are not assigned a god roll automatically.

### Lock changes

Scanning itself is read-only. **Save scan to checklist** only updates local progress. **Save scan & apply … lock changes** applies the displayed keeper/duplicate plan.

Before writes, the app checks that the preview is under five minutes old and re-reads inventory, comparing item IDs, locations, sockets, Power, and lock state. Missing or stale profile data stops the operation. A family with an unreadable copy is not unlocked.

For each reviewed family it locks the keeper, verifies that lock, then unlocks locked duplicates. A failed request stops remaining writes; partial changes are reported and require a new scan. A final read verifies the result. The only game-write endpoint in this app is `SetLockState`: there is no dismantle, transfer, equip, or plug-insertion implementation. Unlocking makes a duplicate available for manual dismantling in game.

### Lock verification and retained results

Both vaults distinguish accepted change requests from verified lock states. Keepers without duplicate unlocks are verified together in the batch inventory checks. For a keeper with duplicates to unlock, individual-item checks retry at 0.5, 1, and 2 seconds and require the exact instance ID and locked bit. If these reads remain unconfirmed, duplicate unlocks are deferred while other keepers are processed.

The batch then checks inventory together, with bounded waits of 1, 2, 4, 8, 15, and 15 seconds (45 seconds total, excluding request time). A current inventory confirming a deferred keeper can authorize its duplicate unlocks only after every affected item family is revalidated, accounting for this batch's accepted writes. Expired verification snapshots are ignored while waiting and cannot authorize writes. Missing/invalid timing, API errors, account changes, and changed families remain errors; preflight freshness checks are unchanged. Writes are never automatically repeated.

If confirmation remains incomplete, the result says **Lock confirmation pending** instead of claiming those locks failed. It lists verified changes and any duplicate unlocks that were not sent, saves the checklist, and retains expected states plus timestamp observations for export. A pending lock may already have taken effect in game while the API is returning older data.

After a batch finishes with accepted changes still unconfirmed, both vaults automatically wait another **30 seconds**, then rescan current inventory once and update the verified counts. Keep the page open; the scheduled time and rescan status appear in the result. This follow-up is read-only: it never repeats lock/unlock requests or executes skipped duplicate unlocks. If the data has not updated, the result stays pending. If the read fails, the previous result is retained with a separate error. Reloading interrupts the scheduled check; use the manual check below to resume verification.

**Check current lock states** performs a read-only reconciliation of the last result, including older interrupted results, and updates the verified counts without sending any lock/unlock requests. It survives reload. Unsent changes remain incomplete and require a fresh scan; this button never executes previously skipped duplicate unlocks. A stale or wrong-account recheck cannot replace the saved result.

Private Platform API requests allow Bungie's browser-managed affinity cookies so writes and verification reads can reach the same server, following [Bungie's affinity guidance](https://github.com/Bungie-net/api/wiki/Affinitization:-benefits,-drawbacks,-how-to). Browser cookie policies still apply. OAuth token exchange and public manifest downloads do not include cookies; API endpoint restrictions and bearer-token authorization remain in place.

The last lock result is retained in this browser, separately for each vault, and remains visible after reload or another scan. It shows accepted versus planned requests, verified lock/unlock counts, skipped groups, excluded review copies, and any failure. **Export last lock result** exports these details, including the read-back observations for skipped keepers, without credentials. An interrupted attempt remains explicitly unverified. Results for a different selected Destiny account are hidden. If browser storage cannot retain the result, the app offers an export and shows the storage problem.

A checklist save failure after successful lock verification is reported separately: it no longer labels the game lock operation as failed. A verified result only covers the displayed plan; review copies excluded from the plan remain unchanged.

Every known exotic weapon receives an individual lock-only plan, even if it lacks four standard perk columns or has unreadable perk data. Its item identity must still be known, inventory must pass the existing freshness checks, and the lock must be verified. Armor combination grouping and review requirements are unchanged.

## Armor evaluation

The preview lists each archetype/tertiary group separately. If a copy prevents lock changes for the same piece, the group now names that exact instance and its rejection reason. Armor review lists every rejected instance with the archetype and base stats that were read. **Export last scan report** includes `armorCopies`: per-copy base stats, stat sockets and conditional/enabled flags, detected tertiary, selected keeper, proposed action, and blockers. These are proposed actions from the preview; `lockResult` records whether application succeeded. Reports contain no API key or OAuth token.

Matches set, slot, and Armor 3.0 archetype. Base investment stats and intrinsic armor stat plugs determine the tertiary stat; mods, tuning, and masterwork bonuses do not manufacture a new combo. Ambiguous base stats are left for review. A missing set mapping can be selected manually and saved by item hash. Exotic armor uses its name and slot to match the checklist, then joins the same archetype/tertiary keeper process.

### Exotic armor

Exotics keep one locked copy of each exact piece, class, archetype, tertiary stat, gear tier, and Artifice combination. The highest base-stat total wins; ties prefer an existing lock, then Power and stable instance ID. The preview lets you select another keeper.

Exotic class items additionally require identical perk pairs. Their two actual intrinsic trait sockets are read from the instance; potential roll pools and reusable options do not combine into an owned roll. Two perk pairs with the same stat structure remain separate. The preview, saved exotic checklist rows, and scan report show these pairs alongside the archetype and tertiary.

Exotic checkboxes continue to mean ownership. Saved scan metadata records the distinct rolls underneath each exotic. Legacy or unreadable rolls still record ownership when identifiable but need review before lock changes. Missing archetypes, ambiguous base stats, unreadable class-item perks, or unknown tiers cannot authorize duplicate unlocks; an unreadable copy pauses changes for its entire item-hash family.

Bungie documents the exotic class-item stat/perk relationship in [Update 9.0.0.1](https://www.bungie.net/7/en/News/Article/destiny_update_9_0_0_1). The fixture retains only selected public Bungie definitions and socket/stat shapes from [DIM's public profile fixture](https://github.com/DestinyItemManager/DIM/blob/master/src/testing/data/profile-2026-06-09.json), with synthetic account and instance IDs supplied by the tests.

### Armor duplicate locks

The armor preview keeps one physical copy per exact **piece (Bungie item hash), class, slot, archetype, tertiary stat, gear tier, and Artifice status**. Different tertiary rolls, classes, tiers, and Artifice versions are separate groups even when they share one checklist entry. Copies across the vault and all characters participate in the same grouping.

The suggested keeper has the highest base-stat total, with ties resolved by existing lock, then Power, then instance ID. Mods, tuning, and masterwork bonuses do not increase that ranking. The preview shows each copy's base-stat distribution and provides a **Copy to keep locked** selector; choices apply to the current preview. Run a new scan to recompute suggestions.

**Save scan & apply … lock changes** locks each selected keeper, verifies its lock, then unlocks the extra copies of that combination. Single-copy combinations are also kept locked. No armor is dismantled. Unknown class/tier data or an unreadable copy pauses lock changes for that entire item-hash family. Before writes, every copy of the affected piece is rechecked, including copies belonging to other tertiary groups; socket, gear-tier, location, Power, or lock changes require a new scan. The same stop-on-error and final verification rules used for weapons apply to armor.

The existing catalog combines classes for its set/slot/archetype checklist. The scan report shows the class, location, and physical instance IDs. All four tertiary variants are required for the existing **Farmed** marker.

## Progress and backups

### Changes since the last armor scan

Armor Vault leads with **new combinations**, **new copies** (including duplicates), and **copies no longer present** since the last completed scan. Combinations follow the existing keeper grouping, including archetype, tertiary, class, tier, Artifice, and exotic perk-pair distinctions. A duplicate can add a copy without adding a combination. Missing combinations are reported separately; unreadable rolls may move into review. Moving gear between the vault and characters, changing Power, or applying locks does not count as a new copy.

**Inventory totals and review counts** expands the overall counts. Save confirmations repeat the changes instead of the cumulative matched total. These counts describe inventory changes, not pending lock operations or unsaved checklist edits; the lock plan retains its own counts.

The first scan after this update establishes a comparison. Each completed live scan remembers a small inventory snapshot for its Destiny membership in this browser, even without saving the checklist. Reloading retains it. Failed scans and example scans do not replace it. Storage failures are shown explicitly and keep the last remembered comparison. Rematching within a preview keeps comparing against the same previous scan. Reports include `changesSinceLastScan`; no credentials are included in the snapshot.

**Save scan to checklist** changes to **Saved to checklist** after persistence succeeds, with a count beside the save controls. Errors appear in the same place. Completed scans can still be saved to the local checklist after five minutes; the five-minute limit continues to apply to game lock changes.

In Armor Vault, **View saved checklist** closes the preview and opens the matching rows. The **From scan** filter returns to those entries later. Collected tertiary stats are shown on each row; the **Farmed** checkbox remains unchecked until all four variants are collected. For example, Health and Class appear as `Health/Class (tertiary)` even though the row is not fully farmed.

Armor set titles turn gold when any entry in the set is marked Farmed or has a collected tertiary roll. This includes saved scan results and remains visible when the set is collapsed or some entries are filtered out. Clearing the last mark restores the normal title color.

Each save creates a **before last scan** backup. **Export checklist backup** saves a JSON file. Scanning replaces the prior scan contribution while preserving earlier manual marks. Manual editing detaches an entry from its imported scan metadata. The tracker is a checklist: historical manual marks are preserved even when no current inventory match is found.

Progress remains browser-local on GitHub Pages. Claude-specific database code is retained, but this feature was implemented and tested in the standalone app; the separate Claude Artifact has not been updated.

## Development

- `bungie-core.js`: pure inventory interpretation, rankings, record merging, and lock sequencing.
- `bungie-api.js`: public-client OAuth, fixed Bungie endpoint allowlist, manifest cache.
- `bungie-ui.js` / `.css`: shared scan and review dialog.
- `bungie-auth.html` / `.js`: OAuth callback, without third-party assets.
- `bungie-example.js`: synthetic sample inventory.

Run `npm test` with Node 20+. No npm packages are required. `node tests/browser/build-harness.cjs` generates ignored local browser fixtures with synthetic inventories and separate `qa-*` progress storage. Serve the directory locally, then open `tests/browser/generated-weapon.html` and `generated-armor.html`. Generated fixtures must not be deployed.

For weapon review comparisons, use `generated-weapon.html?weapon=brass&review=origin` for a catalog-version warning, `?weapon=brass&review=unknown` for the no-recommendation fallback, and `?weapon=brass&missing=1` for missing perk definitions. Browser QA verified the side-by-side table, per-copy highlights, visible unknown-data labels, separate Keep/Don't keep decisions, and the expanded review state after selection. These fixtures never call Bungie.

For lock verification, add `&lock-delay=1` to a weapon fixture for delayed keeper/final reads, `&lock-unverified=1` for stale item reads with a fresh inventory fallback, or `&lock-fail=1` for an API failure while unlocking a duplicate. `?weapon=deliverance&lock-skip=1` leaves Deliverance unconfirmed while an unrelated exotic can finish; its duplicate unlock is skipped and the partial result survives reload. `?weapon=exotic` uses exotic weapons without standard perk columns. Browser QA also verified successful retries, zero remaining changes after rescan, named API failure, exotic locks, and verified armor locks followed by a separate checklist storage failure.

For cached batch confirmation, use `generated-weapon.html?weapon=exotic&lock-cache=1&fast-waits=1`: seven unchanged inventory reads produce a pending result, then the automatic recheck sees the simulated updated locks after 30 seconds. The test-only `fast-waits` parameter skips batch polling delays; `fast-auto-wait=1` also skips the follow-up delay. Add `auto-fail=1` to fail the automatic read or `lock-cache-stuck=1` to keep returning old data. These parameters only affect the synthetic fixture, never production timing.

Synthetic browser QA verified the actual 30-second follow-up, automatic pending-to-verified results, persistence after reload, read failures retaining the accepted counts, unchanged data remaining pending without a loop, shared armor behavior, and reload interruption with manual recovery. No console errors or real inventory writes occurred during these checks.

For the armor save flow, use `generated-armor.html?armor=twisting&aged=1` to test saving a completed scan older than five minutes while lock application stays blocked. Use `?armor=twisting&storage-fail=1` to test a failed checklist write. Browser QA verified visible save feedback, the saved-row filter, persistence after reload, the expired lock rejection, and the visible storage error without a success label.

Use `generated-armor.html?armor=exotic` for exotic duplicates and different class-item perk pairs with the same stats. Add `&blocked=1` for an unreadable archetype. Browser QA verified alternate keeper selection, three simulated lock changes, zero remaining changes after rescanning, and saved roll details.

For scan comparisons, scan `generated-armor.html`, then reload with `?delta=1` to add two synthetic copies (one new combination). Rescan to verify zero additions. `?scan-fail=1` simulates a failed read, and `?history-fail=1` simulates failed history storage. Browser QA verified the first-scan message, save feedback, persisted comparisons, additions/removals, totals disclosure, and preservation of history across examples and failures. Seven comparison regression tests cover identity changes even when totals are unchanged, account isolation, damaged history, and stable results across movement/lock/Power changes.

Validation: 128 regression tests and local browser checks cover saved settings, session migration, OAuth client isolation, one-instance ranking, enhanced multi-perk Brass Attacks, missing-definition diagnostics, manifest cache invalidation, per-item selectable perks, armor base stats and duplicate grouping, keeper selection, account selection, OAuth state, exact IDs, lock ordering, save/reload, and failure paths. Lock tests cover affinity credentials, fresh-inventory fallback, changed-family rejection, an unconfirmed Deliverance protecting its duplicates while another weapon locks, and global API failure. Additional cases cover 26 lock-only keepers sharing one confirmation read, delayed and expired inventory, safe deferred armor unlocks, read-only rechecks, legacy results, wrong accounts, and sent versus unsent changes. Automatic follow-up cases cover the 30-second delay, one read without repeated writes, still-pending data, skipped duplicate protection, read failure, stale/wrong-account data, and already-confirmed results. The Bane of Sorrow tests cover 3 + 1 versus 1 + 1, stronger main-column coverage, unavailable perks, unchanged tier labels, and verified keeper replacement. The Twisting Echo fixture uses selected real Bungie definitions with synthetic instances: two unlocked Powerhouse/Health copies yield one keeper, while the Class tertiary remains separate. Thirteen exotic tests cover actual definition/socket shapes, archetype and tertiary separation, perk-pair separation, legacy and malformed data, safe keeper replacement, and saved structures. The synthetic armor browser flow verifies keeper selection, applying locks, and a follow-up scan with zero remaining changes. A live OAuth scan and real account lock changes require the owner's configured Bungie application and have not yet been verified.

References: [Bungie OAuth](https://github.com/Bungie-net/api/wiki/OAuth-Documentation), [Bungie API schema](https://github.com/Bungie-net/api/blob/master/openapi.json), and [DIM's public source](https://github.com/DestinyItemManager/DIM) for current socket/stat identifiers and vault lock character selection.
