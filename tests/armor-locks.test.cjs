const test=require('node:test');
const assert=require('node:assert/strict');
const core=require('../bungie-core');
const example=require('../bungie-example');
const arch={name:'Brawler',primary:'Melee',secondary:'Health',tertiaryOptions:['Weapons','Class','Grenade','Super']};
const catalog={kind:'armor',sets:[{name:'Example Set'}],archetypes:[arch],combos:[{id:'Example Set/Helmet/Brawler',setName:'Example Set',slot:'Helmet',archetype:'Brawler'}]};
const first='900719925474098101',other='900719925474098102',best='900719925474098103';
function fresh(){const f=example(catalog);return {...f,result:core.scan(f.profile,f.defs,catalog)};}
function copies(profile){return [...profile.profileInventory.data.items,...profile.characterInventories.data['100'].items,...profile.characterEquipment.data['100'].items];}
function fakeClient(profile,actions=[]){return {
  profile:async()=>structuredClone(profile),
  item:async i=>{actions.push(['verify',i.id]);return {item:{data:copies(profile).find(raw=>raw.itemInstanceId===i.id)}};},
  setLock:async(i,state)=>{actions.push(['set',i.id,state]);const raw=copies(profile).find(raw=>raw.itemInstanceId===i.id);raw.state=state?raw.state|1:raw.state&~1;}
};}

