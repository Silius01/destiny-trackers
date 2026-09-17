const test=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');const path=require('node:path');
function harness(response={ErrorCode:1,Response:{}}){
  const map=new Map(),localMap=new Map(),calls=[],navigations=[];const sessionStorage={getItem:k=>map.get(k) ?? null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};
  const localStorage={getItem:k=>localMap.get(k) ?? null,setItem:(k,v)=>localMap.set(k,v),removeItem:k=>localMap.delete(k)};
  const context={sessionStorage,localStorage,URL,URLSearchParams,Date,AbortSignal,Uint8Array,Promise,crypto:require('node:crypto').webcrypto,
    setTimeout:f=>f(),location:{href:'https://example.test/vault/weapon-vault.html',protocol:'https:',pathname:'/vault/weapon-vault.html',search:'',assign:u=>navigations.push(u),replace:u=>navigations.push(u)},history:{replaceState:()=>{}},
    fetch:async(url,options)=>{calls.push({url,options});return {ok:true,status:200,json:async()=>typeof response==='function'?response(url):response};}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../bungie-api.js'),'utf8'),context);
  map.set('vaultBungieConfig',JSON.stringify({apiKey:'TEST_KEY_NOT_A_CREDENTIAL',clientId:'123',redirect:'https://example.test/vault/bungie-auth.html'}));
  map.set('vaultBungieToken',JSON.stringify({access_token:'TEST_TOKEN_NOT_A_CREDENTIAL',expiresAt:Date.now()+3600000}));
  return {api:context.VaultBungie,context,map,localMap,calls,navigations};
}
test('public OAuth uses unpredictable state, exact callback, and no scope or secret query',()=>{
  const {api,map,navigations}=harness();api.begin('TEST_KEY_NOT_A_CREDENTIAL','123');const url=new URL(navigations[0]);
  assert.equal(url.origin,'https://www.bungie.net');assert.equal(url.searchParams.get('redirect_uri'),'https://example.test/vault/bungie-auth.html');
  assert.equal(url.searchParams.get('state').length,64);assert.equal(url.searchParams.has('scope'),false);assert.equal(url.href.includes('TEST_KEY'),false);
  assert.equal(JSON.parse(map.get('vaultBungiePending')).returnPage,'weapon-vault.html');
});
test('OAuth rejects state mismatch and replay before sending a token request',async()=>{
  const {api,context,map,calls}=harness();api.begin('TEST_KEY_NOT_A_CREDENTIAL','123');context.location.search='?code=fake&state=wrong';
  await assert.rejects(api.finish,/does not match/);assert.equal(calls.length,0);assert.equal(map.has('vaultBungiePending'),false);
});
test('successful public OAuth exchanges code without client secret and keeps token only in session',async()=>{
  const {api,context,map,calls,navigations}=harness({access_token:'TEST_RETURN_TOKEN',expires_in:3600});api.begin('TEST_KEY_NOT_A_CREDENTIAL','123');
  const pending=JSON.parse(map.get('vaultBungiePending'));context.location.href='https://example.test/vault/bungie-auth.html';context.location.pathname='/vault/bungie-auth.html';context.location.search='?code=fake&state='+pending.state;
  await api.finish();assert.equal(calls.length,1);assert.equal(calls[0].options.body.get('client_secret'),null);assert.equal(calls[0].options.body.get('client_id'),'123');
  assert.equal(JSON.parse(map.get('vaultBungieToken')).access_token,'TEST_RETURN_TOKEN');assert.equal(navigations.at(-1),'https://example.test/vault/weapon-vault.html');
  await assert.rejects(api.finish);assert.equal(calls.length,1);
});
test('API sends both headers only to Bungie and requests necessary per-instance components',async()=>{
  const {api,calls}=harness();const client=api.client({membershipType:3,membershipId:'1234567890123456789'});await client.profile();
  assert.equal(calls[0].url,'https://www.bungie.net/Platform/Destiny2/3/Profile/1234567890123456789/?components=100,102,200,201,205,300,304,305,310');
  assert.equal(calls[0].options.headers.Authorization,'Bearer TEST_TOKEN_NOT_A_CREDENTIAL');assert.equal(calls[0].options.redirect,'error');
});
test('lock requests retain 64-bit instance IDs as strings and use the original membership type',async()=>{
  const {api,calls}=harness();await api.client({membershipType:3,membershipId:'123'}).setLock({id:'900719925474099103',characterId:'100'},true);
  const body=JSON.parse(calls[0].options.body);assert.equal(body.itemId,'900719925474099103');assert.equal(body.membershipType,3);assert.equal(body.state,true);
  assert.equal(calls[0].url,'https://www.bungie.net/Platform/Destiny2/Actions/Items/SetLockState/');
});
test('expired sessions send no authenticated request',async()=>{
  const {api,map,calls}=harness();map.set('vaultBungieToken',JSON.stringify({access_token:'TEST',expiresAt:Date.now()-100}));
  await assert.rejects(api.memberships,/expired/);assert.equal(calls.length,0);
});
test('cross-save chooses the active membership and does not combine accounts',async()=>{
  const {api}=harness({ErrorCode:1,Response:{destinyMemberships:[{membershipId:'1',membershipType:1,crossSaveOverride:3},{membershipId:'3',membershipType:3,crossSaveOverride:3}]}});
  const result=await api.memberships();assert.equal(result.length,1);assert.equal(result[0].membershipType,3);
});
test('public manifest downloads contain no API key or bearer token',async()=>{
  const {api,calls}=harness(url=>url.endsWith('/Manifest/')?{ErrorCode:1,Response:{version:'test',jsonWorldComponentContentPaths:{en:{DestinyInventoryItemDefinition:'/common/destiny2_content/items.json',DestinyStatDefinition:'/common/destiny2_content/stats.json'}}}}:{});
  const defs=await api.definitions();assert.ok(defs.items);assert.equal(calls.length,3);
  for(const call of calls.slice(1)){assert.equal(call.options.headers,undefined);assert.equal(call.options.credentials,'omit');}
});
test('an unexpected manifest host/path is rejected',async()=>{
  const {api,calls}=harness({ErrorCode:1,Response:{version:'test',jsonWorldComponentContentPaths:{en:{DestinyInventoryItemDefinition:'https://evil.example/items.json'}}}});
  await assert.rejects(api.definitions,/unexpected/);assert.equal(calls.length,1);
});

test('saved API key and client ID survive a new tab session without persisting sign-in tokens',()=>{
  const {api,context,map,localMap}=harness();
  api.saveConfiguration('  TEST_KEY_NOT_A_CREDENTIAL  ',' 123 ');
  map.clear();
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../bungie-api.js'),'utf8'),context);
  const restored=context.VaultBungie.savedConfiguration();
  assert.equal(restored.apiKey,'TEST_KEY_NOT_A_CREDENTIAL');assert.equal(restored.clientId,'123');
  assert.equal(context.VaultBungie.connected(),false);
  assert.deepEqual([...localMap.keys()],['vaultBungieSavedConfig']);
  assert.deepEqual(Object.keys(JSON.parse(localMap.get('vaultBungieSavedConfig'))).sort(),['apiKey','clientId']);
});
test('existing session credentials migrate automatically without copying the callback or token',()=>{
  const {api,localMap}=harness();
  assert.equal(api.savedConfiguration().clientId,'123');
  const saved=JSON.parse(localMap.get('vaultBungieSavedConfig'));
  assert.deepEqual(saved,{apiKey:'TEST_KEY_NOT_A_CREDENTIAL',clientId:'123'});
});
test('Connect saves settings, builds the current callback, and clears the old access token',()=>{
  const {api,map,localMap,navigations}=harness();
  api.begin('NEW_TEST_KEY_NOT_A_CREDENTIAL','456');
  assert.equal(map.has('vaultBungieToken'),false);
  assert.equal(JSON.parse(localMap.get('vaultBungieSavedConfig')).clientId,'456');
  assert.equal(JSON.parse(map.get('vaultBungieConfig')).redirect,'https://example.test/vault/bungie-auth.html');
  assert.equal(new URL(navigations[0]).searchParams.get('client_id'),'456');
});
test('saving different preferences does not mix them with the current authenticated client',async()=>{
  const {api,calls}=harness();
  api.saveConfiguration('NEW_TEST_KEY_NOT_A_CREDENTIAL','456');
  await api.memberships();
  assert.equal(calls[0].options.headers['X-API-Key'],'TEST_KEY_NOT_A_CREDENTIAL');
  assert.equal(api.configuration().clientId,'123');assert.equal(api.savedConfiguration().clientId,'456');
});
test('Disconnect keeps saved settings; Forget removes them and prevents legacy migration from another tab',()=>{
  const {api,map,localMap}=harness();api.savedConfiguration();
  api.disconnect();assert.equal(api.connected(),false);assert.equal(api.savedConfiguration().clientId,'123');
  api.forgetConfiguration();assert.equal(api.savedConfiguration(),null);
  assert.equal(localMap.get('vaultBungieSavedConfig'),'null');
  map.set('vaultBungieConfig',JSON.stringify({apiKey:'TEST_KEY_NOT_A_CREDENTIAL',clientId:'123'}));
  assert.equal(api.savedConfiguration(),null);
  api.saveConfiguration('NEW_TEST_KEY_NOT_A_CREDENTIAL','456');assert.equal(api.savedConfiguration().clientId,'456');
});
test('blocked browser storage reports the failure without navigating or invalidating an active session',()=>{
  const {api,context,navigations}=harness();context.localStorage.setItem=()=>{throw new Error('Storage blocked');};
  assert.throws(()=>api.saveConfiguration('TEST_KEY_NOT_A_CREDENTIAL','123'),/could not save/);
  assert.throws(()=>api.begin('TEST_KEY_NOT_A_CREDENTIAL','123'),/could not save/);
  assert.throws(()=>api.forgetConfiguration(),/could not remove/);
  assert.equal(navigations.length,0);assert.equal(api.connected(),true);
});
test('invalid settings cannot overwrite a saved configuration',()=>{
  const {api,localMap}=harness();api.saveConfiguration('TEST_KEY_NOT_A_CREDENTIAL','123');
  const before=localMap.get('vaultBungieSavedConfig');
  assert.throws(()=>api.saveConfiguration('short','123'),/Enter/);
  assert.throws(()=>api.saveConfiguration('TEST_KEY_NOT_A_CREDENTIAL','not an ID'),/Enter/);
  assert.equal(localMap.get('vaultBungieSavedConfig'),before);
});

function cacheHarness(initial={},paths={}) {
  const contents=new Map(Object.entries(initial));
  const tables={DestinyInventoryItemDefinition:'/common/destiny2_content/items-new.json',DestinyStatDefinition:'/common/destiny2_content/stats.json',...paths};
  const h=harness(url=>url.endsWith('/Manifest/')?{ErrorCode:1,Response:{version:'unchanged-label',jsonWorldComponentContentPaths:{en:tables}}}:{fresh:true});
  h.context.indexedDB={open:()=>{
    const req={result:{close(){},transaction(){
      const tx={objectStore:()=>({get:key=>{const r={result:contents.get(key)};queueMicrotask(()=>tx.oncomplete());return r;},put:(value,key)=>{contents.set(key,value);const r={result:key};queueMicrotask(()=>tx.oncomplete());return r;}})};
      return tx;
    }}};queueMicrotask(()=>req.onsuccess());return req;
  }};
  return {...h,contents};
}
test('changed content paths invalidate cached definitions even when the manifest version is unchanged',async()=>{
  const {api,calls,contents}=cacheHarness({DestinyInventoryItemDefinition:{version:'unchanged-label',path:'/common/destiny2_content/items-old.json',data:{stale:true}}});
  const result=await api.definitions();assert.equal(result.items.fresh,true);assert.equal(result.items.stale,undefined);
  assert.ok(calls.some(c=>c.url.endsWith('/items-new.json')));assert.equal(contents.get('DestinyInventoryItemDefinition').path,'/common/destiny2_content/items-new.json');
});
test('unchanged content paths reuse cached data and legacy version-only caches are refreshed',async()=>{
  for(const legacy of [false,true]){
    const {api,calls}=cacheHarness({DestinyInventoryItemDefinition:{version:'unchanged-label',...(legacy?{}:{path:'/common/destiny2_content/items-new.json'}),data:{cached:true}}});
    const result=await api.definitions();assert.equal(!!result.items.cached,!legacy);
    assert.equal(calls.some(c=>c.url.endsWith('/items-new.json')),legacy);
  }
});
test('explicit definition refresh bypasses IndexedDB and browser cache without sending credentials',async()=>{
  const {api,calls}=cacheHarness({DestinyInventoryItemDefinition:{path:'/common/destiny2_content/items-new.json',data:{cached:true}}});
  const result=await api.definitions(()=>{},{refresh:true});assert.equal(result.items.fresh,true);
  const call=calls.find(c=>c.url.endsWith('/items-new.json'));
  assert.equal(call.options.cache,'reload');assert.equal(call.options.headers,undefined);assert.equal(call.options.credentials,'omit');
});
test('cached data cannot bypass manifest path validation or resurrect a missing optional table',async()=>{
  const bad=cacheHarness({DestinyInventoryItemDefinition:{version:'unchanged-label',data:{cached:true}}},{DestinyInventoryItemDefinition:'https://evil.example/items.json'});
  await assert.rejects(bad.api.definitions,/unexpected/);assert.equal(bad.calls.length,1);
  const optional=cacheHarness({DestinyEquipableItemSetDefinition:{version:'unchanged-label',data:{stale:true}}});
  assert.equal(Object.keys((await optional.api.definitions()).sets).length,0);
});
