const test=require('node:test'),assert=require('node:assert/strict');
const core=require('../bungie-core'),example=require('../bungie-example');
const real=require('./fixtures/twisting-echo.json');
const arch={name:'Powerhouse',primary:'Weapons',secondary:'Super',tertiaryOptions:['Health','Class','Melee','Grenade']};
const combo={id:'Yearning Echo/Helmet/Powerhouse',setName:'Yearning Echo',slot:'Helmet',archetype:'Powerhouse'};
const catalog={kind:'armor',sets:[{name:'Yearning Echo'}],archetypes:[arch],combos:[combo]};
const ids=['900719925474098101','900719925474098102','900719925474098103'];
const rows=p=>[...p.profileInventory.data.items,...p.characterInventories.data['100'].items];
function fixture(){
  const {profile}=example(catalog),defs=structuredClone(real.defs);
  profile.characters.data['100'].classType=1;
  for(const [index,id]of ids.entries()){
    const raw=rows(profile).find(i=>i.itemInstanceId===id);raw.itemHash=3229172222;raw.state=0;
    profile.itemComponents.sockets.data[id]={sockets:[real.statPlugs.Weapons,real.statPlugs.Super,real.statPlugs[index===1?'Class':'Health'],544009373]
      .map((plugHash,index)=>({plugHash,isEnabled:true,isVisible:index===3}))};
  }
  return {profile,defs};
}
test('real Twisting Echo definitions identify Powerhouse + Health and propose one keeper for two unlocked copies',()=>{
  const {profile,defs}=fixture(),r=core.scan(profile,defs,catalog),plan=core.lockPlan(r);
  assert.deepEqual(r.review,[]);assert.equal(r.armor.length,2);
  assert.deepEqual(r.patches[combo.id].tertiaries,['Health','Class']);
  const health=plan.find(g=>g.keeper.tertiary==='Health'),other=plan.find(g=>g.keeper.tertiary==='Class');
  assert.equal(health.copies.length,2);assert.equal(health.locks.length,1);assert.equal(health.unlocks.length,0);
  assert.equal(health.keeper.id,ids[0]);assert.deepEqual(health.duplicates.map(i=>i.id),[ids[2]]);
  assert.equal(other.keeper.id,ids[1]);assert.equal(other.locks.length,1);
});
test('armor diagnostics use base Health roll despite visible stat-mod and tuning bonuses',()=>{
  const {profile,defs}=fixture();
  for(const [hash,category]of [[998,2487827355],[999,3481777685]]){
    defs.items[hash]={hash,displayProperties:{name:'Synthetic bonus'},plug:{plugCategoryHash:category},investmentStats:[{statTypeHash:1735777505,value:20}]};
    profile.itemComponents.sockets.data[ids[0]].sockets.push({plugHash:hash,isEnabled:true,isVisible:true});
  }
  const r=core.scan(profile,defs,catalog),d=core.armorDiagnostics(r,profile,defs).find(i=>i.instanceId===ids[0]);
  assert.equal(d.tertiary,'Health');assert.deepEqual(d.baseStats,{Weapons:30,Super:25,Health:20});
  assert.equal(d.sockets.at(-1).stats[0].name,'Grenade');assert.equal(d.decision,'lock');
});
test('report names the unreadable copy that blocks locks for otherwise valid tertiary groups',()=>{
  const {profile,defs}=fixture();profile.itemComponents.sockets.data[ids[1]].sockets.pop();
  const r=core.scan(profile,defs,catalog),d=core.armorDiagnostics(r,profile,defs);
  assert.equal(core.lockPlan(r).length,0);
  for(const id of [ids[0],ids[2]]){
    const item=d.find(i=>i.instanceId===id);assert.equal(item.tertiary,'Health');assert.equal(item.decision,'blocked');
    assert.deepEqual(item.blockers,[{instanceId:ids[1],reason:'Armor 3.0 archetype could not be identified'}]);
  }
  assert.equal(d.find(i=>i.instanceId===ids[1]).decision,'review');
});
test('armor report follows the selected keeper and excludes credentials or unrelated profile data',()=>{
  const {profile,defs}=fixture();profile.apiKey='secret';profile.access_token='secret';
  const r=core.scan(profile,defs,catalog),g=r.armor.find(g=>g.winner.tertiary==='Health');
  const d=core.armorDiagnostics(r,profile,defs,{[g.groupId]:ids[2]});
  assert.equal(d.find(i=>i.instanceId===ids[2]).decision,'lock');
  assert.equal(d.find(i=>i.instanceId===ids[0]).decision,'duplicate-already-unlocked');
  assert.equal(d.find(i=>i.instanceId===ids[0]).keeper,ids[2]);
  assert.equal(/secret|access_token|apiKey|Authorization/.test(JSON.stringify(d)),false);
});
test('applying the Twisting Echo plan leaves exactly one Health copy locked and preserves the Class keeper',async()=>{
  const {profile,defs}=fixture(),r=core.scan(profile,defs,catalog);
  const client={profile:async()=>structuredClone(profile),item:async i=>({item:{data:rows(profile).find(raw=>raw.itemInstanceId===i.id)}}),
    setLock:async(i,state)=>{const raw=rows(profile).find(raw=>raw.itemInstanceId===i.id);raw.state=state?raw.state|1:raw.state&~1;}};
  const completed=await core.executeLocks(core.lockPlan(r),client,r);
  assert.equal(completed.length,2);
  assert.equal([ids[0],ids[2]].filter(id=>rows(profile).find(i=>i.itemInstanceId===id).state&1).length,1);
  assert.equal(rows(profile).find(i=>i.itemInstanceId===ids[1]).state&1,1);
});