test('armor keeps each tertiary separately and chooses highest base total across vault and characters',()=>{
  const {result}=fresh(),plan=core.lockPlan(result);
  assert.equal(result.armor.length,2);assert.equal(plan.length,2);
  const group=plan.find(g=>g.keeper.tertiary==='Weapons');
  assert.equal(group.keeper.id,best);assert.equal(group.keeper.baseTotal,80);
  assert.deepEqual(group.unlocks.map(i=>i.id),[first]);
  assert.equal(plan.find(g=>g.keeper.tertiary==='Class').keeper.id,other);
  assert.deepEqual(result.patches[catalog.combos[0].id].tertiaries,['Weapons','Class']);
});
test('armor tie prefers an existing lock, then Power; stat mods cannot improve ranking',()=>{
  const {profile,defs}=fresh();
  const plug=profile.itemComponents.sockets.data[best].sockets[0].plugHash;
  defs.items[plug].investmentStats[0].value=30;
  defs.items[999]={displayProperties:{name:'Stat mod'},plug:{plugCategoryHash:99},investmentStats:[{statTypeHash:2996146975,value:100}]};
  profile.itemComponents.sockets.data[best].sockets.push({plugHash:999});
  let result=core.scan(profile,defs,catalog);
  assert.equal(result.armor.find(g=>g.winner.tertiary==='Weapons').winner.id,first);
  copies(profile).find(i=>i.itemInstanceId===first).state=0;
  profile.itemComponents.instances.data[best].primaryStat.value=2001;
  result=core.scan(profile,defs,catalog);
  assert.equal(result.armor.find(g=>g.winner.tertiary==='Weapons').winner.id,best);
});
test('different item definitions, classes, tiers and Artifice status are never duplicate groups',()=>{
  for(const change of ['piece','class','tier','artifice']){
    const {profile,defs}=fresh();
    if(change==='piece'||change==='class'){
      defs.items[334]=structuredClone(defs.items[333]);
      if(change==='class')defs.items[334].classType=1;
      copies(profile).find(i=>i.itemInstanceId===best).itemHash=334;
    }
    if(change==='tier')profile.itemComponents.instances.data[best].gearTier=5;
    if(change==='artifice'){
      defs.items[999]={displayProperties:{name:'Artifice mod'},plug:{plugCategoryHash:3773173029}};
      profile.itemComponents.sockets.data[best].sockets.push({plugHash:999,isVisible:true});
    }
    const result=core.scan(profile,defs,catalog),plan=core.lockPlan(result);
    assert.equal(result.armor.length,3,change);assert.equal(plan.flatMap(g=>g.duplicates).length,0,change);
  }
});
test('different archetypes of the same piece are never duplicates',()=>{
  const {profile,defs}=fresh();
  const secondArch={...arch,name:'Other archetype'};
  const expanded={...catalog,archetypes:[arch,secondArch],combos:[...catalog.combos,{...catalog.combos[0],id:'Other combo',archetype:secondArch.name}]};
  const plug=profile.itemComponents.sockets.data[best].sockets[1].plugHash;
  defs.items[plug].displayProperties.name=secondArch.name;
  const result=core.scan(profile,defs,expanded);
  assert.equal(result.armor.length,3);assert.equal(core.lockPlan(result).flatMap(g=>g.duplicates).length,0);
});
test('manual keeper choice changes only that group and must be an actual member',()=>{
  const {result}=fresh(),group=result.armor.find(g=>g.winner.tertiary==='Weapons');
  const plan=core.lockPlan(result,{[group.groupId]:first});
  assert.equal(plan.find(g=>g.groupId===group.groupId).keeper.id,first);
  assert.deepEqual(plan.find(g=>g.groupId===group.groupId).duplicates.map(i=>i.id),[best]);
  assert.equal(plan.find(g=>g.keeper.tertiary==='Class').keeper.id,other);
  assert.equal(core.lockPlan(result,{[group.groupId]:other}).find(g=>g.groupId===group.groupId).keeper.id,best);
});
test('unknown class, tier, or unreadable same-piece copy prevents armor lock changes',()=>{
  for(const mode of ['class','tier','sockets','tertiary']){
    const {profile,defs}=fresh();
    if(mode==='class')delete defs.items[333].classType;
    if(mode==='tier')delete profile.itemComponents.instances.data[first].gearTier;
    if(mode==='sockets')delete profile.itemComponents.sockets.data[first];
    if(mode==='tertiary')defs.items[profile.itemComponents.sockets.data[first].sockets[0].plugHash].investmentStats.push({statTypeHash:1735777505,value:1});
    assert.equal(core.lockPlan(core.scan(profile,defs,catalog)).length,0,mode);
  }
});
test('exotics track ownership and keep a separate copy of each archetype and tertiary',()=>{
  const {profile,defs}=fresh();defs.items[333].inventory.tierType=6;
  const exoticCatalog={...catalog,combos:[{id:'exotic',name:'Example Set Helmet',slot:'Helmet',isExotic:true}]};
  const result=core.scan(profile,defs,exoticCatalog);
  assert.equal(result.armorMatches.length,3);assert.equal(result.patches.exotic.owned,true);
  assert.equal(result.armor.length,2);
  assert.equal(core.lockPlan(result).find(g=>g.keeper.tertiary==='Weapons').keeper.id,best);
  assert.deepEqual(core.lockPlan(result).flatMap(g=>g.unlocks).map(i=>i.id),[first]);
});
test('multiple combinations with one item hash pass preflight and keep one verified lock per combo',async()=>{
  const {profile,result}=fresh(),plan=core.lockPlan(result),actions=[];
  const completed=await core.executeLocks(plan,fakeClient(profile,actions),result);
  assert.equal(completed.length,3);
  const verify=actions.findIndex(a=>a[0]==='verify'&&a[1]===best),unlock=actions.findIndex(a=>a[0]==='set'&&a[1]===first&&a[2]===false);
  assert.ok(verify>=0 && unlock>verify);
  assert.equal(copies(profile).find(i=>i.itemInstanceId===first).state&1,0);
  for(const id of [best,other])assert.equal(copies(profile).find(i=>i.itemInstanceId===id).state&1,1);
});
test('preflight detects tier and socket changes in another combo of the same piece',()=>{
  const {profile,result}=fresh(),plan=core.lockPlan(result).filter(g=>g.keeper.tertiary==='Weapons');
  for(const mode of ['tier','sockets']){
    const changed=structuredClone(profile);
    if(mode==='tier')changed.itemComponents.instances.data[other].gearTier=4;
    else changed.itemComponents.sockets.data[other].sockets.pop();
    assert.throws(()=>core.validatePlan(plan,result,changed),/changed/);
  }
});
test('failed keeper verification and failed final verification are reported for armor',async()=>{
  const {profile,result}=fresh(),plan=core.lockPlan(result),actions=[],client=fakeClient(profile,actions);
  client.item=async()=>({item:{data:{state:0}}});
  await assert.rejects(()=>core.executeLocks(plan,client,result),/Keeper lock/);
  assert.equal(actions.some(a=>a[0]==='set'&&a[2]===false),false);
  const f=fresh(),mock=fakeClient(f.profile);mock.setLock=async(i,state)=>{if(state)copies(f.profile).find(raw=>raw.itemInstanceId===i.id).state|=1;};
  await assert.rejects(()=>core.executeLocks(core.lockPlan(f.result),mock,f.result),/not confirmed every lock change/);
});
