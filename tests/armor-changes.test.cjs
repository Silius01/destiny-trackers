const test=require('node:test');
const assert=require('node:assert/strict');
const core=require('../bungie-core');
const example=require('../bungie-example');
const arch={name:'Brawler',primary:'Melee',secondary:'Health',tertiaryOptions:['Weapons','Class','Grenade','Super']};
const catalog={kind:'armor',sets:[{name:'Example Set'}],archetypes:[arch],combos:[{id:'Example Set/Helmet/Brawler',setName:'Example Set',slot:'Helmet',archetype:'Brawler'}]};
const first='900719925474098101',best='900719925474098103';
const snapshot=f=>core.armorScanSnapshot(core.scan(f.profile,f.defs,catalog));
function addCopy(f,id,tertiary){
  f.profile.profileInventory.data.items.push({...f.profile.profileInventory.data.items[0],itemInstanceId:id,state:0});
  f.profile.itemComponents.instances.data[id]=structuredClone(f.profile.itemComponents.instances.data[first]);
  f.profile.itemComponents.sockets.data[id]=structuredClone(f.profile.itemComponents.sockets.data[first]);
  if(tertiary){
    f.defs.items[999]=structuredClone(f.defs.items[f.profile.itemComponents.sockets.data[first].sockets[0].plugHash]);
    f.defs.items[999].investmentStats[2].statTypeHash=tertiary;
    f.profile.itemComponents.sockets.data[id].sockets[0].plugHash=999;
  }
}
test('first scan and incompatible or damaged baselines establish a comparison without claiming everything is new',()=>{
  const current=snapshot(example(catalog));
  for(const previous of [null,{}, {...current,version:0},{...current,account:'another'},
    {...current,membershipType:1},{...current,copies:null},{...current,combinations:[1]},{...current,scannedAt:'bad'}]){
    assert.equal(core.compareArmorScans(current,previous),null);
  }
});
test('identical scans report zero new changes even after serializing for reload',()=>{
  const f=example(catalog),previous=JSON.parse(JSON.stringify(snapshot(f)));
  assert.deepEqual(core.compareArmorScans(snapshot(f),previous),{
    since:previous.scannedAt,newCombinations:0,removedCombinations:0,newCopies:0,removedCopies:0});
  assert.equal(previous.combinations.length,2);assert.equal(previous.copies.length,3);
});
test('a new tertiary and a duplicate add two copies but only one new combination',()=>{
  const f=example(catalog),previous=snapshot(f);
  addCopy(f,'900719925474098104',1735777505);
  addCopy(f,'900719925474098105');
  const delta=core.compareArmorScans(snapshot(f),previous);
  assert.equal(delta.newCopies,2);assert.equal(delta.newCombinations,1);
  assert.equal(delta.removedCopies,0);assert.equal(delta.removedCombinations,0);
});
test('replacing a copy is detected even when total copies and combinations stay the same',()=>{
  const f=example(catalog),previous=snapshot(f);
  f.profile.profileInventory.data.items=f.profile.profileInventory.data.items.filter(i=>i.itemInstanceId!==first);
  addCopy(f,'900719925474098104');
  const delta=core.compareArmorScans(snapshot(f),previous);
  assert.equal(delta.newCopies,1);assert.equal(delta.removedCopies,1);assert.equal(delta.newCombinations,0);
});
test('moving between vault and character, locking or changing Power is not a new copy or combination',()=>{
  const f=example(catalog),previous=snapshot(f);
  const raw=f.profile.characterInventories.data['100'].items.pop();raw.state=1;
  f.profile.profileInventory.data.items.push(raw);
  f.profile.itemComponents.instances.data[best].primaryStat.value=2500;
  const delta=core.compareArmorScans(snapshot(f),previous);
  assert.equal(delta.newCopies,0);assert.equal(delta.newCombinations,0);assert.equal(delta.removedCopies,0);
});
test('removing the last copy of a tertiary reports the missing combination',()=>{
  const f=example(catalog),previous=snapshot(f);
  f.profile.profileInventory.data.items=f.profile.profileInventory.data.items.filter(i=>i.itemInstanceId===first);
  const delta=core.compareArmorScans(snapshot(f),previous);
  assert.equal(delta.removedCopies,1);assert.equal(delta.removedCombinations,1);assert.equal(delta.newCombinations,0);
});
test('tier distinctions and exotic perk pairs retain their existing group identities',()=>{
  const f=example(catalog),previous=snapshot(f);
  f.profile.itemComponents.instances.data[best].gearTier=5;
  assert.equal(core.compareArmorScans(snapshot(f),previous).newCombinations,1);
  const exotic={...core.scan(f.profile,f.defs,catalog),armor:[{groupId:'exotic-pair-a'},{groupId:'exotic-pair-b'}]};
  const base=core.armorScanSnapshot({...exotic,armor:exotic.armor.slice(0,1)});
  assert.equal(core.compareArmorScans(core.armorScanSnapshot(exotic),base).newCombinations,1);
});
