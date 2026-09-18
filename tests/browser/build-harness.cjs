const fs=require('node:fs'),path=require('node:path');
const repo=path.join(__dirname,'../..');
for(const kind of ['weapon','armor']){
 let html=fs.readFileSync(path.join(repo,kind+'-vault.html'),'utf8');
 html=html.replaceAll('src="bungie-','src="../../bungie-').replace('href="bungie-ui.css"','href="../../bungie-ui.css"');
 html=html.replace(/<script src="\.\.\/\.\.\/bungie-ui\.js[^\"]*">/,'<script src="mock-runtime.js"></script>$&');
 const build=Date.now();
 html=html.replace(/(src|href)="([^\"]+\.(?:js|css))(?:\?[^\"]*)?"/g,(_,attribute,url)=>attribute+'="'+url+'?qa='+build+'"');
 html=html.replace(/(weaponVault|armorVault)(Records|HeaderCollapsed)/g,'qa-$1$2');
 fs.writeFileSync(path.join(__dirname,'generated-'+kind+'.html'),html);
}
fs.writeFileSync(path.join(__dirname,'mock-runtime.js'),`
let fixture;
const realArmor=${fs.readFileSync(path.join(__dirname,'../fixtures/twisting-echo.json'),'utf8')};
function sample(){
  if(fixture)return fixture;
  const params=new URLSearchParams(location.search),twisting=params.get('armor')==='twisting';
  const weaponName={brass:'Brass Attacks',bane:'Bane of Sorrow'}[params.get('weapon')];
  fixture=VaultScanExample(location.pathname.includes('armor')?
    {kind:'armor',sets:twisting?SETS.filter(s=>s.name==='Yearning Echo'):SETS,combos:COMBOS,archetypes:twisting?ARCHETYPES.filter(a=>a.name==='Powerhouse'):ARCHETYPES}:
    {kind:'weapon',weapons:weaponName?WEAPONS.filter(w=>w.name===weaponName):WEAPONS});
  if(twisting){
    fixture.defs=structuredClone(realArmor.defs);fixture.profile.characters.data['100'].classType=1;
    const rows=[...fixture.profile.profileInventory.data.items,...fixture.profile.characterInventories.data['100'].items];
    rows.forEach((raw,index)=>{raw.itemHash=3229172222;raw.state=0;fixture.profile.itemComponents.sockets.data[raw.itemInstanceId]={sockets:
      [realArmor.statPlugs.Weapons,realArmor.statPlugs.Super,realArmor.statPlugs[index===1?'Class':'Health'],544009373].map(plugHash=>({plugHash,isEnabled:true}))};});
    if(params.has('blocked'))fixture.profile.itemComponents.sockets.data[rows[1].itemInstanceId].sockets.pop();
  }
  if(params.get('weapon')==='bane'){
    const {profile,defs}=fixture,multi='900719925474099101',single='900719925474099103';
    profile.profileInventory.data.items=profile.profileInventory.data.items.slice(0,1);
    profile.profileInventory.data.items[0].state=0;profile.characterInventories.data['100'].items[0].state=1;
    const many=profile.itemComponents.sockets.data[multi].sockets,one=profile.itemComponents.sockets.data[single].sockets;
    defs.items[many[3].plugHash].displayProperties.name='Meganeura';
    defs.items[many[0].plugHash].displayProperties.name='Other barrel';many.pop();
    defs.items[one[2].plugHash].displayProperties.name='Destabilizing Rounds';
    defs.items[one[3].plugHash].displayProperties.name='Mega Kill Clip';
    defs.items[777]={displayProperties:{name:'Enhanced Dimensional Shift'},plug:{plugCategoryHash:100}};
    defs.items[778]={displayProperties:{name:'Enhanced Destabilizing Rounds'},plug:{plugCategoryHash:100}};
    profile.itemComponents.reusablePlugs.data[multi]={plugs:{2:[{plugItemHash:777,canInsert:true,enabled:true},{plugItemHash:778,canInsert:true,enabled:true}]}};
  }
  if(params.has('missing')){const socket=fixture.profile.itemComponents.sockets.data['900719925474099103'].sockets[2];delete fixture.defs.items[socket.plugHash];}
  return fixture;
}
VaultBungie.connected=()=>true;
VaultBungie.memberships=async()=>[{membershipType:3,membershipId:'1234567890123456789',displayName:'Synthetic QA inventory'}];
VaultBungie.definitions=async()=>sample().defs;
VaultBungie.client=()=>({profile:async()=>structuredClone(sample().profile),item:async item=>({item:{data:[...sample().profile.profileInventory.data.items,...sample().profile.characterInventories.data['100'].items].find(i=>i.itemInstanceId===item.id)}}),setLock:async(item,state)=>{const raw=[...sample().profile.profileInventory.data.items,...sample().profile.characterInventories.data['100'].items].find(i=>i.itemInstanceId===item.id);raw.state=state?raw.state|1:raw.state&~1;}});
if(new URLSearchParams(location.search).has('aged')){
  const scan=VaultScanCore.scan;
  VaultScanCore.scan=(profile,defs,catalog,mappings)=>scan(profile,defs,catalog,mappings,Date.now()-6*60*1000);
}
if(new URLSearchParams(location.search).has('storage-fail')){
  const setItem=Storage.prototype.setItem;
  Storage.prototype.setItem=function(key,value){if(key==='qa-armorVaultRecords')throw new Error('Browser storage is full (synthetic test).');return setItem.call(this,key,value);};
}
document.title='LOCAL QA — '+document.title;
document.addEventListener('DOMContentLoaded',()=>{const notice=document.createElement('p');notice.textContent='LOCAL QA: synthetic inventory, no Bungie requests';document.body.prepend(notice);});
`);
