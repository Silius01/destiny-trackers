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

For the armor save flow, use `generated-armor.html?armor=twisting&aged=1` to test saving a completed scan older than five minutes while lock application stays blocked. Use `?armor=twisting&storage-fail=1` to test a failed checklist write. Browser QA verified visible save feedback, the saved-row filter, persistence after reload, the expired lock rejection, and the visible storage error without a success label.

Use `generated-armor.html?armor=exotic` for exotic duplicates and different class-item perk pairs with the same stats. Add `&blocked=1` for an unreadable archetype. Browser QA verified alternate keeper selection, three simulated lock changes, zero remaining changes after rescanning, and saved roll details.

Validation: 80 regression tests and local browser checks cover saved settings, session migration, OAuth client isolation, one-instance ranking, enhanced multi-perk Brass Attacks, missing-definition diagnostics, manifest cache invalidation, per-item selectable perks, armor base stats and duplicate grouping, keeper selection, account selection, OAuth state, exact IDs, lock ordering, save/reload, and failure paths. The Bane of Sorrow tests cover 3 + 1 versus 1 + 1, stronger main-column coverage, unavailable perks, unchanged tier labels, and verified keeper replacement. The Twisting Echo fixture uses selected real Bungie definitions with synthetic instances: two unlocked Powerhouse/Health copies yield one keeper, while the Class tertiary remains separate. Thirteen exotic tests cover actual definition/socket shapes, archetype and tertiary separation, perk-pair separation, legacy and malformed data, safe keeper replacement, and saved structures. The synthetic armor browser flow verifies keeper selection, applying locks, and a follow-up scan with zero remaining changes. A live OAuth scan and real account lock changes require the owner's configured Bungie application and have not yet been verified.

References: [Bungie OAuth](https://github.com/Bungie-net/api/wiki/OAuth-Documentation), [Bungie API schema](https://github.com/Bungie-net/api/blob/master/openapi.json), and [DIM's public source](https://github.com/DestinyItemManager/DIM) for current socket/stat identifiers and vault lock character selection.
