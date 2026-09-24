const test=require('node:test'),assert=require('node:assert/strict');
const core=require('../bungie-core'),example=require('../bungie-example');
const catalog={kind:'weapon',weapons:[{id:0,name:'Example Rifle',element:'Arc',origin:'Example Origin',statFocus:'Range',rollCols:[['Barrel'],['Magazine'],['Utility'],['Damage']]}]};
const noWait={wait:async()=>{}};
function fixture(){
  const f=example(catalog),result=core.scan(f.profile,f.defs,catalog),plan=core.lockPlan(result),calls=[];
  const rows=()=>[...f.profile.profileInventory.data.items,...f.profile.characterInventories.data['100'].items];
  const client={profile:async()=>structuredClone(f.profile),item:async i=>({item:{data:structuredClone(rows().find(r=>r.itemInstanceId===i.id))}}),
    setLock:async(i,state)=>{calls.push([i.id,state]);const r=rows().find(r=>r.itemInstanceId===i.id);r.state=state?r.state|1:r.state&~1;}};
  return {...f,result,plan,calls,client};
}
test('a delayed keeper read is retried before any duplicate unlock, without resending the lock',async()=>{
  const f=fixture(),read=f.client.item;let reads=0;
  f.client.item=async i=>{const r=await read(i);if(++reads<3){assert.equal(f.calls.some(c=>c[1]===false),false);r.item.data.state&=~1;}return r;};
  const done=await core.executeLocks(f.plan,f.client,f.result,()=>{},noWait);
  assert.equal(reads,3);assert.deepEqual(f.calls.map(c=>c[1]),[true,false]);assert.equal(done.length,2);
});
test('delayed final inventory is retried without repeating lock writes',async()=>{
  const f=fixture(),before=structuredClone(f.profile);let reads=0;
  f.client.profile=async()=>++reads<4?structuredClone(before):structuredClone(f.profile);
  const done=await core.executeLocks(f.plan,f.client,f.result,()=>{},noWait);
  assert.equal(reads,4);assert.equal(done.length,2);assert.equal(f.calls.length,2);
});
test('permanent keeper verification failure names the copy and stops duplicate unlocks',async()=>{
  const f=fixture();let reads=0;f.client.item=async i=>{reads++;return {item:{data:{itemInstanceId:i.id,state:0}}};};
  const before=structuredClone(f.profile);f.client.profile=async()=>structuredClone(before);
  await assert.rejects(()=>core.executeLocks(f.plan,f.client,f.result,()=>{},noWait),e=>{
    assert.equal(e.partial,true);assert.equal(e.skippedGroups[0].itemId,f.plan[0].keeper.id);
    assert.equal(e.skippedGroups[0].name,'Example Rifle');assert.equal(e.completed.length,1);return true;
  });
  assert.equal(reads,4);assert.deepEqual(f.calls.map(c=>c[1]),[true]);
});
test('a different item response cannot verify the keeper',async()=>{
  const f=fixture();f.client.item=async()=>({item:{data:{itemInstanceId:'999',state:1}}});
  const before=structuredClone(f.profile);f.client.profile=async()=>structuredClone(before);
  await assert.rejects(()=>core.executeLocks(f.plan,f.client,f.result,()=>{},noWait),e=>e.partial && e.skippedGroups[0].observations[0].itemId==='999');
  assert.deepEqual(f.calls.map(c=>c[1]),[true]);
});
test('an API write rejection identifies the failed action and is not retried',async()=>{
  const f=fixture();let requests=0;f.client.setLock=async()=>{requests++;throw new Error('Permission denied');};
  await assert.rejects(()=>core.executeLocks(f.plan,f.client,f.result,()=>{},noWait),e=>{
    assert.equal(e.lockFailure.phase,'lock');assert.equal(e.completed.length,0);assert.match(e.message,/Permission denied.*Example Rifle/);return true;
  });assert.equal(requests,1);
});
test('final verification failure reports each unresolved expected lock state',async()=>{
  const f=fixture(),before=structuredClone(f.profile);f.client.profile=async()=>structuredClone(before);
  await assert.rejects(()=>core.executeLocks(f.plan,f.client,f.result,()=>{},noWait),e=>{
    assert.equal(e.lockFailure.phase,'verify-final');assert.equal(e.unconfirmed.length,2);
    assert.ok(e.unconfirmed.every(i=>i.name==='Example Rifle' && typeof i.expectedLocked==='boolean'));return true;
  });
});
test('final verification rejects an inventory from another account',async()=>{
  const f=fixture();let reads=0;f.client.profile=async()=>{const p=structuredClone(f.profile);if(++reads>1)p.profile.data.userInfo.membershipId='999';return p;};
  await assert.rejects(()=>core.executeLocks(f.plan,f.client,f.result,()=>{},noWait),/account changed/);
});

