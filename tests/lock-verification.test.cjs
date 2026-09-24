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
  assert.deepEqual(f.calls,[[base,true],[otherId,true]]);assert.ok(progress.some(s=>s.phase==='keeper-pending'));
});

test('a read API failure stops writes instead of treating it as an item-local skip',async()=>{
  const f=fixture();f.client.item=async()=>{throw new Error('Bungie sign-in expired');};
  await assert.rejects(()=>core.executeLocks(f.plan,f.client,f.result,()=>{},noWait),e=>!e.partial && /sign-in expired/.test(e.message));
  assert.deepEqual(f.calls.map(c=>c[1]),[true]);
});

test('26 lock-only keepers use one shared inventory confirmation without individual item reads',async()=>{
  const f=fixture(),base=f.plan[0].keeper.id;
  f.profile.profileInventory.data.items=[];f.profile.characterInventories.data['100'].items=[];
  for(let n=0;n<26;n++){
    const itemId='691753020020160'+String(1800+n);
    f.profile.profileInventory.data.items.push({itemHash:111,itemInstanceId:itemId,state:0});
    for(const component of ['instances','sockets','reusablePlugs'])f.profile.itemComponents[component].data[itemId]=structuredClone(f.profile.itemComponents[component].data[base]);
  }
  f.defs.items[111].inventory={tierType:6};
  const result=core.scan(f.profile,f.defs,catalog),plan=core.lockPlan(result),read=f.client.profile;let profiles=0;
  f.client.profile=async()=>{profiles++;return read();};f.client.item=async()=>assert.fail('No per-item polling for lock-only groups');
  const done=await core.executeLocks(plan,f.client,result,()=>{},noWait);
  assert.equal(done.length,26);assert.equal(profiles,2);assert.equal(f.calls.length,26);
});

test('shared polling waits for newer data and verifies a deferred keeper before unlocking',async()=>{
  const f=fixture(),before=structuredClone(f.profile),read=f.client.profile,write=f.client.setLock;let elapsed=0,profiles=0;
  f.client.item=async i=>({item:{data:{itemInstanceId:i.id,state:0}}});
  f.client.profile=async()=>{profiles++;return elapsed<30000?structuredClone(before):read();};
  f.client.setLock=async(i,state)=>{if(!state)assert.ok(elapsed>=30000);return write(i,state);};
  const done=await core.executeLocks(f.plan,f.client,f.result,()=>{},{wait:async ms=>{elapsed+=ms;}});
  assert.equal(done.length,2);assert.equal(f.calls.length,2);assert.ok(profiles<10);
});

test('expired verification responses wait and become pending without authorizing duplicate unlocks',async()=>{
  const f=fixture(),read=f.client.profile;let profiles=0;
  f.client.item=async i=>({item:{data:{itemInstanceId:i.id,state:0}}});
  f.client.profile=async()=>{const p=await read();if(++profiles>1)p.responseMintedTimestamp=new Date(Date.now()-181000).toISOString();return p;};
  await assert.rejects(()=>core.executeLocks(f.plan,f.client,f.result,()=>{},noWait),e=>{
    assert.equal(e.pendingVerification,true);assert.equal(e.partial,true);assert.equal(e.verificationReads.length,7);
    assert.ok(e.verificationReads.every(r=>r.expired));assert.deepEqual(e.verifiedChanges,[]);return true;
  });assert.deepEqual(f.calls.map(c=>c[1]),[true]);
});

test('read-only recheck resolves accepted locks once current inventory catches up',async()=>{
  const f=fixture(),before=structuredClone(f.profile),read=f.client.profile;
  const lockOnly=f.plan.map(g=>({...g,unlocks:[],duplicates:[]}));f.client.profile=async()=>structuredClone(before);
  let pending;try{await core.executeLocks(lockOnly,f.client,f.result,()=>{},noWait);}catch(e){pending=e;}
  assert.equal(pending.pendingVerification,true);
  const result=core.recheckLockResult({at:new Date().toISOString(),account:f.result.account,membershipType:f.result.membershipType,
    planned:1,accepted:1,completed:pending.completed,expected:pending.expected,skippedGroups:pending.skippedGroups,checklistSaved:true},await read());
  assert.equal(result.status,'verified');assert.equal(result.locked,1);assert.equal(result.unconfirmed.length,0);assert.equal(f.calls.length,1);
});

test('recheck of a legacy interrupted batch retains unsent changes and protected duplicates',async()=>{
  const f=fixture(),keeper=f.plan[0].keeper,duplicate=f.plan[0].unlocks[0];await f.client.setLock(keeper,true);
  const previous={account:f.result.account,membershipType:f.result.membershipType,planned:83,accepted:1,
    completed:[{itemId:keeper.id,state:true}],skippedGroups:[{itemId:keeper.id,name:keeper.name,protectedDuplicates:[{itemId:duplicate.id}]}]};
  const result=core.recheckLockResult(previous,f.profile);
  assert.equal(result.status,'partial');assert.equal(result.locked,1);assert.equal(result.skippedGroups.length,1);
  assert.match(result.skippedGroups[0].reason,/now confirmed/);assert.equal(f.calls.length,1);
  const other=structuredClone(f.profile);other.profile.data.userInfo.membershipId='999';
  assert.throws(()=>core.recheckLockResult(previous,other),/account changed/);
  const stale=structuredClone(f.profile);stale.responseMintedTimestamp=new Date(Date.now()-181000).toISOString();
  assert.throws(()=>core.recheckLockResult(previous,stale),/stale/);
});

