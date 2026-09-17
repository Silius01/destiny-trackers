(function(root){
  'use strict';
  const h=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
  const button=(text,action,cls)=>{const b=h('button',text,cls);b.type='button';b.addEventListener('click',action);return b;};
  const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key)) || fallback;}catch{return fallback;}};
  function mount(adapter){
    const kind=adapter.catalog.kind,api=VaultBungie,core=VaultScanCore,key=adapter.storageKey;
    let profile,defs,result,client,accounts=[],busy=false,demo=false;
    let mappings=read('vaultBungieMappings-'+kind,{});
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
    setup.append(h('small','Credentials stay in this browser tab’s session and go directly to Bungie. Public-client sign-in expires after about an hour; reconnect when asked.'));
    const connActions=h('div',undefined,'scan-actions');
    connActions.append(button('Connect Bungie',()=>{try{api.begin(keyInput.value.trim(),idInput.value.trim());}catch(e){status(e.message,true);}},'primary'),button('Disconnect',()=>{api.disconnect();client=null;result=null;report.replaceChildren();keyInput.value='';idInput.value='';status('Disconnected. Saved checklist progress is retained.');refreshConnection();}));setup.append(connActions);
    const controls=h('div',undefined,'scan-actions'),accountSelect=h('select');accountSelect.setAttribute('aria-label','Destiny account');
    accountSelect.addEventListener('change',()=>{result=null;report.replaceChildren();client=api.client(accounts[Number(accountSelect.value)]);updateButtons();});
    const scanButton=button('Scan vault + characters',()=>run(scanLive),'primary');
    const sampleButton=button('Try example scan',()=>run(scanSample));
    controls.append(accountSelect,scanButton,sampleButton);body.append(controls);
    const statusBox=h('div','Connect Bungie to scan your inventory, or try an example.', 'scan-status');statusBox.setAttribute('role','status');statusBox.setAttribute('aria-live','polite');body.append(statusBox);
    const report=h('div');body.append(report);
    const backups=h('div',undefined,'scan-actions');
    backups.append(button('Export checklist backup',()=>download({format:'destiny-vault-backup',version:1,kind,at:new Date().toISOString(),records:adapter.getRecords()},kind+'-vault-backup.json')),
      button('Restore before last scan',()=>run(async()=>{const data=read(key+'-before-scan',null);if(!data?.records)throw new Error('There is no saved pre-scan backup.');await adapter.replaceRecords(data.records);status('Restored the checklist from before the last scan. Game locks are unchanged.');})));body.append(backups);
    const how=h('details');how.append(h('summary','How matching and ranking work'),h('p',kind==='weapon'?
      'God: all four recommended columns plus the priority stat on one copy. Good: recommended column 3 and 4 on one copy. Basic: an owned copy below those requirements. Ties use matching main perks, total matching columns, priority stat, community popularity, existing lock, then Power. Craftable options you have not crafted are never counted. Different catalog versions require a clear match.' :
      'Only base armor stats determine the tertiary stat. Each physical item contributes its own combination. A set/slot/archetype is fully farmed when all four tertiary variants are tracked. Exotic entries track ownership. Armor scans do not change armor locks.'),h('p','Scans update matched entries and preserve earlier manual marks. A rescan replaces the previous scan’s contribution. Unrecognized items remain in the review list.'));body.append(how);
    function status(message,error=false){statusBox.textContent=message;statusBox.classList.toggle('error',error);}
    function updateButtons(){scanButton.disabled=busy || !api.connected();sampleButton.disabled=busy;accountSelect.disabled=busy;body.querySelectorAll('[data-apply]').forEach(b=>b.disabled=busy || demo);}
    async function run(action){if(busy)return;busy=true;updateButtons();try{await action();}catch(e){status(e.message || 'The scan could not finish.',true);}finally{busy=false;updateButtons();}}
    async function refreshConnection(){
      connection.open=!api.connected();accountSelect.hidden=!api.connected();updateButtons();
      if(api.connected() && !client){await run(async()=>{status('Finding Destiny accounts…');accounts=await api.memberships();accountSelect.replaceChildren();if(!accounts.length)throw new Error('No active Destiny 2 account was found.');
        accounts.forEach((a,n)=>{const o=h('option',(a.bungieGlobalDisplayName || a.displayName || 'Guardian')+' · '+({1:'Xbox',2:'PlayStation',3:'Steam',6:'Epic'}[a.membershipType]));o.value=String(n);accountSelect.append(o);});
        client=api.client(accounts[0]);status('Connected. Ready to scan the vault and all characters.');});}
    }
    async function scanLive(){
      demo=false;result=null;report.replaceChildren();
      if(!client){accounts=await api.memberships();if(accounts.length!==1)throw new Error('Select your Destiny account before scanning.');client=api.client(accounts[0]);}
      status('Reading your vault and every character…');profile=await client.profile();
      core.inventory(profile);defs=await api.definitions(status);analyze();
    }
    async function scanSample(){
      demo=true;const sample=root.VaultScanExample(adapter.catalog);profile=sample.profile;defs=sample.defs;analyze();
    }
    function analyze(){result=core.scan(profile,defs,adapter.catalog,mappings);render();status(demo?'Example only — this cannot save to your checklist or change game locks.':'Scan complete. Review the copies and proposed changes below.');}
    function stat(value,label){const box=h('div',undefined,'scan-stat');box.append(h('b',String(value)),h('small',label));return box;}
    function render(){
      report.replaceChildren();const plan=core.lockPlan(result);
      const stats=h('div',undefined,'scan-stats');stats.append(stat(result.items.filter(i=>i.kind===kind).length,'copies checked'),stat(Object.keys(result.patches).length,'checklist entries matched'),stat(result.review.length,'copies needing review'));report.append(stats);
      if(kind==='weapon'){
        report.append(h('h3','Best copy for each tracked weapon'));
        const wrap=h('div',undefined,'scan-table-wrap'),table=h('table'),thead=h('thead'),head=h('tr');
        ['Weapon / selected copy','Roll','Recommended perks on this copy','Duplicates'].forEach(t=>head.append(h('th',t)));thead.append(head);table.append(thead);
        const tbody=h('tbody');table.append(tbody);
        for(const group of result.weapons){const w=group.winner,tr=h('tr'),name=h('td');name.append(h('b',w.name),h('small',w.weapon.source+' · '+w.weapon.element),h('small',w.location+' · '+w.power+' Power · '+(w.locked?'locked':'unlocked')),h('small','Instance '+w.id));
          const tier=h('td',w.tier,'scan-tier '+w.tier),perks=h('td');w.perks.forEach((p,i)=>perks.append(h('small',(i+1)+': '+(p.join(' / ') || 'No recommended match'))));perks.append(h('small','Priority stat: '+(w.hasFocus?'matched':'not confirmed')));
          const dup=h('td');dup.append(h('b',String(group.copies.length-1)));
          if(group.copies.length>1){const details=h('details');details.append(h('summary','View copies'));for(const copy of group.copies.slice(1)){details.append(h('p',copy.location+' · '+copy.tier+' · '+copy.power+' Power'),h('small',copy.id+' · '+(copy.locked?'will unlock':'already unlocked')),h('small',copy.columns.map(c=>c.join(' / ')).join(' | ')));}dup.append(details);}
          if(!plan.some(p=>p.recordId===group.recordId))dup.append(h('small','Lock changes paused: another copy needs review','scan-warning'));
          tr.append(name,tier,perks,dup);tbody.append(tr);
        }wrap.append(table);report.append(wrap);
      }else{
        report.append(h('h3','Armor combinations found'));
        const grouped=new Map();for(const item of result.armorMatches){if(!grouped.has(item.recordId))grouped.set(item.recordId,[]);grouped.get(item.recordId).push(item);}
        for(const [recordId,copies]of grouped){const row=h('div',undefined,'scan-item');row.append(h('b',recordId.replaceAll('/',' · ')),h('small',[...new Set(copies.map(i=>i.tertiary).filter(Boolean))].join(' / ') || 'Owned exotic'),h('small',copies.map(i=>i.className+' · '+i.location+' · '+i.id).join('; ')));report.append(row);}
      }
      if(result.review.length){const review=h('details');review.append(h('summary','Review '+result.review.length+' unmatched or ambiguous copies'));
        const seen=new Set();for(const item of result.review){if(seen.has(item.itemHash))continue;seen.add(item.itemHash);const row=h('div',undefined,'scan-item');row.append(h('b',item.name),h('small',item.reason+' · item '+item.itemHash));
          const options=item.options?.map(w=>({value:String(w.id),text:w.name+' · '+w.element+' · '+w.source+' · '+w.archetype+' · catalog '+w.id})) || item.setOptions?.map(s=>({value:s.name,text:s.name}));
          if(options?.length){const select=h('select');select.setAttribute('aria-label','Catalog match for '+item.name);const empty=h('option','Choose a catalog match…');empty.value='';select.append(empty);for(const option of options){const o=h('option',option.text);o.value=option.value;select.append(o);}select.addEventListener('change',()=>{if(!select.value)return;mappings={...mappings,[item.itemHash]:select.value};localStorage.setItem('vaultBungieMappings-'+kind,JSON.stringify(mappings));analyze();});row.append(select);}review.append(row);
        }report.append(review);}
      const actions=h('div',undefined,'scan-actions');
      const save=button('Save scan to checklist',()=>run(saveScan),'primary');save.dataset.apply='';actions.append(save);
      if(kind==='weapon'){
        const changes=plan.reduce((n,g)=>n+g.locks.length+g.unlocks.length,0);
        report.append(h('p','Lock plan: '+plan.reduce((n,g)=>n+g.locks.length,0)+' best copies to lock; '+plan.reduce((n,g)=>n+g.unlocks.length,0)+' duplicates to unlock. Unlocking allows manual dismantling in game.'));
        const apply=button('Save scan & apply '+changes+' lock changes',()=>run(async()=>{
          if(!result || demo)throw new Error('Run a live scan first.');
          backup();status('Rechecking inventory and locking the selected copies…');
          // Clear the preview even after partial failure. A new scan is required to retry.
          const current=result;
          try{await core.executeLocks(plan,client,current,done=>status(done.length+' lock changes applied…'));await saveScan(false,true);status('Checklist saved. Keeper locks and duplicate unlocks verified.');}
          finally{result=null;report.replaceChildren();}
        }),'primary');apply.dataset.apply='';actions.append(apply);
      }
      actions.append(button('Export scan report',()=>download({version:1,kind,at:result.scannedAt,account:result.account,
        weapons:result.weapons.map(g=>({catalogId:g.recordId,keeper:g.winner.id,tier:g.winner.tier,perks:g.winner.perks,duplicates:g.copies.slice(1).map(i=>i.id)})),
        armor:result.armorMatches.map(i=>({instanceId:i.id,recordId:i.recordId,tertiary:i.tertiary})),review:result.review.map(i=>({instanceId:i.id,name:i.name,reason:i.reason}))},kind+'-scan-report.json')));report.append(actions);
      updateButtons();
    }
    function backup(){localStorage.setItem(key+'-before-scan',JSON.stringify({at:new Date().toISOString(),records:adapter.getRecords()}));}
    async function saveScan(makeBackup=true,locksVerified=false){
      if(!result || demo)throw new Error('Run a live scan first.');
      if(!locksVerified && Date.now()-result.at>5*60*1000)throw new Error('The scan is over five minutes old. Scan again before saving.');
      if(makeBackup)backup();
      const records=core.applyRecords(adapter.getRecords(),result,adapter.normalize);
      await adapter.replaceRecords(records);status('Scan saved to the checklist. A backup of the previous marks is available below.');
    }
    function download(data,name){const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=h('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
    if(api.connected()){connection.open=false;}else{connection.open=true;}
    return {open:()=>{dialog.showModal();refreshConnection();}};
  }
  root.VaultBungieUI={mount};
})(globalThis);
