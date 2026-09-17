const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const core=require('../bungie-core'),example=require('../bungie-example');
const html=fs.readFileSync(path.join(__dirname,'../weapon-vault.html'),'utf8');
const brass=JSON.parse(html.match(/const WEAPONS = (\[.*?\]);/)[1]).find(w=>w.name==='Brass Attacks');
const catalog={kind:'weapon',weapons:[brass]};
const instance='900719925474099103';
function fixture(){const f=example(catalog);f.profile.profileInventory.data.items=[];return f;}

test('enhanced multi-perk Brass Attacks grades one actual copy and schedules its lock',()=>{
  const {profile,defs}=fixture(),sockets=profile.itemComponents.sockets.data[instance].sockets;
  // Deliberately miss the barrel: correct main traits must still earn Good.
  defs.items[sockets[0].plugHash].displayProperties.name='Other barrel';
  for(const col of [2,3])defs.items[sockets[col].plugHash].displayProperties.name='Enhanced '+defs.items[sockets[col].plugHash].displayProperties.name;
  // A second recommended option exists on this instance but is not selected.
  defs.items[777]={displayProperties:{name:'Enhanced Demoralize'},plug:{plugCategoryHash:100}};
  profile.itemComponents.reusablePlugs.data[instance]={plugs:{3:[{plugItemHash:777,enabled:true,canInsert:true}]}};
  const result=core.scan(profile,defs,catalog);
  assert.equal(result.weapons[0].winner.tier,'good');assert.equal(result.patches[brass.id].owned,true);
  assert.deepEqual(result.patches[brass.id].perk2,['Repulsor Brace']);
  assert.deepEqual(result.patches[brass.id].perk3,['Destabilizing Rounds','Demoralize']);
  assert.deepEqual(core.lockPlan(result)[0].locks.map(i=>i.id),[instance]);
});
test('missing enhanced definitions identify their hashes and retain the rejected copy in diagnostics',()=>{
  const {profile,defs}=fixture(),sockets=profile.itemComponents.sockets.data[instance].sockets;
  const missing=sockets[2].plugHash;delete defs.items[missing];
  const result=core.scan(profile,defs,catalog),diagnostics=core.weaponDiagnostics(result,profile,defs);
  assert.equal(result.weapons.length,0);assert.equal(result.review.length,1);
  assert.match(result.review[0].reason,new RegExp(String(missing)));assert.equal(core.lockPlan(result).length,0);
  assert.deepEqual(diagnostics[0].missingDefinitions,[missing]);assert.equal(diagnostics[0].instanceId,instance);
  assert.equal(diagnostics[0].sockets[2].current.name,null);
});
test('missing item definitions appear in review instead of silently disappearing',()=>{
  const {profile,defs}=fixture();delete defs.items[111];
  const result=core.scan(profile,defs,catalog);
  assert.equal(result.review.length,1);assert.deepEqual(result.review[0].missingDefinitions,[111]);
  assert.equal(core.weaponDiagnostics(result,profile,defs)[0].itemHash,111);
});
test('origin mismatches identify actual and catalog traits without relaxing version matching',()=>{
  const {profile,defs}=fixture(),origin=profile.itemComponents.sockets.data[instance].sockets[4].plugHash;
  defs.items[origin].displayProperties.name='Different origin';
  const result=core.scan(profile,defs,catalog);
  assert.equal(result.weapons.length,0);assert.match(result.review[0].reason,/Different origin.*Land Tank/);
  const diagnostic=core.weaponDiagnostics(result,profile,defs)[0];
  assert.deepEqual(diagnostic.columns[2],['Repulsor Brace']);assert.match(diagnostic.reason,/Origin trait mismatch/);
});
test('diagnostics report rejected selectable options without counting them as owned recommendations',()=>{
  const {profile,defs}=fixture();defs.items[777]={displayProperties:{name:'Demoralize'},plug:{plugCategoryHash:100}};
  profile.itemComponents.reusablePlugs.data[instance]={plugs:{3:[{plugItemHash:777,enabled:true,canInsert:false}]}};
  const result=core.scan(profile,defs,catalog),diagnostic=core.weaponDiagnostics(result,profile,defs)[0];
  assert.equal(diagnostic.sockets[3].options[0].canInsert,false);
  assert.equal(diagnostic.columns[3].includes('Demoralize'),false);
  assert.equal(diagnostic.catalogId,String(brass.id));assert.equal(diagnostic.keeper,instance);
  const serialized=JSON.stringify(diagnostic);assert.equal(/access_token|apiKey|Authorization/.test(serialized),false);
});
