(function(root){
  'use strict';
  const h=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
  const button=(text,action,cls)=>{const b=h('button',text,cls);b.type='button';b.addEventListener('click',action);return b;};
  const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key)) || fallback;}catch{return fallback;}};
  const count=(n,one,many=one+'s')=>n+' '+(n===1?one:many);
  function mount(adapter){
    const kind=adapter.catalog.kind,api=VaultBungie,core=VaultScanCore,key=adapter.storageKey;
    let profile,defs,result,client,accounts=[],busy=false,demo=false,keepers={},reviewDecisions={},lastReport=null,savedScan=false;
    let mappings=read('vaultBungieMappings-'+kind,{});
    let comparisonBase=null,scanChanges=null;
    let lastLock=read(key+'-last-lock-result',null),lockStorageWarning='';
    const dialog=h('dialog',undefined,'bungie-dialog');
    const header=h('header');header.append(h('h2',kind==='weapon'?'Scan weapons':'Scan armor'),button('Close',()=>dialog.close()));
    const body=h('div',undefined,'scan-body');dialog.append(header,body);document.body.append(dialog);
    const launch=button('Bungie inventory scan',()=>{dialog.showModal();refreshConnection();},'bungie-launch');
    document.getElementById('controlsPanel').prepend(launch);
    body.append(h('p',kind==='weapon'?'Compare the vault and every character. Each tracked roll comes from one real copy, including its selectable perks.':'Find armor sets, slots, archetypes, and base tertiary stats across the vault and every character.'));
    const connection=h('details');connection.append(h('summary','Bungie connection and setup'));
    const setup=h('div');connection.append(setup);body.append(connection);
    setup.append(h('p','Use a Public OAuth client with Read basic user profile, Read Destiny Inventory and Vault, and Move or equip Destiny items permissions. Bungie uses the last permission for locks.'));
    const portal=h('a','Open Bungie application settings');portal.href='https://www.bungie.net/en/Application';portal.target='_blank';portal.rel='noopener noreferrer';setup.append(portal);
    setup.append(h('p','Set the redirect URL to:'));setup.append(h('code',api.callbackURL()));
    setup.append(h('p','Set Origin Header to '+location.origin+'. Use the API key and OAuth client ID from that same application. A client secret is not needed.'));
    const fields=h('div',undefined,'scan-fields');
    const keyLabel=h('label','API key'),keyInput=h('input');keyInput.type='password';keyInput.autocomplete='off';keyInput.setAttribute('aria-label','Bungie API key');keyLabel.append(keyInput);
    const idLabel=h('label','OAuth client ID'),idInput=h('input');idInput.inputMode='numeric';idInput.autocomplete='off';idInput.setAttribute('aria-label','Bungie OAuth client ID');idLabel.append(idInput);fields.append(keyLabel,idLabel);setup.append(fields);
    function fillSavedSettings(){const saved=api.savedConfiguration();keyInput.value=saved?.apiKey || '';idInput.value=saved?.clientId || '';}
    fillSavedSettings();
    setup.append(h('small','Save settings or Connect Bungie remembers the API key and client ID in this browser for both vaults. Your sign-in token stays in this tab and expires after about an hour; reconnect using the saved settings when asked.'));
    const connActions=h('div',undefined,'scan-actions');
    connActions.append(button('Save settings',()=>{try{api.saveConfiguration(keyInput.value,idInput.value);fillSavedSettings();status('API key and client ID saved in this browser. Use Connect Bungie to sign in.');}catch(e){status(e.message,true);}}),
      button('Connect Bungie',()=>{try{api.begin(keyInput.value,idInput.value);}catch(e){status(e.message,true);}},'primary'),
      button('Disconnect',()=>{api.disconnect();client=null;result=null;report.replaceChildren();fillSavedSettings();status('Disconnected. Your app settings and checklist progress are still saved.');refreshConnection();}),
      button('Forget saved settings',()=>{try{api.forgetConfiguration();client=null;result=null;report.replaceChildren();fillSavedSettings();status('Saved API key and client ID removed. Disconnected; checklist progress is retained.');refreshConnection();}catch(e){status(e.message,true);}}));setup.append(connActions);
    const controls=h('div',undefined,'scan-actions'),accountSelect=h('select');accountSelect.setAttribute('aria-label','Destiny account');
    accountSelect.addEventListener('change',()=>{result=null;report.replaceChildren();client=api.client(accounts[Number(accountSelect.value)]);showLockResult();updateButtons();});
    const scanButton=button('Scan vault + characters',()=>run(scanLive),'primary');
    const refreshButton=button('Refresh definitions & scan',()=>run(()=>scanLive(true)));
    const sampleButton=button('Try example scan',()=>run(scanSample));
    controls.append(accountSelect,scanButton,refreshButton,sampleButton);body.append(controls);
    const statusBox=h('div','Connect Bungie to scan your inventory, or try an example.', 'scan-status');statusBox.setAttribute('role','status');statusBox.setAttribute('aria-live','polite');body.append(statusBox);
    const lockResultBox=h('section',undefined,'scan-lock-result');lockResultBox.hidden=true;body.append(lockResultBox);
    const report=h('div');body.append(report);
    const actionStatus=h('div',undefined,'scan-status');actionStatus.hidden=true;body.append(actionStatus);
    const savedActions=h('div',undefined,'scan-actions');
    const viewSaved=button('View saved checklist',()=>{dialog.close();adapter.showSavedRecords?.();});viewSaved.hidden=true;viewSaved.dataset.edit='';
    if(adapter.showSavedRecords){savedActions.append(viewSaved);body.append(savedActions);}
    const backups=h('div',undefined,'scan-actions');
    const exportLast=button('Export last scan report',()=>{if(lastReport)download(lastReport,kind+'-scan-report.json');});exportLast.disabled=true;
    backups.append(button('Export checklist backup',()=>download({format:'destiny-vault-backup',version:1,kind,at:new Date().toISOString(),records:adapter.getRecords()},kind+'-vault-backup.json')),
      button('Restore before last scan',()=>run(async()=>{const data=read(key+'-before-scan',null);if(!data?.records)throw new Error('There is no saved pre-scan backup.');await adapter.replaceRecords(data.records);savedScan=false;viewSaved.hidden=true;const save=report.querySelector('[data-save]');if(save)save.textContent='Save scan to checklist';status('Restored the checklist from before the last scan. Game locks are unchanged.');})),exportLast);body.append(backups);
    const how=h('details');how.append(h('summary','How matching and ranking work'),h('p',kind==='weapon'?
      'Keeper ranking first favors matching both main perk columns (3 and 4), then more distinct recommended choices across those columns on the same copy. For example, 3 + 1 beats 1 + 1, even with a weaker barrel or masterwork. Ties use roll tier, total matching columns, priority stat, community popularity, existing lock, then Power. God still means all four recommended columns plus the priority stat; Good means columns 3 and 4 match; Basic is below those requirements. Unowned crafting options and unavailable perks are not counted. Different catalog versions require a clear match.' :
      'Only base armor stats determine the tertiary stat. Each physical item contributes its own combination. A set/slot/archetype is fully farmed when all four tertiary variants are tracked. Duplicate groups require the same piece, class, archetype, tertiary, gear tier, and Artifice status. Exotic class items also require the same two perks. The suggested keeper has the highest base-stat total; ties prefer an existing lock, then Power. Choose another copy in the preview if its stat distribution suits your build. Older or unreadable exotic rolls retain ownership tracking and need review before lock changes.'),h('p','Scans update matched entries and preserve earlier manual marks. A rescan replaces the previous scan’s contribution. Unrecognized items remain in the review list.'));body.append(how);
    function status(message,error=false){statusBox.textContent=message;statusBox.classList.toggle('error',error);
      actionStatus.textContent=message;actionStatus.classList.toggle('error',error);actionStatus.hidden=!(result || lastReport || error);}
    function rememberLockResult(value){
      lastLock=value;lockStorageWarning='';
      try{localStorage.setItem(key+'-last-lock-result',JSON.stringify(value));}
      catch{lockStorageWarning='This result could not be remembered after reload. Export it below.';}
      showLockResult();
    }
    function showLockResult(){
      lockResultBox.replaceChildren();const active=accounts[Number(accountSelect.value)];
      lockResultBox.hidden=!lastLock || (active && (String(active.membershipId)!==String(lastLock.account) || active.membershipType!==lastLock.membershipType));
      if(lockResultBox.hidden)return;
      const ok=lastLock.status==='verified',running=lastLock.status==='running';
      lockResultBox.classList.toggle('error',!ok);
      lockResultBox.append(h('h3',ok?'Last lock changes verified':running?(busy?'Lock changes in progress':'Last lock attempt did not finish'):'Last lock batch stopped'),
        h('small',new Date(lastLock.at).toLocaleString()),h('p',lastLock.accepted+' of '+lastLock.planned+' change requests accepted by Bungie'+(ok?' and verified.':'; the full batch is not verified.')));
      if(lastLock.message)lockResultBox.append(h('p',lastLock.message));
      if(!ok && !busy)lockResultBox.append(h('p','Run a fresh scan before applying more changes.'));
      if(ok)lockResultBox.append(h('p',count(lastLock.locked,'copy','copies')+' locked; '+count(lastLock.unlocked,'copy','copies')+' unlocked. '+(lastLock.checklistSaved?'Checklist saved.':'Checklist was not saved.')));
      if(lastLock.unconfirmed?.length){const details=h('details');details.open=true;details.append(h('summary',count(lastLock.unconfirmed.length,'copy','copies')+' not confirmed'));
        for(const item of lastLock.unconfirmed)details.append(h('p',item.name+' · '+item.location+' · expected '+(item.expectedLocked?'locked':'unlocked')+' · '+item.itemId));lockResultBox.append(details);}
      if(lastLock.excluded?.length){const details=h('details');details.append(h('summary',count(lastLock.excluded.length,'copy','copies')+' left for review; excluded from this lock batch'));
        for(const item of lastLock.excluded)details.append(h('p',item.name+' · '+item.reason),h('small',item.itemId));lockResultBox.append(details);}
      if(lockStorageWarning)lockResultBox.append(h('p',lockStorageWarning,'scan-warning'));
      const exportResult=button('Export last lock result',()=>download(lastLock,kind+'-lock-result.json'));exportResult.dataset.edit='';exportResult.disabled=busy;lockResultBox.append(exportResult);
    }
    function updateButtons(){scanButton.disabled=refreshButton.disabled=busy || !api.connected();sampleButton.disabled=busy;accountSelect.disabled=busy;exportLast.disabled=busy || !lastReport;body.querySelectorAll('[data-apply]').forEach(b=>b.disabled=busy || demo || b.dataset.empty==='true');body.querySelectorAll('select, [data-edit], .scan-fields input').forEach(b=>b.disabled=busy || b.dataset.unavailable==='true');connActions.querySelectorAll('button').forEach(b=>b.disabled=busy);}
    async function run(action){if(busy)return;busy=true;updateButtons();try{await action();}catch(e){status(e.message || 'The scan could not finish.',true);}finally{busy=false;showLockResult();updateButtons();}}
    async function refreshConnection(){
      connection.open=!api.connected();accountSelect.hidden=!api.connected();updateButtons();
      if(api.connected() && !client){await run(async()=>{status('Finding Destiny accounts…');accounts=await api.memberships();accountSelect.replaceChildren();if(!accounts.length)throw new Error('No active Destiny 2 account was found.');
        accounts.forEach((a,n)=>{const o=h('option',(a.bungieGlobalDisplayName || a.displayName || 'Guardian')+' · '+({1:'Xbox',2:'PlayStation',3:'Steam',6:'Epic'}[a.membershipType]));o.value=String(n);accountSelect.append(o);});
        client=api.client(accounts[0]);status('Connected. Ready to scan the vault and all characters.');});}
    }
    async function scanLive(refresh=false){
      demo=false;result=null;savedScan=false;viewSaved.hidden=true;report.replaceChildren();
      if(!client){accounts=await api.memberships();if(accounts.length!==1)throw new Error('Select your Destiny account before scanning.');client=api.client(accounts[0]);}
      status('Reading your vault and every character…');profile=await client.profile();
      core.inventory(profile);defs=await api.definitions(status,{refresh});
      // A first manifest download can outlast the freshness window. Grade a new
      // inventory snapshot after the download instead of failing on the old one.
      if(Date.now()-Date.parse(profile.responseMintedTimestamp)>60000){status('Refreshing inventory after the definition download…');profile=await client.profile();}
      analyze(true);
    }
    async function scanSample(){
      demo=true;const sample=root.VaultScanExample(adapter.catalog);profile=sample.profile;defs=sample.defs;analyze(true);
    }
    function analyze(newScan=false){
      keepers={};reviewDecisions={};savedScan=false;viewSaved.hidden=true;result=core.scan(profile,defs,adapter.catalog,mappings);
      const snapshot=kind==='armor'?core.armorScanSnapshot(result):null;
      const historyKey=snapshot?.account?key+'-last-scan-'+snapshot.membershipType+'-'+snapshot.account:null;
      if(newScan)comparisonBase=!demo && historyKey?read(historyKey,null):null;
      scanChanges=snapshot?core.compareArmorScans(snapshot,comparisonBase):null;
      render();
      let warning='';
      if(snapshot && !demo){
        try{if(!historyKey)throw new Error();localStorage.setItem(historyKey,JSON.stringify(snapshot));}
        catch{warning=' This scan could not be remembered in this browser; the next comparison will use the last remembered scan.';}
      }
      status(demo?'Example only — this cannot save to your checklist or change game locks.':
        (kind==='armor'?armorChangeText():'Scan complete. Review the copies and proposed changes below.')+warning,!!warning);
    }
    function armorChangeText(){
      if(!scanChanges)return 'First scan for comparison. Future scans will show what changed since this scan.';
      return 'Since the last scan: '+count(scanChanges.newCombinations,'new armor combination')+', '+
        count(scanChanges.newCopies,'new copy','new copies')+', '+count(scanChanges.removedCopies,'copy','copies')+' no longer present.'+
        (scanChanges.removedCombinations?' '+count(scanChanges.removedCombinations,'combination')+' no longer matched.':'');
    }
    function stat(value,label){const box=h('div',undefined,'scan-stat');box.append(h('b',String(value)),h('small',label));return box;}
    function weaponReviewComparison(item){
      const section=h('section',undefined,'scan-roll-review'),rolls=core.weaponReviewRolls(item,adapter.catalog.weapons);
      section.append(h('h3','Recommended god roll'));
      if(!rolls.length){
        section.append(h('p','No recommended roll is saved for this weapon in Weapon Vault. Use the lookup below to check its perks before deciding.'));
        item.columns?.forEach((column,n)=>section.append(h('small','This copy · column '+(n+1)+': '+(column.join(' / ') || 'Not confirmed'))));
        section.append(h('small','Origin read: '+(item.origin?.join(' / ') || 'Not confirmed')),h('small','Priority stat read: '+(item.focusStats?.join(' / ') || 'Not confirmed')));
      }else{
        section.append(h('small','From the Weapon Vault catalog. Target one listed option per column, plus the priority stat and origin. ✓ marks a recommendation found on this physical copy.'));
        for(const roll of rolls){
          const card=h('div',undefined,'scan-roll-card'),w=roll.weapon;
          card.append(h('b',w.name),h('small',[w.element,w.archetype,w.source].filter(Boolean).join(' · ')));
          for(const warning of roll.warnings)card.append(h('p',warning,'scan-warning'));
          const wrap=h('div',undefined,'scan-table-wrap'),table=h('table'),caption=h('caption','Recommended perks compared with this copy'),head=h('thead'),tr=h('tr');
          for(const label of ['Slot','Recommended','This copy'])tr.append(h('th',label));head.append(tr);table.append(caption,head);
          const body=h('tbody');
          for(const comparison of roll.rows){
            const row=h('tr'),target=h('td'),actual=h('td');
            if(!comparison.recommended.length)target.append(h('small',comparison.label==='Origin trait'?'No origin required':'No recommendation saved'));
            for(const perk of comparison.recommended){const matched=comparison.matches.includes(perk);target.append(h('span',(matched?'✓ ':'')+perk,'scan-perk'+(matched?' matched':'')));}
            actual.textContent=comparison.actual.join(' / ') || 'Not confirmed';
            row.append(h('th',comparison.label),target,actual);body.append(row);
          }
          table.append(body);wrap.append(table);card.append(wrap);
          if(w.recommendedMod)card.append(h('small','Suggested mod: '+w.recommendedMod));
          if(w.notes)card.append(h('p',w.notes));
          section.append(card);
        }
      }
      if(/^\d+$/.test(String(item.itemHash))){const lookup=h('a','Look up this weapon on light.gg ↗');lookup.href='https://www.light.gg/db/items/'+item.itemHash+'/';lookup.target='_blank';lookup.rel='noopener noreferrer';section.append(lookup);}
      return section;
    }
    function render(){
      const reviewOpen=report.querySelector('[data-review]')?.open || false;
      report.replaceChildren();const plan=core.lockPlan(result,keepers);
      // Manual keep/don't-keep flags on review copies become lock/unlock actions.
      for(const [rid,decision] of Object.entries(reviewDecisions)){
        const item=result.review.find(i=>String(i.id)===String(rid));
        if(!item)continue;
        if(decision==='keep')plan.push({groupId:'review-keep:'+rid,recordId:null,name:item.name,keeper:item,locks:item.locked?[]:[item],unlocks:[],duplicates:[],copies:[item]});
        else if(decision==='drop')plan.push({groupId:'review-drop:'+rid,recordId:null,name:item.name,keeper:item,locks:[],unlocks:item.locked?[item]:[],duplicates:[],copies:[item],manualUnlock:true});
      }
      const stats=h('div',undefined,'scan-stats');stats.append(stat(result.items.filter(i=>i.kind===kind).length,'copies checked'),stat(Object.keys(result.patches).length,'checklist entries matched'),stat(result.review.length,'copies needing review'));
      if(kind==='armor'){
        report.append(h('h3',demo?'Example inventory':scanChanges?'Changes since your last scan':'First scan for comparison'));
        if(scanChanges){
          const changes=h('div',undefined,'scan-stats');changes.append(stat(scanChanges.newCombinations,'new combinations'),stat(scanChanges.newCopies,'new copies'),stat(scanChanges.removedCopies,'copies no longer present'));report.append(changes);
          report.append(h('small','Compared with '+new Date(scanChanges.since).toLocaleString()+'. New copies include duplicates; a combination uses the same distinctions as the keeper groups below.'));
          if(scanChanges.removedCombinations)report.append(h('p',count(scanChanges.removedCombinations,'combination')+' no longer matched. Check the review list for unreadable rolls.'));
        }else report.append(h('p',demo?'Example scans do not replace your last inventory comparison.':'This scan establishes the comparison. Scan again to see new combinations and copies, including after a reload.'));
        const totals=h('details');totals.append(h('summary','Inventory totals and review counts'),stats,h('small',count(result.armor.length,'armor combination')+' currently matched'));report.append(totals);
        if(result.review.length)report.append(h('p',count(result.review.length,'copy','copies')+' need review below.','scan-warning'));
      }else report.append(stats);
      if(kind==='weapon'){
        report.append(h('h3','Best copy for each tracked weapon'),h('p','Keepers prioritize matching both main perk columns, then the number of recommended choices on that copy. A Good roll with more main-perk choices can rank above a God roll with fewer choices.'));
        const choicesText=copy=>'Recommended main-perk choices: '+copy.perkCounts[2]+' + '+copy.perkCounts[3]+' = '+copy.mainPerkChoices;
        const wrap=h('div',undefined,'scan-table-wrap'),table=h('table'),thead=h('thead'),head=h('tr');
        ['Weapon / selected copy','Roll','Recommended perks on this copy','Duplicates'].forEach(t=>head.append(h('th',t)));thead.append(head);table.append(thead);
        const tbody=h('tbody');table.append(tbody);
        for(const group of result.weapons){const w=group.winner,tr=h('tr'),name=h('td');name.append(h('b',w.name),h('small',w.weapon.source+' · '+w.weapon.element),h('small',w.location+' · '+w.power+' Power · '+(w.locked?'locked':'unlocked')),h('small','Instance '+w.id));
          const tier=h('td',w.tier,'scan-tier '+w.tier),perks=h('td');perks.append(h('b',choicesText(w)));w.perks.forEach((p,i)=>perks.append(h('small',(i+1)+': '+(p.join(' / ') || 'No recommended match'))));perks.append(h('small','Priority stat: '+(w.hasFocus?'matched':'not confirmed')));
          const dup=h('td');dup.append(h('b',String(group.copies.length-1)));
          if(group.copies.length>1){const details=h('details');details.append(h('summary','View copies'));for(const copy of group.copies.slice(1)){details.append(h('p',copy.location+' · '+copy.tier+' · '+copy.power+' Power'),h('b',choicesText(copy)),h('small',copy.id+' · '+(copy.locked?'will unlock':'already unlocked')),h('small',copy.columns.map(c=>c.join(' / ')).join(' | ')));}dup.append(details);}
          if(!plan.some(p=>p.recordId===group.recordId))dup.append(h('small','Lock changes paused: another copy needs review','scan-warning'));
          tr.append(name,tier,perks,dup);tbody.append(tr);
        }wrap.append(table);report.append(wrap);
        if(result.exoticWeapons?.length){
          const willLock=result.exoticWeapons.filter(i=>!i.locked).length;
          const details=h('details');
          details.append(h('summary',count(result.exoticWeapons.length,'exotic weapon')+' · kept and locked'+(willLock?' · '+willLock+' to lock':' · already locked')));
          details.append(h('p','Every exotic weapon is kept and locked. Exotics are never proposed for unlocking.'));
          for(const i of result.exoticWeapons)details.append(h('p',i.name+' · '+i.location+' · '+i.power+' Power · '+(i.locked?'already locked':'will lock')),h('small','Instance '+i.id));
          report.append(details);
        }
      }else{
        report.append(h('h3','Keep one copy of each armor combination'),h('p','Legendary and exotic armor keep separate copies for different pieces, classes, archetypes, tertiary stats, gear tiers, and Artifice versions. Exotic class-item perk pairs also stay separate. Suggested keepers use the highest base-stat total. Choose a different copy below if you prefer its distribution.'));
        const statsText=copy=>Object.entries(copy.baseStats).filter(([,value])=>value>0).map(([stat,value])=>stat+' '+value).join(' · ');
        const copyText=copy=>copy.baseTotal+' base total · '+statsText(copy)+' · '+copy.power+' Power · '+copy.location+' · '+(copy.locked?'locked':'unlocked')+' · '+copy.id;
        for(const group of result.armor){
          const action=plan.find(p=>p.groupId===group.groupId),keeper=action?.keeper || group.winner;
          const row=h('div',undefined,'scan-item');
          const combo=keeper.className+' · '+keeper.slot+' · '+keeper.archetype+' / '+keeper.tertiary+' · '+(keeper.gearTier?'Tier '+keeper.gearTier:'Unknown tier')+(keeper.artifice?' · Artifice':'')+
            (keeper.exoticPerks?.length?' · '+keeper.exoticPerks.map(p=>p.name).join(' + '):'');
          row.append(h('b',keeper.name),h('small',combo));
          if(group.copies.length>1 && action){
            const label=h('label','Copy to keep locked'),select=h('select');select.setAttribute('aria-label','Copy to keep: '+keeper.name+' · '+combo);
            for(const copy of group.copies){const option=h('option',copyText(copy)+(copy.id===group.winner.id?' · suggested':''));option.value=copy.id;select.append(option);}select.value=keeper.id;
            select.addEventListener('change',()=>{keepers[group.groupId]=select.value;render();const replacement=[...report.querySelectorAll('select')].find(s=>s.getAttribute('aria-label')===select.getAttribute('aria-label'));replacement?.focus({preventScroll:true});});label.append(select);row.append(label);
          }
          row.append(h('small',(action?'Keep locked: ':'Suggested copy: ')+copyText(keeper)));
          if(!action){row.append(h('small','Lock changes paused for this piece','scan-warning'));
            for(const blocker of core.armorLockBlockers(result,keeper.itemHash))row.append(h('small','Instance '+blocker.instanceId+': '+blocker.reason,'scan-warning'));}
          const duplicates=group.copies.filter(i=>i.id!==keeper.id);
          if(duplicates.length){const details=h('details');details.append(h('summary',duplicates.length+' duplicate'+(duplicates.length===1?'':'s')+(action?' · '+action.unlocks.length+' to unlock':' · review required')));for(const copy of duplicates)details.append(h('p',copyText(copy)),h('small',!action?'Lock unchanged':copy.locked?'Will unlock':'Already unlocked'));row.append(details);}
          else row.append(h('small','Only copy of this combination'));
          report.append(row);
        }
        const exotics=result.armorMatches.filter(i=>i.ownershipOnly);
        if(exotics.length){const details=h('details');details.append(h('summary',count(exotics.length,'exotic copy','exotic copies')+' · ownership tracked, roll needs review'));for(const copy of exotics)details.append(h('p',copy.name+' · '+copy.className+' · '+copy.location+' · '+copy.id),h('small','Locks unchanged: '+(result.review.find(i=>i.id===copy.id)?.reason || 'Roll could not be read')));report.append(details);}
      }
      if(result.review.length){const review=h('details');review.dataset.review='';review.open=reviewOpen;review.append(h('summary','Review '+result.review.length+' unmatched or ambiguous copies'));
        const seen=new Set();for(const item of result.review){const reviewKey=item.id;if(seen.has(reviewKey))continue;seen.add(reviewKey);const row=h('div',undefined,'scan-item');row.append(h('b',item.name),h('small',item.reason+' · item '+item.itemHash),h('small','Instance '+item.id+' · '+item.location));
          if(item.kind==='weapon')row.append(weaponReviewComparison(item));
          if(item.kind==='armor'){row.append(h('small','Archetype read: '+(item.archetype || 'not available')),
            h('small','Base stats: '+(Object.entries(item.baseStats || {}).map(([stat,value])=>stat+' '+value).join(' · ') || 'not available')));}
          const options=item.options?.map(w=>({value:String(w.id),text:w.name+' · '+w.element+' · '+w.source+' · '+w.archetype+' · catalog '+w.id})) || item.setOptions?.map(s=>({value:s.name,text:s.name}));
          if(options?.length){const select=h('select');select.setAttribute('aria-label','Catalog match for '+item.name);const empty=h('option','Choose a catalog match…');empty.value='';select.append(empty);for(const option of options){const o=h('option',option.text);o.value=option.value;select.append(o);}select.addEventListener('change',()=>{if(!select.value)return;mappings={...mappings,[item.itemHash]:select.value};localStorage.setItem('vaultBungieMappings-'+kind,JSON.stringify(mappings));analyze();});row.append(select);}
          if(!demo){row.append(h('small',item.locked?'Currently LOCKED in game':'Currently unlocked in game'));const decision=reviewDecisions[item.id];const acts=h('div',undefined,'scan-actions');
            for(const [value,label,selected] of [['keep','Keep (lock)','✓ Keeping (lock)'],['drop',"Don't keep (unlock)",'✓ Not keeping (unlock)']]){
              const choose=button(decision===value?selected:label,()=>{const scroll=dialog.scrollTop;if(reviewDecisions[item.id]===value)delete reviewDecisions[item.id];else reviewDecisions[item.id]=value;render();dialog.scrollTop=scroll;
                [...report.querySelectorAll('[data-review-copy]')].find(b=>b.dataset.reviewCopy===String(item.id) && b.dataset.decision===value)?.focus({preventScroll:true});},decision===value?'primary':'');
              choose.dataset.edit='';choose.dataset.reviewCopy=String(item.id);choose.dataset.decision=value;choose.setAttribute('aria-pressed',String(decision===value));acts.append(choose);
            }
            row.append(acts);}
          review.append(row);
        }report.append(review);}
      const actions=h('div',undefined,'scan-actions');
      const save=button(savedScan?'Saved to checklist':'Save scan to checklist',()=>run(async()=>{
        save.textContent='Saving…';
        try{await saveScan();}catch(error){save.textContent='Save scan to checklist';throw error;}
      }),'primary');save.dataset.apply='';save.dataset.save='';actions.append(save);
      {
        const changes=plan.reduce((n,g)=>n+g.locks.length+g.unlocks.length,0);
        report.append(h('p','Lock plan: '+count(plan.reduce((n,g)=>n+g.locks.length,0),'selected copy','selected copies')+' to lock; '+count(plan.reduce((n,g)=>n+g.unlocks.length,0),'duplicate')+' to unlock. Each keeper is locked and verified before its duplicates are unlocked. Unlocking allows manual dismantling in game.'));
        const apply=button('Save scan & apply '+count(changes,'lock change'),()=>run(async()=>{
          if(!result || demo)throw new Error('Run a live scan first.');
          backup();status('Rechecking inventory and locking the selected copies…');
          // Clear the preview even after partial failure. A new scan is required to retry.
          const current=result;
          const plannedIds=new Set(plan.flatMap(g=>g.copies.map(i=>i.id)));
          const outcome={version:1,status:'running',at:new Date().toISOString(),kind,account:current.account,membershipType:current.membershipType,planned:changes,accepted:0,locked:0,unlocked:0,checklistSaved:false,
            excluded:current.items.filter(i=>(i.kind===kind || i.kind==='unknown') && !plannedIds.has(i.id)).map(i=>({itemId:i.id,name:i.name,reason:current.review.find(r=>r.id===i.id)?.reason || i.lockIssue || 'A copy of this item family needs review'}))};
          rememberLockResult({...outcome});
          let lockVerified=false;
          try{
            const completed=await core.executeLocks(plan,client,current,(done,step)=>{
              const action=step?.phase==='verify-final'?'Checking the final lock states':step?.phase==='verify-keeper'?'Verifying keeper: '+step.name:(step?.phase==='unlock'?'Unlocking: ':'Locking: ')+(step?.name || 'selected copies');
              status(done.length+' of '+changes+' change requests accepted. '+action+(step?.retrying?' (waiting for Bungie to update)':'')+'…');
              if(step?.accepted)rememberLockResult({...outcome,accepted:done.length});
            });
            lockVerified=true;Object.assign(outcome,{status:'verified',accepted:completed.length,locked:completed.filter(c=>c.state).length,unlocked:completed.filter(c=>!c.state).length,completed});
            lastReport.lockResult={...outcome};rememberLockResult({...outcome});
            await saveScan(false);outcome.checklistSaved=true;lastReport.lockResult={...outcome};rememberLockResult({...outcome});
            status('Checklist saved. '+(kind==='armor'?armorChangeText()+' ':'')+count(completed.length,'lock change')+' verified by Bungie.'+(outcome.excluded.length?' '+count(outcome.excluded.length,'copy','copies')+' left for review and not changed.':''));
          }
          catch(error){
            const failure=lockVerified?{...outcome,message:'Game locks were verified, but saving the checklist failed: '+error.message}:
              {...outcome,status:'failed',message:error.message,accepted:error.completed?.length || 0,completed:error.completed || [],failure:error.lockFailure,unconfirmed:error.unconfirmed || []};
            lastReport.lockResult=failure;rememberLockResult(failure);if(lockVerified)error.message=failure.message;throw error;
          }
          finally{result=null;report.replaceChildren();}
        }),'primary');apply.dataset.apply='';apply.dataset.empty=String(changes===0);actions.append(apply);
      }
      lastReport={version:3,kind,at:result.scannedAt,account:result.account,
        ...(kind==='armor'?{changesSinceLastScan:scanChanges}:{}),
        weapons:result.weapons.map(g=>({catalogId:g.recordId,keeper:g.winner.id,tier:g.winner.tier,perks:g.winner.perks,perkCounts:g.winner.perkCounts,mainColumnsMatched:g.winner.mainColumnsMatched,mainPerkChoices:g.winner.mainPerkChoices,duplicates:g.copies.slice(1).map(i=>i.id)})),
        armor:result.armorMatches.map(i=>({instanceId:i.id,recordId:i.recordId,itemHash:i.itemHash,className:i.className,archetype:i.archetype,tertiary:i.tertiary,gearTier:i.gearTier,artifice:i.artifice,exotic:i.exotic,exoticPerks:i.exoticPerks,ownershipOnly:i.ownershipOnly,baseStats:i.baseStats,location:i.location,locked:i.locked,lockIssue:i.lockIssue})),
        ...(kind==='weapon'?{weaponCopies:core.weaponDiagnostics(result,profile,defs)}:{armorCopies:core.armorDiagnostics(result,profile,defs,keepers)}),
        lockPlan:plan.map(g=>({groupId:g.groupId,keeper:g.keeper.id,locks:g.locks.map(i=>i.id),unlocks:g.unlocks.map(i=>i.id),duplicates:g.duplicates.map(i=>i.id)})),review:result.review.map(i=>({instanceId:i.id,itemHash:i.itemHash,name:i.name,reason:i.reason}))};
      actions.append(button('Export scan report',()=>download(lastReport,kind+'-scan-report.json')));report.append(actions);
      updateButtons();
    }
    function backup(){localStorage.setItem(key+'-before-scan',JSON.stringify({at:new Date().toISOString(),records:adapter.getRecords()}));}
    async function saveScan(makeBackup=true){
      if(!result || demo)throw new Error('Run a live scan first.');
      // Saving this completed snapshot only changes the checklist. Freshness for
      // game lock writes remains enforced independently by core.validatePlan.
      if(makeBackup)backup();
      const records=core.applyRecords(adapter.getRecords(),result,adapter.normalize);
      await adapter.replaceRecords(records);savedScan=true;
      const save=report.querySelector('[data-save]');if(save)save.textContent='Saved to checklist';
      viewSaved.hidden=!adapter.showSavedRecords;
      if(kind==='armor'){
        status('Checklist saved. '+armorChangeText()+' Legendary Farmed checkboxes require all four tertiary variants; exotic checkboxes show ownership. A backup of the previous marks is available below.');
        return;
      }
      status('Saved '+count(Object.keys(result.patches).length,'checklist entry','checklist entries')+'. A backup of the previous marks is available below.');
    }
    function download(data,name){const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=h('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
    showLockResult();
    if(api.connected()){connection.open=false;}else{connection.open=true;}
    return {open:()=>{dialog.showModal();refreshConnection();}};
  }
  root.VaultBungieUI={mount};
})(globalThis);
