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
function sample(){if(!fixture)fixture=VaultScanExample(location.pathname.includes('armor')?{kind:'armor',sets:SETS,combos:COMBOS,archetypes:ARCHETYPES}:{kind:'weapon',weapons:WEAPONS});return fixture;}
VaultBungie.connected=()=>true;
VaultBungie.memberships=async()=>[{membershipType:3,membershipId:'1234567890123456789',displayName:'Synthetic QA inventory'}];
VaultBungie.definitions=async()=>sample().defs;
VaultBungie.client=()=>({profile:async()=>structuredClone(sample().profile),item:async item=>({item:{data:[...sample().profile.profileInventory.data.items,...sample().profile.characterInventories.data['100'].items].find(i=>i.itemInstanceId===item.id)}}),setLock:async(item,state)=>{const raw=[...sample().profile.profileInventory.data.items,...sample().profile.characterInventories.data['100'].items].find(i=>i.itemInstanceId===item.id);raw.state=state?raw.state|1:raw.state&~1;}});
document.title='LOCAL QA — '+document.title;
document.addEventListener('DOMContentLoaded',()=>{const notice=document.createElement('p');notice.textContent='LOCAL QA: synthetic inventory, no Bungie requests';document.body.prepend(notice);});
`);
