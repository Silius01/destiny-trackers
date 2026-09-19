const test=require('node:test');
const assert=require('node:assert/strict');
const core=require('../bungie-core');
const fixture=require('./fixtures/exotic-armor.json');
const archetypes=[
  {name:'Brawler',primary:'Melee',secondary:'Health'},
  {name:'Specialist',primary:'Class',secondary:'Weapons'},
  {name:'Gunner',primary:'Weapons',secondary:'Grenade'},
  {name:'Grenadier',primary:'Grenade',secondary:'Super'}
].map(a=>({...a,tertiaryOptions:['Weapons','Health','Class','Grenade','Super','Melee'].filter(s=>s!==a.primary&&s!==a.secondary)}));
const catalog={kind:'armor',sets:[],archetypes,combos:[
  {id:'athrys',name:"Athrys's Embrace",slot:'Gauntlets',isExotic:true},
  {id:'relativism',name:'Relativism',slot:'Class Item',isExotic:true}
]};
const first='900719925474096101',second='900719925474096102';
function make(samples=[0,0]){
  const defs=structuredClone(fixture.defs);
  const profile={responseMintedTimestamp:new Date().toISOString(),profile:{data:{userInfo:{membershipId:'1234567890123456789',membershipType:3}}},
    characters:{data:{'100':{classType:1,dateLastPlayed:'2026-09-18T00:00:00Z'}}},profileInventory:{data:{items:[]}},
    characterInventories:{data:{'100':{items:[]}}},characterEquipment:{data:{'100':{items:[]}}},
    itemComponents:{sockets:{data:{}},instances:{data:{}},reusablePlugs:{data:{}}}};
  samples.forEach((index,n)=>{
    const s=fixture.samples[index],id='900719925474096'+String(101+n);
    (n%2?profile.characterInventories.data['100'].items:profile.profileInventory.data.items).push({itemHash:s.itemHash,itemInstanceId:id,state:0});
    profile.itemComponents.sockets.data[id]={sockets:structuredClone(s.sockets)};
    profile.itemComponents.instances.data[id]={gearTier:s.gearTier,primaryStat:{value:550}};
    profile.itemComponents.reusablePlugs.data[id]={plugs:{}};
  });
  return {profile,defs,scan:()=>core.scan(profile,defs,catalog)};
}
function rows(p){return [...p.profileInventory.data.items,...p.characterInventories.data['100'].items];}
function client(p,actions=[]){return {
  profile:async()=>structuredClone(p),
  item:async i=>{actions.push(['verify',i.id]);return {item:{data:rows(p).find(r=>r.itemInstanceId===i.id)}};},
  setLock:async(i,locked)=>{actions.push(['lock',i.id,locked]);const raw=rows(p).find(r=>r.itemInstanceId===i.id);raw.state=locked?raw.state|1:raw.state&~1;}
};}
test('real exotic definitions identify Brawler / Weapons and lock one of two unlocked copies',async()=>{
  const f=make(),result=f.scan(),plan=core.lockPlan(result);
  assert.equal(result.review.length,0);assert.equal(plan.length,1);
  assert.equal(plan[0].keeper.archetype,'Brawler');assert.equal(plan[0].keeper.tertiary,'Weapons');
  assert.equal(plan[0].keeper.baseTotal,75);assert.equal(plan[0].locks.length,1);
  await core.executeLocks(plan,client(f.profile),result);
  assert.equal(rows(f.profile).filter(i=>i.state&1).length,1);
});
test('different exotic tertiary rolls and archetypes each retain a keeper',()=>{
  const f=make([0,0,0]);
  f.profile.itemComponents.sockets.data[second].sockets[9].plugHash=2498433744; // Grenade 20
  const third='900719925474096103',ss=f.profile.itemComponents.sockets.data[third].sockets;
  ss[6].plugHash=2937665788;ss[7].plugHash=2515211331;ss[8].plugHash=1370696619; // Grenadier
  const result=f.scan();
  assert.equal(core.lockPlan(result).length,3);assert.equal(core.lockPlan(result).flatMap(g=>g.duplicates).length,0);
});
test('exotic tiers and Artifice versions remain separate',()=>{
  for(const mode of ['tier','artifice']){
    const f=make();
    if(mode==='tier')f.profile.itemComponents.instances.data[second].gearTier=3;
    else{f.defs.items[999]={plug:{plugCategoryHash:3773173029}};f.profile.itemComponents.sockets.data[second].sockets.push({plugHash:999,isVisible:true});}
    assert.equal(core.lockPlan(f.scan()).length,2,mode);
  }
});
test('legacy exotics stay owned and do not permit duplicate unlocks without an archetype',()=>{
  const f=make();f.profile.itemComponents.sockets.data[second].sockets[6]={};
  const result=f.scan();assert.equal(result.patches.athrys.owned,true);
  assert.equal(core.lockPlan(result).length,0);assert.match(result.review[0].reason,/archetype/);
});
test('ambiguous stats and missing class or tier block exotic family lock changes',()=>{
  for(const mode of ['stats','class','tier']){
    const f=make();
    if(mode==='stats')f.defs.items[2041822466].investmentStats.push({statTypeHash:1735777505,value:10});
    if(mode==='class')delete f.defs.items[fixture.samples[0].itemHash].classType;
    if(mode==='tier')delete f.profile.itemComponents.instances.data[second].gearTier;
    assert.equal(core.lockPlan(f.scan()).length,0,mode);
  }
});
test('real exotic class-item perk sockets contribute stats and separate three actual structures',()=>{
  const f=make([1,2,3]),result=f.scan();
  assert.equal(result.review.length,0);assert.equal(core.lockPlan(result).length,3);
  assert.deepEqual(result.armor.map(g=>g.winner.baseTotal),[75,75,75]);
  assert.ok(result.armor.every(g=>g.winner.exoticPerks.length===2));
});
test('different class-item perks remain distinct even when their stat structure matches',()=>{
  const f=make([1,1]);
  f.profile.itemComponents.sockets.data[second].sockets[11].plugHash=3751917994;
  const result=f.scan(),plan=core.lockPlan(result);
  assert.equal(plan.length,2);assert.equal(plan[0].keeper.archetype,plan[1].keeper.archetype);
  assert.equal(plan[0].keeper.tertiary,plan[1].keeper.tertiary);
  assert.notEqual(plan[0].keeper.exoticPerks[1].hash,plan[1].keeper.exoticPerks[1].hash);
});
test('missing or malformed class-item trait sockets block every copy of that exotic',()=>{
  for(const mode of ['socket','category','invisible','definition']){
    const f=make([1,1]);
    if(mode==='socket')f.profile.itemComponents.sockets.data[second].sockets[11]={};
    if(mode==='category')f.defs.items[2809120022].sockets.socketCategories=[];
    if(mode==='invisible')f.profile.itemComponents.sockets.data[second].sockets[11].isVisible=false;
    if(mode==='definition')delete f.defs.items[1476923957];
    assert.equal(core.lockPlan(f.scan()).length,0,mode);
  }
});
test('mods and definition perk pools do not alter the exotic class-item grouping',()=>{
  const f=make([1,1]);
  f.defs.items[999]={plug:{plugCategoryHash:99},investmentStats:[{statTypeHash:2996146975,value:100}]};
  f.profile.itemComponents.sockets.data[second].sockets.push({plugHash:999,isEnabled:true});
  f.profile.itemComponents.reusablePlugs.data[second]={plugs:{11:[{plugItemHash:3751917994,enabled:true}]}};
  const plan=core.lockPlan(f.scan());assert.equal(plan.length,1);assert.equal(plan[0].keeper.baseTotal,75);
  assert.deepEqual(plan[0].keeper.exoticPerks.map(p=>p.hash),[3751917999,1476923957]);
});
test('an exotic replacement keeper is verified before the old keeper is unlocked',async()=>{
  const f=make([1,1]);rows(f.profile)[0].state=1;
  const result=f.scan(),group=result.armor[0],plan=core.lockPlan(result,{[group.groupId]:second}),actions=[];
  await core.executeLocks(plan,client(f.profile,actions),result);
  assert.deepEqual(actions,[['lock',second,true],['verify',second],['lock',first,false]]);
});
test('changed class-item perks invalidate a preview before any writes',async()=>{
  const f=make([1,1]),result=f.scan(),actions=[];
  f.profile.itemComponents.sockets.data[second].sockets[11].plugHash=3751917994;
  await assert.rejects(()=>core.executeLocks(core.lockPlan(result),client(f.profile,actions),result),/changed/);
  assert.deepEqual(actions,[]);
});
test('exotic checklist saves retain separate structures and perk pairs, and rescans replace them',()=>{
  const f=make([0,1,2]),result=f.scan();
  const normalize=r=>({owned:!!r.owned,tertiaries:r.tertiaries||[],scan:r.scan});
  const saved=core.applyRecords({},result,normalize);
  assert.equal(saved.athrys.owned,true);assert.deepEqual(saved.athrys.tertiaries,[]);
  assert.equal(saved.athrys.scan.armorRolls[0].archetype,'Brawler');
  assert.equal(saved.relativism.scan.armorRolls.length,2);
  assert.equal(saved.relativism.scan.armorRolls[0].exoticPerks.length,2);
  const next=core.applyRecords(saved,make([0]).scan(),normalize);
  assert.equal(next.relativism.owned,false);assert.equal(next.relativism.scan,undefined);
});
test('exotic diagnostics report lock decisions and the actual perk pair',()=>{
  const f=make([1,1]),result=f.scan(),report=core.armorDiagnostics(result,f.profile,f.defs);
  assert.equal(report.filter(i=>i.decision==='lock').length,1);
  assert.equal(report.filter(i=>i.decision==='duplicate-already-unlocked').length,1);
  assert.deepEqual(report[0].exoticPerks.map(p=>p.hash),[3751917999,1476923957]);
});
