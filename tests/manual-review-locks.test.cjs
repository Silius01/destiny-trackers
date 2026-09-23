const test=require('node:test');
const assert=require('node:assert/strict');
const core=require('../bungie-core');
const example=require('../bungie-example');

const weapon={id:0,name:'Example Rifle',element:'Arc',source:'Test',origin:'Example Origin',archetype:'Adaptive',statFocus:'Range',
  rollCols:[['Barrel'],['Magazine'],['Utility'],['Damage']],
  rollColsRanked:[[{name:'Barrel',pct:50}],[{name:'Magazine',pct:50}],[{name:'Utility',pct:50}],[{name:'Damage',pct:50}]]};
const weapons={kind:'weapon',weapons:[weapon]};

function copies(profile){
  return [...profile.profileInventory.data.items,...profile.characterInventories.data['100'].items].filter(r=>r.itemHash===111);
}
function fakeClient(profile,actions=[]){return {
  profile:async()=>structuredClone(profile),
  item:async i=>{actions.push(['verify',i.id]);return {item:{data:copies(profile).find(r=>r.itemInstanceId===i.id)}};},
  setLock:async(i,state)=>{actions.push(['set',i.id,state]);const raw=copies(profile).find(r=>r.itemInstanceId===i.id);raw.state=state?raw.state|1:raw.state&~1;}
};}
function fixture(){const f=example(weapons);return {...f,result:core.scan(f.profile,f.defs,weapons)};}

test('a manual "keep" flag locks the chosen review copy',async()=>{
  const f=fixture();
  const item=f.result.items.find(i=>!i.locked);   // an unlocked copy
  const plan=[{groupId:'review-keep:'+item.id,name:item.name,keeper:item,locks:[item],unlocks:[],duplicates:[],copies:[item]}];
  const actions=[];const client=fakeClient(f.profile,actions);
  await core.executeLocks(plan,client,f.result,()=>{});
  assert.deepEqual(actions.filter(a=>a[0]==='set'),[['set',item.id,true]]);
});

test('a manual "don\'t keep" flag unlocks the chosen copy and only unlocks it',async()=>{
  const f=fixture();
  const item=f.result.items.find(i=>i.locked);     // a locked copy
  const plan=[{groupId:'review-drop:'+item.id,name:item.name,keeper:item,locks:[],unlocks:[item],duplicates:[],copies:[item],manualUnlock:true}];
  const actions=[];const client=fakeClient(f.profile,actions);
  await core.executeLocks(plan,client,f.result,()=>{});
  assert.deepEqual(actions.filter(a=>a[0]==='set'),[['set',item.id,false]]);  // only an unlock, no lock
});

test('dropping an already-unlocked copy makes no change',async()=>{
  const f=fixture();
  const item=f.result.items.find(i=>!i.locked);
  const plan=[{groupId:'review-drop:'+item.id,name:item.name,keeper:item,locks:[],unlocks:[],duplicates:[],copies:[item],manualUnlock:true}];
  const actions=[];const client=fakeClient(f.profile,actions);
  await core.executeLocks(plan,client,f.result,()=>{});
  assert.equal(actions.filter(a=>a[0]==='set').length,0);
});
