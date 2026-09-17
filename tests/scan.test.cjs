const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const core=require('../bungie-core');
const example=require('../bungie-example');
const weapon={id:0,name:'Example Rifle',element:'Arc',source:'Test',origin:'Example Origin',archetype:'Adaptive',statFocus:'Range',rollCols:[['Barrel'],['Magazine'],['Utility'],['Damage']],rollColsRanked:[[{name:'Barrel',pct:50}],[{name:'Magazine',pct:50}],[{name:'Utility',pct:50}],[{name:'Damage',pct:50}]]};
const weapons={kind:'weapon',weapons:[weapon]};
const arch={name:'Brawler',primary:'Melee',secondary:'Health',tertiaryOptions:['Weapons','Class','Grenade','Super']};
const armor={kind:'armor',sets:[{name:'Example Set'}],archetypes:[arch],combos:[{id:'Example Set/Helmet/Brawler',setName:'Example Set',slot:'Helmet',archetype:'Brawler'}]};
function fresh(catalog=weapons){const f=example(catalog);return {...f,result:core.scan(f.profile,f.defs,catalog)};}
function normalized(r){return {owned:!!r.owned,rollTier:r.rollTier || 'none',tertiaries:r.tertiaries || [],...r};}

test('one winning physical copy supplies every tracked perk',()=>{
  const {result}=fresh();assert.equal(result.weapons.length,1);assert.equal(result.weapons[0].copies.length,3);
  assert.equal(result.weapons[0].winner.tier,'god');assert.equal(result.patches[0].scan.instanceId,'900719925474099103');
  assert.deepEqual(result.patches[0].perk2,['Utility']);assert.deepEqual(result.patches[0].perk3,['Damage']);
});
test('two complementary copies cannot create a good or god roll',()=>{
  const {profile,defs}=fresh();profile.characterInventories.data['100'].items=[];
  const scan=core.scan(profile,defs,weapons);assert.equal(scan.patches[0].rollTier,'basic');
  assert.equal(scan.patches[0].perk3.length,0);assert.equal(scan.weapons[0].winner.id,'900719925474099101');
});
test('selectable perks on this same instance count; locked/unavailable options do not',()=>{
  const {profile,defs}=fresh();profile.characterInventories.data['100'].items=[];
  const item=profile.profileInventory.data.items[0];const damageHash=Object.entries(defs.items).find(([,d])=>d.displayProperties.name==='Damage')[0];
  profile.itemComponents.reusablePlugs.data[item.itemInstanceId]={plugs:{3:[{plugItemHash:Number(damageHash),canInsert:true,enabled:true}]}};
  assert.equal(core.scan(profile,defs,weapons).patches[0].rollTier,'god');
  profile.itemComponents.reusablePlugs.data[item.itemInstanceId].plugs[3][0].canInsert=false;
  assert.equal(core.scan(profile,defs,weapons).patches[0].rollTier,'basic');
});
test('definition crafting/random pools never count as owned perks',()=>{
  const {profile,defs}=fresh();profile.characterInventories.data['100'].items=[];
  defs.items[111].sockets.socketEntries=[{randomizedPlugSetHash:555,reusablePlugSetHash:556}];
  defs.plugSets={555:{reusablePlugItems:[{plugItemHash:777}]}};
  assert.equal(core.scan(profile,defs,weapons).patches[0].rollTier,'basic');
});
test('enhanced names match the base recommendation',()=>{
  const {profile,defs}=fresh();const socket=profile.itemComponents.sockets.data['900719925474099103'].sockets[2];
  defs.items[socket.plugHash].displayProperties.name='Enhanced Utility';
  assert.equal(core.scan(profile,defs,weapons).patches[0].rollTier,'god');
});
test('priority stat must belong to the chosen instance',()=>{
  const {profile,defs}=fresh();profile.itemComponents.sockets.data['900719925474099103'].sockets.pop();
  const r=core.scan(profile,defs,weapons);assert.equal(r.patches[0].rollTier,'good');assert.equal(r.patches[0].hasFocus,false);
});
test('equal-quality ties favor existing locked copy, then power, with stable ID fallback',()=>{
  const base={id:'1',locked:true,power:10,columns:[['Barrel'],['Magazine'],['Utility'],['Damage']],focusStats:['Range']};
  const a=core.rankWeapon(base,weapon),b=core.rankWeapon({...base,id:'2',locked:false,power:100},weapon);
  assert.equal(a.score[6],1);assert.equal(b.score[6],0);
});
test('ambiguous same-name versions require mapping; a wrong origin cannot silently match',()=>{
  const {profile,defs}=fresh();const catalog={kind:'weapon',weapons:[weapon,{...weapon,id:1,source:'Other season'}]};
  assert.equal(core.scan(profile,defs,catalog).weapons.length,0);
  assert.equal(core.scan(profile,defs,catalog,{'111':'1'}).weapons[0].recordId,'1');
  const other={kind:'weapon',weapons:[{...weapon,origin:'Different Origin'}]};
  assert.equal(core.scan(profile,defs,other).weapons.length,0);
});
test('sheet version annotations are removed only for candidate matching; origins still separate versions',()=>{
  const {profile,defs}=fresh();const catalog={kind:'weapon',weapons:[{...weapon,origin:'Old Origin'},{...weapon,id:1,name:weapon.name+' – BRAVE version'}]};
  assert.equal(core.scan(profile,defs,catalog).weapons[0].recordId,'1');
});
test('partial inventory, duplicate locations, unsafe IDs and missing components fail closed',()=>{
  for(const breakIt of [p=>delete p.characterEquipment.data['100'],p=>p.profileInventory.data.items.push(p.profileInventory.data.items[0]),p=>p.profileInventory.data.items[0].itemInstanceId=900719925474099100,p=>delete p.itemComponents.reusablePlugs]){
    const {profile,defs}=fresh();breakIt(profile);assert.throws(()=>core.scan(profile,defs,weapons));
  }
});
test('missing or stale Bungie timestamps cannot authorize a scan',()=>{
  const {profile,defs}=fresh();delete profile.responseMintedTimestamp;assert.throws(()=>core.scan(profile,defs,weapons),/stale/);
  profile.responseMintedTimestamp=new Date(Date.now()-180001).toISOString();assert.throws(()=>core.scan(profile,defs,weapons),/stale/);
});
test('unreadable copy prevents its whole family from having locks changed',()=>{
  const {profile,defs}=fresh();delete profile.itemComponents.sockets.data['900719925474099101'];
  const r=core.scan(profile,defs,weapons);assert.equal(r.review.length,1);assert.equal(core.lockPlan(r).length,0);
});
test('armor tracks separate tertiary combinations from base stats, not mods',()=>{
  const {profile,defs,result}=fresh(armor);const r=result.patches[armor.combos[0].id];
  assert.deepEqual(r.tertiaries,['Weapons','Class']);assert.equal(r.owned,false);
  defs.items[999]={displayProperties:{name:'Grenade mod'},plug:{plugCategoryHash:99},investmentStats:[{statTypeHash:1735777505,value:50}]};
  profile.itemComponents.sockets.data['900719925474098101'].sockets.push({plugHash:999,isEnabled:true});
  assert.deepEqual(core.scan(profile,defs,armor).patches[armor.combos[0].id].tertiaries,['Weapons','Class']);
});
test('ambiguous armor base stat stays in review',()=>{
  const {profile,defs}=fresh(armor);const s=profile.itemComponents.sockets.data['900719925474098101'].sockets[0];
  defs.items[s.plugHash].investmentStats.push({statTypeHash:1735777505,value:5});
  assert.equal(core.scan(profile,defs,armor).review.length,1);
});
test('unrecognized armor set can be mapped without guessing',()=>{
  const {profile,defs}=fresh(armor);defs.items[333].displayProperties.name='Unfamiliar Helm';defs.sets={};
  assert.equal(core.scan(profile,defs,armor).review.length,2);
  assert.equal(core.scan(profile,defs,armor,{'333':'Example Set'}).armorMatches.length,2);
});
test('a rescan replaces the scan contribution and preserves manual marks',()=>{
  const {result}=fresh(armor),recordId=armor.combos[0].id;
  const records={[recordId]:{owned:false,tertiaries:['Super']}};
  const first=core.applyRecords(records,result,normalized);
  assert.deepEqual(first[recordId].tertiaries,['Super','Weapons','Class']);
  const second=core.applyRecords(first,{...result,patches:{},armorMatches:[]},normalized);
  assert.deepEqual(second[recordId].tertiaries,['Super']);
  assert.equal(records[recordId].tertiaries.length,1);
});
test('old preview, changed account, changed perks, changed lock and new copies invalidate locks',()=>{
  const {result,profile}=fresh(),plan=core.lockPlan(result);
  assert.throws(()=>core.validatePlan(plan,result,profile,result.at+300001),/five minutes/);
  for(const mutate of [p=>p.profile.data.userInfo.membershipId='999',p=>p.itemComponents.sockets.data['900719925474099103'].sockets.pop(),p=>p.profileInventory.data.items[0].state=0,p=>p.profileInventory.data.items.push({...p.profileInventory.data.items[0],itemInstanceId:'1234567890'})]){
    const p=structuredClone(profile);mutate(p);assert.throws(()=>core.validatePlan(plan,result,p));
  }
});
test('lock keeper and verify before unlocking duplicates, then verify final inventory',async()=>{
  const {result,profile}=fresh(),plan=core.lockPlan(result),actions=[];
  const items=()=>[...profile.profileInventory.data.items,...profile.characterInventories.data['100'].items];
  const client={profile:async()=>structuredClone(profile),setLock:async(item,state)=>{actions.push(['set',item.id,state]);const raw=items().find(i=>i.itemInstanceId===item.id);raw.state=state?raw.state|1:raw.state&~1;},item:async item=>{actions.push(['verify',item.id]);return {item:{data:items().find(i=>i.itemInstanceId===item.id)}};}};
  const completed=await core.executeLocks(plan,client,result);
  assert.deepEqual(actions.map(a=>a[0]),['set','verify','set']);assert.equal(actions[0][2],true);assert.equal(actions[2][2],false);assert.equal(completed.length,2);
});
test('keeper lock failure or unverified lock cannot unlock a duplicate',async()=>{
  for(const mode of ['failure','unverified']){
    const {result,profile}=fresh();const calls=[];
    const client={profile:async()=>profile,setLock:async(i,state)=>{calls.push(state);if(mode==='failure')throw new Error('API unavailable');},item:async()=>({item:{data:{state:0}}})};
    await assert.rejects(()=>core.executeLocks(core.lockPlan(result),client,result));assert.deepEqual(calls,[true]);
  }
});
test('published app inline scripts parse and preserve scan metadata during normalization',()=>{
  for(const kind of ['weapon','armor']){
    const html=fs.readFileSync(path.join(__dirname,'..',kind+'-vault.html'),'utf8');
    const script=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n');new vm.Script(script);
    assert.match(script,/scan: raw.scan/);assert.match(script,/delete state.records\[(key|id)\].scan/);assert.match(script,/VaultBungieUI.mount/);
    const context={};const constant=script.match(/const DEFAULT_RECORD = .*?;/)[0];
    const fn=script.slice(script.indexOf('function normalizeRecord('),script.indexOf('function loadLocal('));
    vm.runInNewContext(constant+"\nconst ROLL_TIERS=['basic','good','god'];const PERK_KEYS=['perk0','perk1','perk2','perk3'];\n"+fn+'\nthis.normalize=normalizeRecord;',context);
    const record=context.normalize({owned:true,scan:{source:'bungie',instanceId:'900719925474099103',before:{owned:false}}});
    assert.equal(record.scan.instanceId,'900719925474099103');
  }
});
