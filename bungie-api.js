(function(root) {
  'use strict';
  const BASE = 'https://www.bungie.net';
  const CONFIG = 'vaultBungieConfig', TOKEN = 'vaultBungieToken', PENDING = 'vaultBungiePending';
  const COMPONENTS = '100,102,200,201,205,300,304,305,310';
  function stored(key) { try { return JSON.parse(sessionStorage.getItem(key) || 'null'); } catch { return null; } }
  function configuration() { return stored(CONFIG); }
  function connected() { const token=stored(TOKEN); return !!(token?.access_token && token.expiresAt > Date.now()+30000); }
  function disconnect() { [CONFIG,TOKEN,PENDING].forEach(key=>sessionStorage.removeItem(key)); }
  function callbackURL() { return new URL('bungie-auth.html',location.href).href.split(/[?#]/)[0]; }
  function begin(apiKey,clientId) {
    if (!/^[A-Za-z0-9_-]{16,256}$/.test(apiKey) || !/^\d{1,12}$/.test(clientId)) throw new Error('Enter your Bungie API key and OAuth client ID.');
    if (location.protocol !== 'https:') throw new Error('Bungie sign-in needs the published HTTPS site. Local previews can use the sample scan.');
    const state = [...crypto.getRandomValues(new Uint8Array(32))].map(b=>b.toString(16).padStart(2,'0')).join('');
    const config={apiKey,clientId,redirect:callbackURL()};
    sessionStorage.setItem(CONFIG,JSON.stringify(config));
    sessionStorage.setItem(PENDING,JSON.stringify({state,at:Date.now(),returnPage:location.pathname.endsWith('armor-vault.html')?'armor-vault.html':'weapon-vault.html'}));
    const url = new URL('/en/oauth/authorize',BASE);
    url.search = new URLSearchParams({client_id:clientId,response_type:'code',state,redirect_uri:config.redirect});
    location.assign(url.href);
  }
  async function finish() {
    const params = new URLSearchParams(location.search), pending=stored(PENDING), config=configuration();
    history.replaceState(null,'',location.pathname);
    sessionStorage.removeItem(PENDING);
    if (params.has('error')) throw new Error('Bungie sign-in was cancelled. Return to the vault and connect again.');
    if (!pending || !config || Date.now()-pending.at > 10*60*1000 || params.get('state') !== pending.state || !params.get('code')) {
      throw new Error('The sign-in callback is missing, expired, or does not match this browser session. Connect again from the vault.');
    }
    const response = await fetch(BASE+'/platform/app/oauth/token/',{
      method:'POST',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',
      headers:{'Content-Type':'application/x-www-form-urlencoded','X-API-Key':config.apiKey},
      body:new URLSearchParams({grant_type:'authorization_code',client_id:config.clientId,code:params.get('code'),redirect_uri:config.redirect}),
      signal:AbortSignal.timeout(30000)
    });
    if (!response.ok) throw new Error('Bungie could not complete sign-in. Check Public client type, client ID, API key, and redirect URL.');
    const token=await response.json();
    if (!token.access_token || !(token.expires_in>0)) throw new Error('Bungie did not provide a valid access token.');
    sessionStorage.setItem(TOKEN,JSON.stringify({access_token:token.access_token,expiresAt:Date.now()+token.expires_in*1000}));
    location.replace(new URL(pending.returnPage,location.href).href);
  }
  async function api(path,body) {
    const config=configuration(),token=stored(TOKEN);
    if (!connected() || !config) throw new Error('Connect to Bungie again; the sign-in session has expired.');
    const read = /^\/(User\/GetMembershipsForCurrentUser\/|Destiny2\/Manifest\/|Destiny2\/[1236]\/Profile\/\d+\/(\?components=[\d,]+|Item\/\d+\/\?components=307))$/;
    if (!(body ? path === '/Destiny2/Actions/Items/SetLockState/' : read.test(path))) throw new Error('Unsupported Bungie operation.');
    const response=await fetch(BASE+'/Platform'+path,{method:body?'POST':'GET',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',cache:'no-store',
      headers:{'X-API-Key':config.apiKey,Authorization:'Bearer '+token.access_token,...(body?{'Content-Type':'application/json'}:{})},
      ...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
    if (response.status===401) { sessionStorage.removeItem(TOKEN); throw new Error('Bungie sign-in expired. Reconnect and scan again.'); }
    if (response.status===429) throw new Error('Bungie is limiting requests. Wait a minute, then scan again.');
    if (!response.ok) throw new Error('Bungie request failed ('+response.status+'). No further actions were sent.');
    const data=await response.json();
    if (data.ErrorCode!==1) throw new Error('Bungie could not complete the request ('+(data.ErrorStatus || data.ErrorCode)+'). Check permissions or try again later.');
    return data.Response;
  }
  async function memberships() {
    const result=await api('/User/GetMembershipsForCurrentUser/');
    const all=(result.destinyMemberships || []).filter(m=>[1,2,3,6].includes(m.membershipType));
    const active=all.filter(m=>m.crossSaveOverride && m.crossSaveOverride===m.membershipType);
    return active.length?active:all.filter(m=>!m.crossSaveOverride);
  }
  function client(account) {
    if (!/^[1236]$/.test(String(account.membershipType)) || !/^\d+$/.test(account.membershipId)) throw new Error('Select a valid Destiny account.');
    const prefix='/Destiny2/'+account.membershipType+'/Profile/'+account.membershipId+'/';
    return {profile:()=>api(prefix+'?components='+COMPONENTS),
      item:item=>api(prefix+'Item/'+item.id+'/?components=307'),
      setLock:async(item,state)=>{
        if (!/^\d+$/.test(item.id) || !/^\d+$/.test(item.characterId) || typeof state!=='boolean') throw new Error('Invalid lock request.');
        await api('/Destiny2/Actions/Items/SetLockState/',{itemId:item.id,characterId:item.characterId,membershipType:account.membershipType,state});
        await new Promise(resolve=>setTimeout(resolve,150));
      }};
  }
  async function cacheDb() {
    return new Promise((resolve,reject)=>{
      const req=indexedDB.open('vaultBungieManifest',1);
      req.onupgradeneeded=()=>req.result.createObjectStore('tables');
      req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error);
    });
  }
  async function cached(key,value) {
    let db;
    try {
      db=await cacheDb();
      return await new Promise((resolve,reject)=>{
        const tx=db.transaction('tables',value===undefined?'readonly':'readwrite');
        const req=value===undefined?tx.objectStore('tables').get(key):tx.objectStore('tables').put(value,key);
        tx.oncomplete=()=>resolve(req.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
      });
    } catch { return undefined; } finally { db?.close(); }
  }
  async function definitions(progress=()=>{}, {refresh=false}={}) {
    progress('Checking Bungie item definitions…');
    const manifest=await api('/Destiny2/Manifest/');
    const tables={items:'DestinyInventoryItemDefinition',stats:'DestinyStatDefinition',sets:'DestinyEquipableItemSetDefinition'};
    const result={};
    for (const [name,table] of Object.entries(tables)) {
      const path=manifest.jsonWorldComponentContentPaths?.en?.[table];
      if (name==='sets' && !path) { result[name]={};continue; }
      if (typeof path!=='string' || !path.startsWith('/common/destiny2_content/') || path.startsWith('//')) throw new Error('Bungie returned an unexpected definition path.');
      // Bungie can replace a table without changing the manifest version label.
      // The actual content path must match before an IndexedDB table is reused.
      const key=table; const previous=refresh ? undefined : await cached(key);
      if (previous?.path===path && previous.data) { result[name]=previous.data;continue; }
      progress('Downloading '+(name==='items'?'item definitions (first scan can take a minute)':name+' definitions')+'…');
      // Public definitions do not receive the API key or OAuth token.
      const response=await fetch(BASE+path,{credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',...(refresh?{cache:'reload'}:{}),signal:AbortSignal.timeout(180000)});
      if (!response.ok) throw new Error('Could not download Bungie definitions. Try again.');
      result[name]=await response.json();
      await cached(key,{path,version:manifest.version,data:result[name]});
    }
    return result;
  }
  root.VaultBungie={configuration,connected,disconnect,callbackURL,begin,finish,memberships,client,definitions};
})(globalThis);
