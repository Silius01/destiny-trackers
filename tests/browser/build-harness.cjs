const fs=require('node:fs'),path=require('node:path');
const repo=path.join(__dirname,'../..');
for(const kind of ['weapon','armor']){
 let html=fs.readFileSync(path.join(repo,kind+'-vault.html'),'utf8');
 html=html.replaceAll('src="bungie-','src="../../bungie-').replace('href="bungie-ui.css"','href="../../bungie-ui.css"');
 html=html.replace('<script src="../../bungie-ui.js">','<script src="mock-runtime.js"></script><script src="../../bungie-ui.js">');
 html=html.replace(/(weaponVault|armorVault)(Records|HeaderCollapsed)/g,'qa-$1$2');
 fs.writeFileSync(path.join(__dirname,'generated-'+kind+'.html'),html);
}
fs.writeFileSync(path.join(__dirname,'mock-runtime.js'),`
let fixture;
const realArmor=${fs.readFileSync(path.join(__dirname,'../fixtures/twisting-echo.json'),'utf8')};
function sample(){if(!fixture){const params=new URLSearchParams(location.search),twisting=params.get('armor')==='twisting';fixture=VaultScanExample(location.pathname.includes('armor')?{kind:'armor',sets:twisting?SETS.filter(s=>s.name==='Yearning Echo'):SETS,combos:COMBOS,archetypes:twisting?ARCHETYPES.filter(a=>a.name==='Powerhouse'):ARCHETYPES}:{kind:'weapon',weapons:params.get('weapon')==='brass'?WEAPONS.filter(w=>w.name==='Brass Attacks'):WEAPONS});if(twisting){fixture.defs=structuredClone(realArmor.defs);fixture.profile.characters.data['100'].classType=1;const rows=[...fixture.profile.profileInventory.data.items,...fixture.profile.characterInventories.data['100'].items];rows.forEach((raw,index)=>{raw.itemHash=3229172222;raw.state=0;fixture.profile.itemComponents.sockets.data[raw.itemInstanceId]={sockets:[realArmor.statPlugs.Weapons,realArmor.statPlugs.Super,realArmor.statPlugs[index===1?'Class':'Health'],544009373].map(plugHash=>({plugHash,isEnabled:true}))};});if(params.has('blocked'))fixture.profile.itemComponents.sockets.data[rows[1].itemInstanceId].sockets.pop();}if(params.has('missing')){const socket=fixture.profile.itemComponents.sockets.data['900719925474099103'].sockets[2];delete fixture.defs.items[socket.plugHash];}}return fixture;}
VaultBungie.connected=()=>true;
VaultBungie.memberships=async()=>[{membershipType:3,membershipId:'1234567890123456789',displayName:'Synthetic QA inventory'}];
VaultBungie.definitions=async()=>sample().defs;
VaultBungie.client=()=>({profile:async()=>structuredClone(sample().profile),item:async item=>({item:{data:[...sample().profile.profileInventory.data.items,...sample().profile.characterInventories.data['100'].items].find(i=>i.itemInstanceId===item.id)}}),setLock:async(item,state)=>{const raw=[...sample().profile.profileInventory.data.items,...sample().profile.characterInventories.data['100'].items].find(i=>i.itemInstanceId===item.id);raw.state=state?raw.state|1:raw.state&~1;}});
document.title='LOCAL QA — '+document.title;
document.addEventListener('DOMContentLoaded',()=>{const notice=document.createElement('p');notice.textContent='LOCAL QA: synthetic inventory, no Bungie requests';document.body.prepend(notice);});
`);