test('recheck separates confirmed sent locks from deferred duplicate unlocks',async()=>{
  const f=fixture(),keeper=f.plan[0].keeper,duplicate=f.plan[0].unlocks[0];await f.client.setLock(keeper,true);
  const result=core.recheckLockResult({account:f.result.account,membershipType:f.result.membershipType,planned:2,accepted:1,
    completed:[{itemId:keeper.id,state:true}],expected:[{itemId:keeper.id,expectedLocked:true},{itemId:duplicate.id,expectedLocked:false}],
    skippedGroups:[{itemId:keeper.id,protectedDuplicates:[{itemId:duplicate.id}]}]},f.profile);
  assert.equal(result.status,'partial');assert.equal(result.pendingVerification,false);assert.equal(result.locked,1);
  assert.match(result.message,/changes that were not sent/);assert.equal(result.unconfirmed[0].itemId,duplicate.id);assert.equal(f.calls.length,1);
});

async function pendingBatch(duplicates=false){
  const f=fixture(),before=structuredClone(f.profile),read=f.client.profile;
  f.client.profile=async()=>structuredClone(before);
  if(duplicates)f.client.item=async i=>({item:{data:{itemInstanceId:i.id,state:0}}});
  let error;
  try{await core.executeLocks(duplicates?f.plan:f.plan.map(g=>({...g,unlocks:[],duplicates:[]})),f.client,f.result,()=>{},noWait);}catch(e){error=e;}
  assert.equal(error?.pendingVerification,true);f.client.profile=read;
  return {...f,before,previous:{at:new Date().toISOString(),account:f.result.account,membershipType:f.result.membershipType,
    status:'pending',pendingVerification:true,planned:duplicates?2:1,accepted:error.completed.length,completed:error.completed,
    expected:error.expected,skippedGroups:error.skippedGroups,unconfirmed:error.unconfirmed,checklistSaved:true}};
}

test('automatic follow-up waits 30 seconds, reads once, and confirms locks without more writes',async()=>{
  const f=await pendingBatch(),previous=structuredClone(f.previous),events=[],read=f.client.profile;
  f.client.profile=async()=>{events.push('profile');return read();};
  f.client.item=async()=>assert.fail('The follow-up only needs one inventory read');
  f.client.setLock=async()=>assert.fail('The follow-up must never send writes');
  const checked=await core.autoRecheckLockResult(f.previous,f.client,step=>events.push(step.state),{wait:async ms=>events.push(ms)});
  assert.deepEqual(events,['waiting',30000,'checking','profile']);assert.deepEqual(f.previous,previous);
  assert.equal(checked.status,'verified');assert.equal(checked.locked,1);assert.equal(checked.autoRecheck.state,'completed');
  assert.equal(checked.autoRecheck.at,checked.checkedAt);assert.ok(Number.isFinite(Date.parse(checked.autoRecheck.scheduledFor)));
  assert.equal(checked.checklistSaved,true);assert.equal(f.calls.length,1);
});

test('automatic follow-up remains pending if data has not caught up and does not loop',async()=>{
  const f=await pendingBatch(),previous=structuredClone(f.previous);let reads=0,waits=0;
  f.client.profile=async()=>{reads++;return structuredClone(f.before);};
  const checked=await core.autoRecheckLockResult(f.previous,f.client,()=>{},{wait:async()=>{waits++;}});
  assert.equal(reads,1);assert.equal(waits,1);assert.equal(checked.status,'pending');assert.equal(checked.locked,0);
  assert.equal(checked.autoRecheck.state,'completed');assert.deepEqual(f.previous,previous);assert.equal(f.calls.length,1);
});

test('automatic follow-up confirms the keeper but never executes previously skipped duplicate unlocks',async()=>{
  const f=await pendingBatch(true),checked=await core.autoRecheckLockResult(f.previous,f.client,()=>{},noWait);
  assert.equal(checked.status,'partial');assert.equal(checked.pendingVerification,false);assert.equal(checked.locked,1);
  assert.equal(checked.skippedGroups.length,1);assert.equal(checked.skippedGroups[0].protectedDuplicates.length,1);
  assert.match(checked.message,/changes that were not sent/);assert.deepEqual(f.calls.map(c=>c[1]),[true]);
});

test('automatic follow-up leaves the retained result intact when the inventory read fails',async()=>{
  const f=await pendingBatch(),previous=structuredClone(f.previous);
  f.client.profile=async()=>{throw new Error('Read service unavailable');};
  await assert.rejects(()=>core.autoRecheckLockResult(f.previous,f.client,()=>{},noWait),/Read service unavailable/);
  assert.deepEqual(f.previous,previous);assert.equal(f.calls.length,1);
});

test('automatic follow-up rejects stale and wrong-account inventory without altering the pending result',async()=>{
  const f=await pendingBatch(),previous=structuredClone(f.previous);
  for(const issue of ['stale','account']){
    f.client.profile=async()=>{const p=structuredClone(f.profile);
      if(issue==='stale')p.responseMintedTimestamp=new Date(Date.now()-181000).toISOString();
      else p.profile.data.userInfo.membershipId='999';return p;};
    await assert.rejects(()=>core.autoRecheckLockResult(f.previous,f.client,()=>{},noWait),issue==='stale'?/stale/:/account changed/);
    assert.deepEqual(f.previous,previous);
  }
  assert.equal(f.calls.length,1);
});

test('automatic follow-up is unnecessary for confirmed results or a batch with no accepted changes',async()=>{
  const client={profile:async()=>assert.fail('No follow-up read should be needed')},wait={wait:async()=>assert.fail('No wait should be needed')};
  for(const previous of [{pendingVerification:false,completed:[{itemId:'1',state:true}]},{pendingVerification:true,completed:[]}]){
    assert.equal(await core.autoRecheckLockResult(previous,client,()=>assert.fail('No progress expected'),wait),previous);
  }
});
