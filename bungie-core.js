/* Inventory interpretation and ranking. No network, storage, or game actions. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.VaultScanCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const SLOT = {3448274439:'Helmet',3551918588:'Gauntlets',14239492:'Chest Armor',20886954:'Leg Armor',1585787867:'Class Item'};
  const ELEMENT = {1:'Kinetic',2:'Arc',3:'Solar',4:'Void',6:'Stasis',7:'Strand'};
  const CLASS = {0:'Titan',1:'Hunter',2:'Warlock'};
  const ARMOR_STATS = {2996146975:'Weapons',392767087:'Health',1943323491:'Class',1735777505:'Grenade',144602215:'Super',4244567218:'Melee'};
  const norm = value => String(value || '').normalize('NFKC').replace(/[’‘]/g,"'").replace(/^enhanced\s+/i,'').trim().toLowerCase();
  const unique = values => [...new Set(values)];
  const keys = ['perk0','perk1','perk2','perk3'];
  const statName = value => norm(value).replace(/^reload$/, 'reload speed');
  const weaponName = value => norm(value).replace(/\s+[–—-]\s+.+?\s+version$/, '');
  const id = value => typeof value === 'string' && /^\d+$/.test(value) ? value :
    (Number.isSafeInteger(value) && value > 0 ? String(value) : '');

  function inventory(profile) {
    const minted=Date.parse(profile.responseMintedTimestamp);
    if (!Number.isFinite(minted) || Date.now()-minted > 180000 || minted-Date.now() > 30000) {
      throw new Error('Bungie returned missing or stale inventory timing. Wait briefly, then scan again.');
    }
    const chars = profile.characters?.data;
    if (!chars || !Object.keys(chars).length || !Array.isArray(profile.profileInventory?.data?.items)) {
      throw new Error('Bungie did not return the vault and characters. Check inventory permission and scan again.');
    }
    if (!profile.itemComponents?.sockets?.data || !profile.itemComponents?.reusablePlugs?.data || !profile.itemComponents?.instances?.data) {
      throw new Error('Bungie did not return all per-item components. No partial scan was applied.');
    }
    const current = Object.entries(chars).sort((a,b) => String(b[1].dateLastPlayed).localeCompare(String(a[1].dateLastPlayed)))[0][0];
    const items = [];
    const add = (rows, owner, equipped) => rows.forEach(raw => {
      if (!raw.itemInstanceId) return;
      if (!id(raw.itemInstanceId)) throw new Error('An item instance ID could not be read safely. Scan stopped.');
      // The postmaster is deliberately outside the vault/character scan.
      if (raw.bucketHash === 215593132 || raw.location === 3) return;
      items.push({...raw, id:id(raw.itemInstanceId), owner, characterId:owner === 'vault' ? current : owner,
        location:owner === 'vault' ? 'Vault' : (CLASS[chars[owner]?.classType] || 'Character') + (equipped ? ' · equipped' : ''),
        equipped, locked:!!(raw.state & 1)});
    });
    add(profile.profileInventory.data.items, 'vault', false);
    for (const charId of Object.keys(chars)) {
      const bag = profile.characterInventories?.data?.[charId]?.items;
      const equipped = profile.characterEquipment?.data?.[charId]?.items;
      if (!Array.isArray(bag) || !Array.isArray(equipped)) throw new Error('One character inventory is missing. No partial scan was applied.');
      add(bag, charId, false); add(equipped, charId, true);
    }
    if (new Set(items.map(i=>i.id)).size !== items.length) throw new Error('An item appears in two locations. Wait for transfers to finish and scan again.');
    return items;
  }

  function fingerprint(item, profile) {
    return JSON.stringify([item.itemHash,item.state & ~1,item.owner,item.equipped,
      profile.itemComponents?.sockets?.data?.[item.id],profile.itemComponents?.reusablePlugs?.data?.[item.id],
      profile.itemComponents?.instances?.data?.[item.id]?.primaryStat]);
  }

  function resolve(item, profile, defs) {
    const def = defs.items[item.itemHash];
    if (!def || def.redacted) return {...item, kind:'unknown', name:'Unknown item', problem:'Missing item definition'};
    const sockets = profile.itemComponents?.sockets?.data?.[item.id]?.sockets;
    const reusable = profile.itemComponents?.reusablePlugs?.data?.[item.id]?.plugs || {};
    const active = (sockets || []).filter(s=>s.plugHash && s.isEnabled !== false).map(s=>defs.items[s.plugHash]).filter(Boolean);
    const kind = def.itemType === 3 ? 'weapon' : def.itemType === 2 ? 'armor' : 'other';
    const result = {...item, name:def.displayProperties?.name || 'Unknown item', kind, def,
      power:profile.itemComponents?.instances?.data?.[item.id]?.primaryStat?.value || 0,
      signature:fingerprint(item,profile), className:CLASS[def.classType] || '', active,
      element:ELEMENT[profile.itemComponents?.instances?.data?.[item.id]?.damageType || def.defaultDamageType] || ''};
    if (!sockets && ['weapon','armor'].includes(kind)) return {...result,problem:'Socket data is missing'};
    if ((sockets || []).some(s=>s.plugHash && !defs.items[s.plugHash])) return {...result,problem:'A socket definition is missing'};
    if (kind === 'weapon') {
      const category = def.sockets?.socketCategories?.find(c=>c.socketCategoryHash === 4241085061);
      const indexes = (category?.socketIndexes || []).filter(index => {
        const plug = defs.items[sockets[index]?.plugHash];
        return plug?.plug?.plugCategoryHash !== 164955586;
      }).slice(0,4);
      if (indexes.length !== 4) return {...result,problem:'This weapon does not expose four identifiable perk columns'};
      result.columns = indexes.map(index => {
        const current = sockets[index]?.plugHash;
        // Only instance-owned options. Never use randomizedPlugSetHash or a crafting recipe pool.
        const hashes = unique([current,...(reusable[index] || []).filter(p=>p.canInsert !== false && p.enabled !== false).map(p=>p.plugItemHash)].filter(Boolean));
        if (hashes.some(hash=>!defs.items[hash])) result.problem = 'A selectable perk definition is missing';
        return hashes.map(hash=>defs.items[hash]).filter(Boolean).map(p=>p.displayProperties?.name).filter(Boolean);
      });
      if (result.columns.some(c=>!c.length)) result.problem = 'One or more perk columns could not be read';
      result.origin = active.filter(p=>p.plug?.plugCategoryHash === 164955586).map(p=>p.displayProperties?.name);
      result.frame = active.find(p=>p.plug?.plugCategoryIdentifier === 'intrinsics')?.displayProperties?.name || '';
      result.focusStats = unique(active.filter(p=> /masterwork/i.test(p.plug?.plugCategoryIdentifier || '') ||
          /enhanced intrinsic/i.test(p.itemTypeDisplayName || '')).flatMap(p=>{
        const values = (p.investmentStats || []).filter(s=>!s.isConditionallyActive && s.value !== 0);
        const named = values.map(s=>defs.stats[s.statTypeHash]?.displayProperties?.name).filter(Boolean);
        // A multi-stat crafted frame cannot establish the chosen focus unambiguously.
        return named.length === 1 ? named : [];
      }));
    }
    if (kind === 'armor') {
      result.slot = SLOT[def.inventory?.bucketTypeHash] || '';
      result.exotic = def.inventory?.tierType === 6;
      const setHash = def.equippingBlock?.equipableItemSetHash;
      const gearHash = def.equippingBlock?.gearsetItemHash;
      result.setNames = [defs.sets?.[setHash]?.displayProperties?.name,defs.items[gearHash]?.displayProperties?.name].filter(Boolean);
      result.archetype = active.find(p=>p.plug?.plugCategoryHash === 778194869)?.displayProperties?.name || '';
      const base = {};
      const intrinsic = active.filter(p=>p.plug?.plugCategoryHash === 748854354 || p.plug?.plugCategoryIdentifier === 'intrinsics');
      for (const source of [def,...intrinsic]) {
        for (const stat of source.investmentStats || []) {
          const name = ARMOR_STATS[stat.statTypeHash];
          if (name && !stat.isConditionallyActive) base[name] = (base[name] || 0) + stat.value;
        }
      }
      result.baseStats = base;
    }
    return result;
  }

  function weaponOptions(item, catalog) {
    let options = catalog.filter(w=>weaponName(w.name) === weaponName(item.name) && norm(w.element) === norm(item.element));
    if (item.origin.length) {
      const originMatches = options.filter(w=>item.origin.some(o=>norm(o) === norm(w.origin)));
      options = originMatches;
    }
    if (options.length > 1 && item.frame) {
      const frame = norm(item.frame).replace(/\s+frame$/, '');
      const frameMatches = options.filter(w=>frame === norm(w.archetype));
      if (frameMatches.length) options = frameMatches;
    }
    return options;
  }

  function rankWeapon(item, weapon) {
    const perks = weapon.rollCols.map((recommended,c)=>recommended.filter(p=>item.columns[c].some(actual=>norm(actual) === norm(p))));
    const matches = perks.map(p=>p.length > 0);
    const hasFocus = item.focusStats.some(s=>statName(s) === statName(weapon.statFocus));
    const tier = matches.every(Boolean) && hasFocus ? 'god' : matches[2] && matches[3] ? 'good' : 'basic';
    const popularity = perks.map((ps,c)=>Math.max(0,...ps.map(p=>weapon.rollColsRanked?.[c]?.find(r=>norm(r.name) === norm(p))?.pct || 0)));
    const score = [{basic:1,good:2,god:3}[tier],Number(matches[2])+Number(matches[3]),matches.filter(Boolean).length,
      Number(hasFocus),popularity[2]+popularity[3],popularity[0]+popularity[1],Number(item.locked),item.power];
    return {...item, weapon, perks, hasFocus, tier, score};
  }
  function compare(a,b) {
    for (let n=0;n<a.score.length;n++) if (a.score[n] !== b.score[n]) return b.score[n]-a.score[n];
    return a.id.localeCompare(b.id);
  }
  function weaponRecord(winner, scannedAt) {
    return {owned:true,rollTier:winner.tier,hasFocus:winner.hasFocus,autoGod:winner.tier === 'god',mod:'',
      ...Object.fromEntries(keys.map((key,n)=>[key,winner.perks[n]])),
      scan:{instanceId:winner.id,itemHash:winner.itemHash,location:winner.location,at:scannedAt,source:'bungie'}};
  }

  function scan(profile, defs, catalog, mappings={}, now=Date.now()) {
    const raw = inventory(profile);
    const items = raw.map(i=>resolve(i,profile,defs));
    const groups = new Map(), review = [], patches = {}, armorMatches=[];
    const scannedAt = new Date(now).toISOString();
    for (const item of items) {
      if (item.kind !== catalog.kind) continue;
      if (item.problem) { review.push({...item,reason:item.problem}); continue; }
      if (catalog.kind === 'weapon') {
        const options = weaponOptions(item,catalog.weapons);
        const mapped = mappings[item.itemHash];
        const weapon = mapped !== undefined ? options.find(w=>String(w.id) === String(mapped)) : options.length === 1 ? options[0] : null;
        if (!weapon) { review.push({...item,reason:options.length ? 'Choose the matching catalog version' : 'Not in this weapon catalog',options}); continue; }
        if (!Array.isArray(weapon.rollCols) || weapon.rollCols.length !== 4 || weapon.rollCols.some(c=>!c.length)) {
          review.push({...item,reason:'Catalog recommendation is incomplete'}); continue;
        }
        const key = String(weapon.id);
        if (!groups.has(key)) groups.set(key,[]);
        groups.get(key).push(rankWeapon(item,weapon));
      } else {
        if (item.exotic) {
          const exotic = catalog.combos.find(c=>c.isExotic && norm(c.name) === norm(item.name) && c.slot === item.slot);
          if (exotic) { patches[exotic.id] = {owned:true,tertiaries:[]}; armorMatches.push({...item,recordId:exotic.id,tertiary:''}); }
          else review.push({...item,reason:'Exotic is not in this catalog'});
          continue;
        }
        const arch = catalog.archetypes.find(a=>norm(a.name) === norm(item.archetype));
        if (!arch) { review.push({...item,reason:'Armor 3.0 archetype could not be identified'}); continue; }
        let possibleSets = catalog.sets.filter(s=>item.setNames.some(n=>norm(n) === norm(s.name)));
        if (!possibleSets.length) possibleSets = catalog.sets.filter(s=>norm(item.name).startsWith(norm(s.name)+' '));
        const mapped = mappings[item.itemHash];
        const set = mapped ? catalog.sets.find(s=>s.name === mapped) : possibleSets.length === 1 ? possibleSets[0] : null;
        if (!set) { review.push({...item,reason:'Choose the armor set',setOptions:catalog.sets}); continue; }
        const possibleStats = arch.tertiaryOptions.filter(s=>(item.baseStats[s] || 0)>0);
        if (possibleStats.length !== 1 || !(item.baseStats[arch.primary]>0) || !(item.baseStats[arch.secondary]>0)) {
          review.push({...item,reason:'Base tertiary stat is ambiguous; mods and tuning are excluded'}); continue;
        }
        const combo = catalog.combos.find(c=>!c.isExotic && c.setName === set.name && c.slot === item.slot && c.archetype === arch.name);
        if (!combo) { review.push({...item,reason:'Set / slot / archetype is not in this catalog'}); continue; }
        const tertiary = possibleStats[0];
        const patch = patches[combo.id] || {owned:false,tertiaries:[]};
        patch.tertiaries = unique([...patch.tertiaries,tertiary]);
        patch.owned = arch.tertiaryOptions.every(s=>patch.tertiaries.includes(s));
        patches[combo.id] = patch;
        armorMatches.push({...item,recordId:combo.id,tertiary,tertiaryOptions:arch.tertiaryOptions});
      }
    }
    const weapons = [];
    for (const [recordId,copies] of groups) {
      copies.sort(compare);
      const winner = copies[0];
      patches[recordId] = weaponRecord(winner,scannedAt);
      weapons.push({recordId,winner,copies});
    }
    weapons.sort((a,b)=>a.winner.name.localeCompare(b.winner.name));
    return {kind:catalog.kind,at:now,scannedAt,items,weapons,armorMatches,patches,review,
      account:profile.profile?.data?.userInfo?.membershipId || '',membershipType:profile.profile?.data?.userInfo?.membershipType};
  }

  function lockPlan(scanResult) {
    // A malformed or unrecognized copy with the same item hash makes the whole family review-only.
    const blocked = new Set(scanResult.review.map(i=>i.itemHash));
    return scanResult.weapons.filter(g=>!g.copies.some(i=>blocked.has(i.itemHash))).map(g=>({
      recordId:g.recordId,name:g.winner.name,keeper:g.winner,
      locks:g.winner.locked ? [] : [g.winner],unlocks:g.copies.slice(1).filter(i=>i.locked),
      duplicates:g.copies.slice(1),copies:g.copies
    }));
  }

  function validatePlan(plan, original, fresh, now=Date.now()) {
    if (now-original.at > 5*60*1000) throw new Error('This preview is over five minutes old. Scan again before changing locks.');
    if (String(fresh.profile?.data?.userInfo?.membershipId) !== String(original.account)) throw new Error('The connected account changed. Scan again.');
    const byId = new Map(inventory(fresh).map(i=>[i.id,i]));
    if (byId.size !== original.items.length || original.items.some(i=>!byId.has(i.id))) throw new Error('Inventory contents changed since the preview. Scan again.');
    for (const group of plan) {
      const hashes = new Set(group.copies.map(i=>i.itemHash));
      const current = [...byId.values()].filter(i=>hashes.has(i.itemHash));
      const oldIds = new Set(group.copies.map(i=>i.id));
      if (current.length !== oldIds.size || current.some(i=>!oldIds.has(i.id))) throw new Error('Copies changed since the preview. Scan again.');
      for (const previous of group.copies) {
        const item = byId.get(previous.id);
        if (!item || fingerprint(item,fresh) !== previous.signature || item.locked !== previous.locked) {
          throw new Error('An item moved, its perks changed, or its lock was changed. Scan again.');
        }
      }
    }
    return byId;
  }

  async function executeLocks(plan, client, original, onProgress=()=>{}) {
    const fresh = await client.profile();
    const byId = validatePlan(plan,original,fresh);
    const completed = [];
    try {
    for (const group of plan) {
      const keeper = byId.get(group.keeper.id);
      // Lock and verify the selected copy before making any duplicate easier to dismantle.
      if (!keeper.locked) {
        await client.setLock(keeper,true);
        completed.push({itemId:keeper.id,state:true}); onProgress(completed);
      }
      const check = await client.item(keeper);
      if (!(check.item?.data?.state & 1)) throw Object.assign(new Error('Keeper lock could not be verified. Duplicate unlocks stopped.'),{completed});
      for (const duplicate of group.unlocks) {
        await client.setLock(byId.get(duplicate.id),false);
        completed.push({itemId:duplicate.id,state:false}); onProgress(completed);
      }
    }
    const verified = new Map(inventory(await client.profile()).map(i=>[i.id,i]));
    for (const group of plan) {
      if (!verified.get(group.keeper.id)?.locked || group.duplicates.some(i=>verified.get(i.id)?.locked !== false)) {
        throw Object.assign(new Error('Bungie has not confirmed every lock change. Scan again to see current status.'),{completed});
      }
    }
    return completed;
    } catch (error) {
      error.completed=completed;
      if (completed.length) error.message += ' '+completed.length+' changes were already applied. Scan again before retrying.';
      throw error;
    }
  }
  function applyRecords(records,result,normalize) {
    const next={...records};
    // Replace the previous scan layer while retaining marks made manually before it.
    for (const [key,record] of Object.entries(next)) {
      if (record.scan?.source==='bungie') next[key]=normalize(record.scan.before || {});
    }
    for (const [key,patch] of Object.entries(result.patches)) {
      const before=normalize(next[key] || {});
      const value=result.kind==='armor' ? {...before,owned:before.owned || patch.owned,
        tertiaries:unique([...(before.tertiaries || []),...patch.tertiaries])} : {...before,...patch,mod:before.mod || ''};
      if (result.kind==='armor') {
        const matches=result.armorMatches.filter(i=>i.recordId===key);
        if (matches[0]?.tertiaryOptions?.every(stat=>value.tertiaries.includes(stat))) value.owned=true;
        value.scan={instanceIds:matches.map(i=>i.id),at:result.scannedAt};
      }
      value.scan={...value.scan,source:'bungie',before};
      next[key]=value;
    }
    return next;
  }
  return {norm,id,inventory,resolve,rankWeapon,weaponOptions,scan,lockPlan,validatePlan,executeLocks,weaponRecord,applyRecords};
});
