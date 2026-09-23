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
      profile.itemComponents?.instances?.data?.[item.id]?.primaryStat,
      profile.itemComponents?.instances?.data?.[item.id]?.gearTier]);
  }

  function resolve(item, profile, defs) {
    const def = defs.items[item.itemHash];
    if (!def || def.redacted) return {...item, kind:'unknown', name:'Unknown item '+item.itemHash, problem:'Missing item definition: '+item.itemHash,missingDefinitions:[item.itemHash]};
    const sockets = profile.itemComponents?.sockets?.data?.[item.id]?.sockets;
    const reusable = profile.itemComponents?.reusablePlugs?.data?.[item.id]?.plugs || {};
    const active = (sockets || []).filter(s=>s.plugHash && s.isEnabled !== false).map(s=>defs.items[s.plugHash]).filter(Boolean);
    const kind = def.itemType === 3 ? 'weapon' : def.itemType === 2 ? 'armor' : 'other';
    const result = {...item, name:def.displayProperties?.name || 'Unknown item', kind, def,
      exotic:def.inventory?.tierType === 6,
      power:profile.itemComponents?.instances?.data?.[item.id]?.primaryStat?.value || 0,
      signature:fingerprint(item,profile), className:CLASS[def.classType] || '', active,
      element:ELEMENT[profile.itemComponents?.instances?.data?.[item.id]?.damageType || def.defaultDamageType] || ''};
    if (!sockets && ['weapon','armor'].includes(kind)) return {...result,problem:'Socket data is missing'};
    const missingDefinitions=unique((sockets || []).filter(s=>s.plugHash && !defs.items[s.plugHash]).map(s=>s.plugHash));
    if (missingDefinitions.length) return {...result,problem:'Socket definitions are missing: '+missingDefinitions.join(', '),missingDefinitions};
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
        const missing=hashes.filter(hash=>!defs.items[hash]);
        if (missing.length) {
          result.missingDefinitions=unique([...(result.missingDefinitions || []),...missing]);
          result.problem='Selectable perk definitions are missing: '+result.missingDefinitions.join(', ');
        }
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
      result.gearTier = profile.itemComponents?.instances?.data?.[item.id]?.gearTier ?? null;
      result.artifice = sockets.some(s=>s.plugHash && s.isVisible !== false &&
        (defs.items[s.plugHash]?.plug?.plugCategoryHash === 3773173029 || s.plugHash === 3727270518));
      const setHash = def.equippingBlock?.equipableItemSetHash;
      const gearHash = def.equippingBlock?.gearsetItemHash;
      result.setNames = [defs.sets?.[setHash]?.displayProperties?.name,defs.items[gearHash]?.displayProperties?.name].filter(Boolean);
      result.archetype = active.find(p=>p.plug?.plugCategoryHash === 778194869)?.displayProperties?.name || '';
      result.exoticPerks = [];
      if (result.exotic && result.slot === 'Class Item') {
        // Read the two actual trait sockets, never the definition's possible rolls.
        const indexes = unique((def.sockets?.socketCategories || []).filter(c=>c.socketCategoryHash === 2518356196).flatMap(c=>c.socketIndexes));
        result.exoticPerks = indexes.map(index=>{
          const socket=sockets[index],plug=defs.items[socket?.plugHash];
          return socket?.plugHash && socket.isVisible !== false && plug?.plug?.plugCategoryIdentifier === 'intrinsics' && plug.displayProperties?.name ?
            {index,hash:socket.plugHash,name:plug.displayProperties.name} : null;
        }).filter(Boolean).sort((a,b)=>a.index-b.index);
        if (indexes.length !== 2 || result.exoticPerks.length !== 2) result.exoticPerkIssue='Both exotic class-item perks could not be identified';
      }
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
    const perkCounts = perks.map(ps=>new Set(ps.map(norm)).size);
    const mainColumnsMatched = Number(matches[2])+Number(matches[3]);
    const mainPerkChoices = perkCounts[2]+perkCounts[3];
    const popularity = perks.map((ps,c)=>Math.max(0,...ps.map(p=>weapon.rollColsRanked?.[c]?.find(r=>norm(r.name) === norm(p))?.pct || 0)));
    // Reward the recommended options actually owned on this one copy. Coverage
    // comes first, so three traits in one column cannot replace a missing other column.
    const score = [mainColumnsMatched,mainPerkChoices,{basic:1,good:2,god:3}[tier],matches.filter(Boolean).length,
      Number(hasFocus),popularity[2]+popularity[3],popularity[0]+popularity[1],Number(item.locked),item.power];
    return {...item, weapon, perks, perkCounts, mainColumnsMatched, mainPerkChoices, hasFocus, tier, score};
  }
  function compare(a,b) {
    for (let n=0;n<a.score.length;n++) if (a.score[n] !== b.score[n]) return b.score[n]-a.score[n];
    return a.id.localeCompare(b.id);
  }
  function weaponRecord(winner, scannedAt) {
    return {owned:true,rollTier:winner.tier,hasFocus:winner.hasFocus,autoGod:winner.tier === 'god',mod:'',
      originSel:!!winner.weapon.origin,
      ...Object.fromEntries(keys.map((key,n)=>[key,winner.perks[n]])),
      scan:{instanceId:winner.id,itemHash:winner.itemHash,location:winner.location,at:scannedAt,source:'bungie'}};
  }

  function scan(profile, defs, catalog, mappings={}, now=Date.now()) {
    const raw = inventory(profile);
    const items = raw.map(i=>resolve(i,profile,defs));
    const groups = new Map(), review = [], patches = {}, armorMatches=[], exoticWeapons=[];
    const scannedAt = new Date(now).toISOString();
    for (const item of items) {
      if (item.kind==='unknown') { review.push({...item,reason:item.problem});continue; }
      if (item.kind !== catalog.kind) continue;
      if (item.problem) { review.push({...item,reason:item.problem}); continue; }
      if (catalog.kind === 'weapon') {
        // Every exotic weapon is kept and locked; it never needs a catalog roll match.
        if (item.exotic) { exoticWeapons.push(item); continue; }
        const options = weaponOptions(item,catalog.weapons);
        const mapped = mappings[item.itemHash];
        const weapon = mapped !== undefined ? options.find(w=>String(w.id) === String(mapped)) : options.length === 1 ? options[0] : null;
        if (!weapon) {
          const named=catalog.weapons.filter(w=>weaponName(w.name)===weaponName(item.name));
          const sameElement=named.filter(w=>norm(w.element)===norm(item.element));
          const reason=options.length ? (mapped!==undefined?'Saved catalog match is no longer valid; choose the matching version':'Choose the matching catalog version') :
            sameElement.length ? 'Origin trait mismatch: Bungie reports '+(item.origin.join(' / ') || 'none')+'; catalog expects '+unique(sameElement.map(w=>w.origin || 'none')).join(' / ') :
            named.length ? 'Damage type mismatch: Bungie reports '+(item.element || 'unknown')+'; catalog expects '+unique(named.map(w=>w.element)).join(' / ') : 'Not in this weapon catalog';
          review.push({...item,reason,options});continue;
        }
        if (!Array.isArray(weapon.rollCols) || weapon.rollCols.length !== 4 || weapon.rollCols.some(c=>!c.length)) {
          review.push({...item,reason:'Catalog recommendation is incomplete'}); continue;
        }
        const key = String(weapon.id);
        if (!groups.has(key)) groups.set(key,[]);
        groups.get(key).push(rankWeapon(item,weapon));
      } else {
        let exoticMatch;
        if (item.exotic) {
          const exotic = catalog.combos.find(c=>c.isExotic && norm(c.name) === norm(item.name) && c.slot === item.slot);
          if (!exotic) { review.push({...item,reason:'Exotic is not in this catalog'});continue; }
          patches[exotic.id] = {owned:true,tertiaries:[]};
          exoticMatch={...item,recordId:exotic.id,tertiary:'',ownershipOnly:true};
          armorMatches.push(exoticMatch);
        }
        const arch = catalog.archetypes.find(a=>norm(a.name) === norm(item.archetype));
        if (!arch) { review.push({...item,reason:'Armor 3.0 archetype could not be identified'+(item.exotic?'; ownership tracked, locks unchanged':'')}); continue; }
        let set;
        if (!item.exotic) {
          let possibleSets = catalog.sets.filter(s=>item.setNames.some(n=>norm(n) === norm(s.name)));
          if (!possibleSets.length) possibleSets = catalog.sets.filter(s=>norm(item.name).startsWith(norm(s.name)+' '));
          const mapped = mappings[item.itemHash];
          set = mapped ? catalog.sets.find(s=>s.name === mapped) : possibleSets.length === 1 ? possibleSets[0] : null;
          if (!set) { review.push({...item,reason:'Choose the armor set',setOptions:catalog.sets}); continue; }
        }
        const possibleStats = arch.tertiaryOptions.filter(s=>(item.baseStats[s] || 0)>0);
        if (possibleStats.length !== 1 || !(item.baseStats[arch.primary]>0) || !(item.baseStats[arch.secondary]>0)) {
          review.push({...item,reason:'Base tertiary stat is ambiguous; mods and tuning are excluded'}); continue;
        }
        const combo = exoticMatch ? {id:exoticMatch.recordId} : catalog.combos.find(c=>!c.isExotic && c.setName === set.name && c.slot === item.slot && c.archetype === arch.name);
        if (!combo) { review.push({...item,reason:'Set / slot / archetype is not in this catalog'}); continue; }
        const tertiary = possibleStats[0];
        if (!item.exotic) {
          const patch = patches[combo.id] || {owned:false,tertiaries:[]};
          patch.tertiaries = unique([...patch.tertiaries,tertiary]);
          patch.owned = arch.tertiaryOptions.every(s=>patch.tertiaries.includes(s));
          patches[combo.id] = patch;
        }
        const baseTotal = Object.values(item.baseStats).reduce((sum,value)=>sum+value,0);
        const lockIssue = !item.className ? 'Armor class could not be identified' :
          !Number.isInteger(item.gearTier) || item.gearTier < 1 ? 'Gear tier could not be identified' :
          Object.values(item.baseStats).some(value=>!Number.isFinite(value) || value<0) ? 'Base stat values could not be read safely' : item.exoticPerkIssue || '';
        const match={...item,recordId:combo.id,tertiary,tertiaryOptions:arch.tertiaryOptions,baseTotal,lockIssue,
          ownershipOnly:false,score:[baseTotal,Number(item.locked),item.power]};
        if (exoticMatch) Object.assign(exoticMatch,match);
        else armorMatches.push(match);
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
    const armorGroups = new Map();
    for (const item of armorMatches.filter(i=>!i.ownershipOnly)) {
      const groupId=JSON.stringify([item.itemHash,item.className,item.slot,item.archetype,item.tertiary,item.gearTier,item.artifice,
        ...(item.exotic?[(item.exoticPerks || []).map(p=>[p.index,p.hash])]:[])]);
      if (!armorGroups.has(groupId)) armorGroups.set(groupId,[]);
      armorGroups.get(groupId).push(item);
    }
    const armor = [...armorGroups].map(([groupId,copies])=>{
      copies.sort(compare);
      return {groupId,recordId:copies[0].recordId,winner:copies[0],copies};
    }).sort((a,b)=>a.winner.name.localeCompare(b.winner.name) || a.groupId.localeCompare(b.groupId));
    return {kind:catalog.kind,at:now,scannedAt,items,weapons,armor,armorMatches,exoticWeapons,patches,review,
      account:profile.profile?.data?.userInfo?.membershipId || '',membershipType:profile.profile?.data?.userInfo?.membershipType};
  }

  function lockPlan(scanResult, keepers={}) {
    // A malformed or unrecognized copy with the same item hash makes the whole family review-only.
    const blocked = new Set([...scanResult.review,...scanResult.armorMatches.filter(i=>i.lockIssue)].map(i=>i.itemHash));
    const groups = scanResult.kind === 'armor' ? scanResult.armor : scanResult.weapons;
    const plan = groups.filter(g=>!g.copies.some(i=>blocked.has(i.itemHash))).map(g=>{
      const keeper=g.copies.find(i=>i.id===keepers[g.groupId]) || g.winner;
      const duplicates=g.copies.filter(i=>i.id!==keeper.id);
      return {groupId:g.groupId,recordId:g.recordId,name:keeper.name,keeper,
        locks:keeper.locked ? [] : [keeper],unlocks:duplicates.filter(i=>i.locked),duplicates,copies:g.copies};
    });
    // Keep and lock every exotic weapon; exotics are never proposed for unlocking.
    for (const item of scanResult.exoticWeapons || []) {
      plan.push({groupId:'exotic-weapon:'+item.id,recordId:null,name:item.name,keeper:item,
        locks:item.locked ? [] : [item],unlocks:[],duplicates:[],copies:[item],exoticWeapon:true});
    }
    return plan;
  }

  function armorLockBlockers(result, itemHash) {
    return [...result.review.filter(i=>i.itemHash===itemHash).map(i=>({instanceId:i.id,reason:i.reason})),
      ...result.armorMatches.filter(i=>i.itemHash===itemHash && i.lockIssue).map(i=>({instanceId:i.id,reason:i.lockIssue}))];
  }

  function armorDiagnostics(result, profile, defs, keepers={}) {
    const matched=new Map(result.armorMatches.map(i=>[i.id,i]));
    const review=new Map(result.review.map(i=>[i.id,i.reason]));
    const plan=lockPlan(result,keepers),planned=new Map(plan.flatMap(g=>g.copies.map(i=>[i.id,g])));
    const statSource=def=>({hash:def?.hash,name:def?.displayProperties?.name || '',category:def?.plug?.plugCategoryHash,
      identifier:def?.plug?.plugCategoryIdentifier,stats:(def?.investmentStats || []).filter(s=>ARMOR_STATS[s.statTypeHash])
        .map(s=>({hash:s.statTypeHash,name:ARMOR_STATS[s.statTypeHash],value:s.value,conditional:!!s.isConditionallyActive}))});
    return result.items.filter(i=>i.kind==='armor' || i.kind==='unknown').map(item=>{
      const match=matched.get(item.id),group=planned.get(item.id),blockers=armorLockBlockers(result,item.itemHash);
      const decision=review.has(item.id)?'review':match?.ownershipOnly?'ownership-only':!group?'blocked':
        item.id===group.keeper.id?(item.locked?'keep-locked':'lock'):(item.locked?'unlock':'duplicate-already-unlocked');
      return {instanceId:item.id,itemHash:item.itemHash,name:item.name,location:item.location,locked:item.locked,
        className:item.className,slot:item.slot,setNames:item.setNames,archetype:item.archetype,tertiary:match?.tertiary || null,
        baseStats:item.baseStats,gearTier:item.gearTier,artifice:item.artifice,exotic:item.exotic,exoticPerks:item.exoticPerks,catalogId:match?.recordId,keeper:group?.keeper.id,
        decision,reason:review.get(item.id) || match?.lockIssue || null,blockers,missingDefinitions:item.missingDefinitions || [],
        definitionStats:statSource(item.def),sockets:(profile.itemComponents?.sockets?.data?.[item.id]?.sockets || []).map((s,index)=>({
          index,plugHash:s.plugHash,isEnabled:s.isEnabled,isVisible:s.isVisible,...statSource(defs.items[s.plugHash])}))};
    });
  }

  function weaponDiagnostics(result, profile, defs) {
    const ranked=new Map(result.weapons.flatMap(g=>g.copies.map(i=>[i.id,{item:i,group:g}])));
    const review=new Map(result.review.map(i=>[i.id,i.reason]));
    return result.items.filter(i=>i.kind==='weapon' || i.kind==='unknown').map(item=>{
      const match=ranked.get(item.id),sockets=profile.itemComponents?.sockets?.data?.[item.id]?.sockets || [];
      const reusable=profile.itemComponents?.reusablePlugs?.data?.[item.id]?.plugs || {};
      const plug=hash=>({hash,name:defs.items[hash]?.displayProperties?.name || null,category:defs.items[hash]?.plug?.plugCategoryHash});
      return {instanceId:item.id,itemHash:item.itemHash,name:item.name,location:item.location,locked:item.locked,
        element:item.element,origin:item.origin,frame:item.frame,columns:item.columns,focusStats:item.focusStats,
        catalogId:match?.group.recordId,tier:match?.item.tier,keeper:match?.group.winner.id,matchedPerks:match?.item.perks,
        perkCounts:match?.item.perkCounts,mainColumnsMatched:match?.item.mainColumnsMatched,mainPerkChoices:match?.item.mainPerkChoices,
        reason:review.get(item.id) || null,missingDefinitions:item.missingDefinitions || [],
        socketCategories:item.def?.sockets?.socketCategories,
        sockets:sockets.map((socket,index)=>({index,current:plug(socket.plugHash),isEnabled:socket.isEnabled,isVisible:socket.isVisible,
          options:(reusable[index] || []).map(p=>({...plug(p.plugItemHash),enabled:p.enabled,canInsert:p.canInsert}))}))};
    });
  }

  function validatePlan(plan, original, fresh, now=Date.now()) {
    if (now-original.at > 5*60*1000) throw new Error('This preview is over five minutes old. Scan again before changing locks.');
    if (String(fresh.profile?.data?.userInfo?.membershipId) !== String(original.account)) throw new Error('The connected account changed. Scan again.');
    if (fresh.profile?.data?.userInfo?.membershipType !== original.membershipType) throw new Error('The connected account changed. Scan again.');
    const byId = new Map(inventory(fresh).map(i=>[i.id,i]));
    if (byId.size !== original.items.length || original.items.some(i=>!byId.has(i.id))) throw new Error('Inventory contents changed since the preview. Scan again.');
    const checked=new Set();
    for (const group of plan) {
      const hashes = new Set(group.copies.map(i=>i.itemHash));
      const current = [...byId.values()].filter(i=>hashes.has(i.itemHash));
      // An armor hash can contain several archetype/tertiary groups. Validate the
      // entire hash family, including copies outside this particular lock group.
      const previousCopies=original.items.filter(i=>hashes.has(i.itemHash));
      const oldIds = new Set(previousCopies.map(i=>i.id));
      if (current.length !== oldIds.size || current.some(i=>!oldIds.has(i.id))) throw new Error('Copies changed since the preview. Scan again.');
      for (const previous of previousCopies) {
        if (checked.has(previous.id)) continue;
        checked.add(previous.id);
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
  // Only inventory identities belong in the comparison. Moves, locks, Power,
  // duplicate counts and keeper choices do not create another roll combination.
  function armorScanSnapshot(result) {
    return {version:1,account:String(result.account || ''),membershipType:result.membershipType,
      scannedAt:result.scannedAt,combinations:unique(result.armor.map(g=>g.groupId)),
      copies:unique(result.items.filter(i=>i.kind==='armor').map(i=>i.id))};
  }
  function compareArmorScans(current,previous) {
    const valid=value=>value?.version===1 && value.account && Number.isFinite(Date.parse(value.scannedAt)) &&
      ['combinations','copies'].every(key=>Array.isArray(value[key]) && value[key].every(id=>typeof id==='string'));
    if(!valid(previous) || previous.account!==current.account || previous.membershipType!==current.membershipType)return null;
    const added=(a,b)=>{const known=new Set(b);return unique(a).filter(id=>!known.has(id)).length;};
    return {since:previous.scannedAt,newCombinations:added(current.combinations,previous.combinations),
      removedCombinations:added(previous.combinations,current.combinations),
      newCopies:added(current.copies,previous.copies),removedCopies:added(previous.copies,current.copies)};
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
        if (matches.some(i=>i.exotic)) value.scan.armorRolls=result.armor.filter(g=>g.recordId===key).map(g=>({
          className:g.winner.className,archetype:g.winner.archetype,tertiary:g.winner.tertiary,gearTier:g.winner.gearTier,
          artifice:g.winner.artifice,exoticPerks:g.winner.exoticPerks || [],instanceIds:g.copies.map(i=>i.id)}));
      }
      value.scan={...value.scan,source:'bungie',before};
      next[key]=value;
    }
    return next;
  }
  return {norm,id,inventory,resolve,rankWeapon,weaponOptions,scan,lockPlan,validatePlan,executeLocks,weaponRecord,applyRecords,weaponDiagnostics,armorDiagnostics,armorLockBlockers,armorScanSnapshot,compareArmorScans};
});
