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

Enter that application's API key and OAuth client ID in the tracker and click **Connect Bungie**. Sign-in happens on Bungie. No client secret is used. Credentials and the access token are kept in `sessionStorage`, not committed or included in backups. Public OAuth clients do not receive refresh tokens; reconnect after expiry. Navigate between trackers in the same browser tab to reuse the session.

Local HTTP and `file:` previews can use **Try example scan**. Live OAuth needs the deployed HTTPS callback. Example mode cannot save checklist results or change locks.

## Weapon evaluation

Each physical item is identified by its 64-bit instance ID, kept as a string. Selectable perks from that instance count; the definition's potential random-roll or crafting pools do not.

- **God:** one copy matches recommendations in all four columns and its priority/masterwork stat is confirmed.
- **Good:** that same copy matches recommended column 3 and column 4 perks.
- **Basic:** owned, below those requirements.

Ranking uses tier, main-perk matches, total matched columns, priority stat, community popularity, existing lock, then Power. It is based on this catalog's recommendations, not an independent evaluation of every possible build. A single keeper supplies all imported perks. Perks from different copies are never combined. Enhanced perk names can match their base recommendations.

The catalog predates API integration and lacks Bungie item hashes. Candidates use name, element, and origin; catalog version suffixes are handled. Ambiguous versions require an explicit mapping by item hash. Unsupported weapons remain in the review list. Crafted frames with an ambiguous priority stat are not assigned a god roll automatically.

### Lock changes

Scanning itself is read-only. **Save scan to checklist** only updates local progress. **Save scan & apply … lock changes** applies the displayed keeper/duplicate plan.

Before writes, the app checks that the preview is under five minutes old and re-reads inventory, comparing item IDs, locations, sockets, Power, and lock state. Missing or stale profile data stops the operation. A family with an unreadable copy is not unlocked.

For each reviewed family it locks the keeper, verifies that lock, then unlocks locked duplicates. A failed request stops remaining writes; partial changes are reported and require a new scan. A final read verifies the result. The only game-write endpoint in this app is `SetLockState`: there is no dismantle, transfer, equip, or plug-insertion implementation. Unlocking makes a duplicate available for manual dismantling in game.

## Armor evaluation

Matches set, slot, and Armor 3.0 archetype. Base investment stats and intrinsic armor stat plugs determine the tertiary stat; mods, tuning, and masterwork bonuses do not manufacture a new combo. Ambiguous base stats are left for review. A missing set mapping can be selected manually and saved by item hash. Exotics track ownership. Armor scans do not change armor locks.

The existing catalog combines classes for its set/slot/archetype checklist. The scan report shows the class, location, and physical instance IDs. All four tertiary variants are required for the existing **Farmed** marker.

## Progress and backups

Each save creates a **before last scan** backup. **Export checklist backup** saves a JSON file. Scanning replaces the prior scan contribution while preserving earlier manual marks. Manual editing detaches an entry from its imported scan metadata. The tracker is a checklist: historical manual marks are preserved even when no current inventory match is found.

Progress remains browser-local on GitHub Pages. Claude-specific database code is retained, but this feature was implemented and tested in the standalone app; the separate Claude Artifact has not been updated.

## Development

- `bungie-core.js`: pure inventory interpretation, rankings, record merging, and lock sequencing.
- `bungie-api.js`: public-client OAuth, fixed Bungie endpoint allowlist, manifest cache.
- `bungie-ui.js` / `.css`: shared scan and review dialog.
- `bungie-auth.html` / `.js`: OAuth callback, without third-party assets.
- `bungie-example.js`: synthetic sample inventory.

Run `npm test` with Node 20+. No npm packages are required. `node tests/browser/build-harness.cjs` generates ignored local browser fixtures with synthetic inventories and separate `qa-*` progress storage. Serve the directory locally, then open `tests/browser/generated-weapon.html` and `generated-armor.html`. Generated fixtures must not be deployed.

Validation: regression tests and local browser checks cover one-instance ranking, per-item selectable perks, armor base stats, migrations, account selection, OAuth state, exact IDs, lock ordering, save/reload, and failure paths. A live OAuth scan and real account lock changes require the owner's configured Bungie application and have not yet been verified.

References: [Bungie OAuth](https://github.com/Bungie-net/api/wiki/OAuth-Documentation), [Bungie API schema](https://github.com/Bungie-net/api/blob/master/openapi.json), and [DIM's public source](https://github.com/DestinyItemManager/DIM) for current socket/stat identifiers and vault lock character selection.
