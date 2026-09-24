const test=require('node:test');
const assert=require('node:assert/strict');
const core=require('../bungie-core');
const example=require('../bungie-example');

const weapon={id:0,name:'Example Rifle',element:'Arc',source:'Test',origin:'Example Origin',archetype:'Adaptive',statFocus:'Range',
  rollCols:[['Barrel'],['Magazine'],['Utility'],['Damage']],
  rollColsRanked:[[{name:'Barrel',pct:50}],[{name:'Magazine',pct:50}],[{name:'Utility',pct:50}],[{name:'Damage',pct:50}]]};
const weapons={kind:'weapon',weapons:[weapon]};

// Copies of the fixture weapon (itemHash 111) across the vault and characters.
function weaponCopies(profile){
  return [...profile.profileInventory.data.items,
    ...profile.characterInventories.data['100'].items,
    ...(profile.characterEquipment.data['100']?.items||[])].filter(r=>r.itemHash===111);
}
// Turn the fixture weapon into an exotic (tierType 6). Optional lockStates array
// overrides the per-copy lock bit (default fixture: one locked, two unlocked).
function exoticFixture(lockStates){
  const f=example(weapons);
  f.defs.items[111].inventory={tierType:6};
  if(lockStates) weaponCopies(f.profile).forEach((r,i)=>{r.state=lockStates[i]?(r.state|1):(r.state&~1);});
  return {...f,result:core.scan(f.profile,f.defs,weapons)};
}
function fakeClient(profile,actions=[]){return {
  profile:async()=>structuredClone(profile),
  item:async i=>{actions.push(['verify',i.id]);return {item:{data:weaponCopies(profile).find(r=>r.itemInstanceId===i.id)}};},
  setLock:async(i,state)=>{actions.push(['set',i.id,state]);const raw=weaponCopies(profile).find(r=>r.itemInstanceId===i.id);raw.state=state?raw.state|1:raw.state&~1;}
};}

test('exotic weapons are collected for locking, not catalog-matched or sent to review',()=>{
  const {result}=exoticFixture();
  assert.equal(result.exoticWeapons.length,3);
  assert.equal(result.weapons.length,0);
  assert.equal(result.review.some(i=>i.exotic),false);
  assert.ok(result.exoticWeapons.every(i=>i.exotic));
});

test('the lock plan locks every exotic weapon and never proposes an unlock',()=>{
  const {result}=exoticFixture();               // fixture: 099101 locked, 099102/099103 unlocked
  const plan=core.lockPlan(result);
  const exoticGroups=plan.filter(g=>g.exoticWeapon);
  assert.equal(exoticGroups.length,3);
  assert.equal(plan.reduce((n,g)=>n+g.unlocks.length,0),0);         // nothing is ever unlocked
  assert.equal(exoticGroups.reduce((n,g)=>n+g.locks.length,0),2);    // the two unlocked copies get locked
});

test('an already-locked exotic weapon needs no change',()=>{
  const {result}=exoticFixture([true,true,true]);
  const groups=core.lockPlan(result).filter(g=>g.exoticWeapon);
  assert.equal(groups.reduce((n,g)=>n+g.locks.length+g.unlocks.length,0),0);
});

test('executing the plan locks unlocked exotic weapons and never unlocks any',async()=>{
  const f=exoticFixture([false,true,false]);
  const actions=[];const client=fakeClient(f.profile,actions);
  await core.executeLocks(core.lockPlan(f.result),client,f.result,()=>{});
  const sets=actions.filter(a=>a[0]==='set');
  assert.ok(sets.length>0);
  assert.ok(sets.every(a=>a[2]===true));         // only lock (true) actions, never unlock (false)
});

test('exotic lock-only plans do not require four perk columns or complete perk data',async()=>{
  for(const mode of ['layout','sockets','definition']){
    const f=exoticFixture([false,false,false]);
    if(mode==='layout')f.defs.items[111].sockets.socketCategories=[];
    if(mode==='sockets')delete f.profile.itemComponents.sockets.data['900719925474099103'];
    if(mode==='definition')delete f.defs.items[f.profile.itemComponents.sockets.data['900719925474099103'].sockets[0].plugHash];
    const result=core.scan(f.profile,f.defs,weapons),plan=core.lockPlan(result);
    assert.equal(result.exoticWeapons.length,3,mode);assert.equal(result.review.length,0,mode);
    assert.equal(plan.reduce((n,g)=>n+g.locks.length,0),3,mode);
    await core.executeLocks(plan,fakeClient(f.profile),result);
    assert.ok(weaponCopies(f.profile).every(i=>i.state&1));
  }
});

test('an unknown item definition does not qualify for automatic exotic locking',()=>{
  const f=exoticFixture();delete f.defs.items[111];
  const result=core.scan(f.profile,f.defs,weapons);
  assert.equal(result.exoticWeapons.length,0);assert.equal(core.lockPlan(result).length,0);assert.equal(result.review.length,3);
});