test('fresh inventory can verify the exact keeper when individual-item reads stay stale',async()=>{
  const f=fixture();f.client.item=async i=>({item:{data:{itemInstanceId:i.id,state:0}}});
  const done=await core.executeLocks(f.plan,f.client,f.result,()=>{},noWait);
  assert.equal(done.length,2);assert.deepEqual(f.calls.map(c=>c[1]),[true,false]);
});

test('inventory fallback rejects a changed perk family before duplicate unlocks',async()=>{
  const f=fixture();let profiles=0;
  f.client.item=async()=>({});
  f.client.profile=async()=>{const p=structuredClone(f.profile);if(++profiles>1)p.itemComponents.sockets.data[f.plan[0].keeper.id].sockets.pop();return p;};
  await assert.rejects(()=>core.executeLocks(f.plan,f.client,f.result,()=>{},noWait),/changed/);
  assert.deepEqual(f.calls.map(c=>c[1]),[true]);
});

test('unverified Deliverance protects its duplicates while an unrelated weapon is locked',async()=>{
  const f=fixture(),otherId='6917530200136578999',base=f.plan[0].keeper.id;
  f.defs.items[111].displayProperties.name='Deliverance';
  f.defs.items[222]={...structuredClone(f.defs.items[111]),displayProperties:{name:'Other Rifle'}};
  f.profile.profileInventory.data.items.push({itemHash:222,itemInstanceId:otherId,state:0});
  for(const component of ['instances','sockets','reusablePlugs'])f.profile.itemComponents[component].data[otherId]=structuredClone(f.profile.itemComponents[component].data[base]);
  const c={kind:'weapon',weapons:[{...catalog.weapons[0],name:'Deliverance'},{...catalog.weapons[0],id:1,name:'Other Rifle'}]};
  const result=core.scan(f.profile,f.defs,c),plan=core.lockPlan(result),itemRead=f.client.item,profileRead=f.client.profile;
  f.client.item=async i=>i.id===base?{item:{data:{itemInstanceId:base,state:0}}}:itemRead(i);
  f.client.profile=async()=>{const p=await profileRead();p.characterInventories.data['100'].items.find(i=>i.itemInstanceId===base).state=0;return p;};
  const progress=[];
  await assert.rejects(()=>core.executeLocks(plan,f.client,result,(_,step)=>progress.push(step),noWait),e=>{
    assert.equal(e.partial,true);assert.equal(e.skippedGroups.length,1);assert.equal(e.skippedGroups[0].name,'Deliverance');
    assert.equal(e.skippedGroups[0].protectedDuplicates.length,1);assert.equal(e.completed.length,2);
    assert.deepEqual(e.verifiedChanges,[{itemId:otherId,state:true}]);assert.equal(e.unconfirmed[0].itemId,base);return true;
  });
  assert.deepEqual(f.calls,[[base,true],[otherId,true]]);assert.ok(progress.some(s=>s.phase==='group-skipped'));
});

test('a read API failure stops writes instead of treating it as an item-local skip',async()=>{
  const f=fixture();f.client.item=async()=>{throw new Error('Bungie sign-in expired');};
  await assert.rejects(()=>core.executeLocks(f.plan,f.client,f.result,()=>{},noWait),e=>!e.partial && /sign-in expired/.test(e.message));
  assert.deepEqual(f.calls.map(c=>c[1]),[true]);
});
