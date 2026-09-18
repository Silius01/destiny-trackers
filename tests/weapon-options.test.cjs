const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const core=require('../bungie-core'),example=require('../bungie-example');
const html=fs.readFileSync(path.join(__dirname,'../weapon-vault.html'),'utf8');
const bane=JSON.parse(html.match(/const WEAPONS = (\[.*?\]);/)[1]).find(w=>w.name==='Bane of Sorrow');
const catalog={kind:'weapon',weapons:[bane]},multi='900719925474099101',single='900719925474099103';
function fixture(){
  const {profile,defs}=example(catalog);profile.profileInventory.data.items=profile.profileInventory.data.items.slice(0,1);
  const many=profile.itemComponents.sockets.data[multi].sockets,one=profile.itemComponents.sockets.data[single].sockets;
  defs.items[many[3].plugHash].displayProperties.name='Meganeura';
  defs.items[one[2].plugHash].displayProperties.name='Destabilizing Rounds';
  defs.items[one[3].plugHash].displayProperties.name='Mega Kill Clip';
  defs.items[777]={displayProperties:{name:'Enhanced Dimensional Shift'},plug:{plugCategoryHash:100}};
  defs.items[778]={displayProperties:{name:'Enhanced Destabilizing Rounds'},plug:{plugCategoryHash:100}};
  profile.itemComponents.reusablePlugs.data[multi]={plugs:{2:[{plugItemHash:777,canInsert:true,enabled:true},{plugItemHash:778,canInsert:true,enabled:true}]}};
  return {profile,defs};
}
test('Bane of Sorrow with three plus one recommended traits beats one plus one at the same roll tier',()=>{
  const {profile,defs}=fixture(),result=core.scan(profile,defs,catalog);
  assert.equal(result.weapons[0].winner.id,multi);
  assert.deepEqual(result.patches[bane.id].perk2,['Demoralize','Dimensional Shift','Destabilizing Rounds']);
  assert.deepEqual(result.patches[bane.id].perk3,['Meganeura']);
  assert.equal(result.weapons[0].winner.mainPerkChoices,4);
  assert.deepEqual(result.weapons[0].winner.perkCounts,[1,1,3,1]);
});
test('more recommended main-perk choices outrank a better barrel, magazine and masterwork',()=>{
  const {profile,defs}=fixture(),sockets=profile.itemComponents.sockets.data[multi].sockets;
  defs.items[sockets[0].plugHash].displayProperties.name='Other barrel';
  defs.items[sockets[1].plugHash].displayProperties.name='Other magazine';
  sockets.pop();
  const r=core.scan(profile,defs,catalog),g=r.weapons[0];
  assert.equal(g.winner.id,multi);assert.equal(g.winner.tier,'good');assert.equal(g.copies[1].tier,'god');
  assert.equal(r.patches[bane.id].rollTier,'good');assert.equal(r.patches[bane.id].hasFocus,false);
});
test('matching both main columns still beats three recommendations in only one column',()=>{
  const {profile,defs}=fixture();defs.items[profile.itemComponents.sockets.data[multi].sockets[3].plugHash].displayProperties.name='Other damage perk';
  const g=core.scan(profile,defs,catalog).weapons[0];
  assert.equal(g.winner.id,single);assert.equal(g.copies[1].mainPerkChoices,3);assert.equal(g.copies[1].mainColumnsMatched,1);
});
test('unavailable and non-recommended options do not increase the count',()=>{
  const {profile,defs}=fixture(),options=profile.itemComponents.reusablePlugs.data[multi].plugs[2];
  options[0].canInsert=false;options[1].enabled=false;
  defs.items[779]={displayProperties:{name:'Unrecommended trait'},plug:{plugCategoryHash:100}};
  options.push({plugItemHash:779,enabled:true,canInsert:true});
  defs.items[111].sockets.socketEntries=[{randomizedPlugSetHash:42,reusablePlugSetHash:43}];
  defs.plugSets={42:{reusablePlugItems:[{plugItemHash:777},{plugItemHash:778}]}};
  const r=core.scan(profile,defs,catalog),d=core.weaponDiagnostics(r,profile,defs).find(i=>i.instanceId===multi);
  assert.equal(r.weapons[0].winner.id,single);assert.equal(d.mainPerkChoices,2);assert.deepEqual(d.perkCounts,[1,1,1,1]);
});
test('base and enhanced spellings cannot double-count the same recommended trait',()=>{
  const item={id:'1',locked:false,power:1,focusStats:[],columns:[[],[],['Demoralize','Enhanced Demoralize'],['Meganeura']]};
  const weapon={...bane,rollCols:[[],[],['Demoralize','Enhanced Demoralize','Demoralize'],['Meganeura']]};
  const ranked=core.rankWeapon(item,weapon);
  assert.deepEqual(ranked.perkCounts,[0,0,1,1]);assert.equal(ranked.mainPerkChoices,2);
});
test('equal option counts retain quality, popularity and stable tie-breakers',()=>{
  const {profile,defs}=fixture();profile.itemComponents.reusablePlugs.data[multi].plugs={};
  let r=core.scan(profile,defs,catalog);assert.equal(r.weapons[0].winner.id,single);
  const a=profile.itemComponents.sockets.data[multi].sockets,b=profile.itemComponents.sockets.data[single].sockets;
  for(const column of [2,3])defs.items[a[column].plugHash].displayProperties.name=defs.items[b[column].plugHash].displayProperties.name;
  r=core.scan(profile,defs,catalog);assert.equal(r.weapons[0].winner.id,multi,'an existing lock breaks an otherwise equal recommendation');
});
test('the new keeper is locked and verified before the previously selected copy is unlocked',async()=>{
  const {profile,defs}=fixture(),rows=[...profile.profileInventory.data.items,...profile.characterInventories.data['100'].items];
  rows.find(i=>i.itemInstanceId===multi).state=0;rows.find(i=>i.itemInstanceId===single).state=1;
  const r=core.scan(profile,defs,catalog),plan=core.lockPlan(r),actions=[];
  assert.equal(plan[0].keeper.id,multi);assert.deepEqual(plan[0].unlocks.map(i=>i.id),[single]);
  const client={profile:async()=>structuredClone(profile),item:async i=>{actions.push(['verify',i.id]);return {item:{data:rows.find(raw=>raw.itemInstanceId===i.id)}};},
    setLock:async(i,state)=>{actions.push(['set',i.id,state]);rows.find(raw=>raw.itemInstanceId===i.id).state=state?1:0;}};
  await core.executeLocks(plan,client,r);
  assert.deepEqual(actions,[['set',multi,true],['verify',multi],['set',single,false]]);
  assert.equal(rows.find(i=>i.itemInstanceId===multi).state,1);assert.equal(rows.find(i=>i.itemInstanceId===single).state,0);
});
