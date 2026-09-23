const test=require('node:test'),assert=require('node:assert/strict');
const core=require('../bungie-core'),example=require('../bungie-example');
const weapon={id:0,name:'Example Rifle',element:'Arc',source:'Test',origin:'Example Origin',archetype:'Adaptive',statFocus:'Range',
  rollCols:[['Barrel'],['Magazine'],['Utility','Utility alternative'],['Damage']]};
const catalog={kind:'weapon',weapons:[weapon]};
const best='900719925474099103';
function fixture(){return example(catalog);}

test('origin-mismatched review copies show the same-name recommendation without changing scan decisions',()=>{
  const f=fixture(),origin=f.profile.itemComponents.sockets.data[best].sockets[4].plugHash;
  f.defs.items[origin].displayProperties.name='Other origin';
  const result=core.scan(f.profile,f.defs,catalog),before=JSON.stringify(result);
  const [roll]=core.weaponReviewRolls(result.review.find(i=>i.id===best),catalog.weapons);
  assert.equal(roll.weapon,weapon);assert.match(roll.warnings.join(' '),/Origin trait differs.*Same-name/);
  assert.deepEqual(roll.rows[2].recommended,['Utility','Utility alternative']);
  assert.deepEqual(roll.rows[2].matches,['Utility']);assert.deepEqual(roll.rows[5].matches,[]);
  assert.equal(JSON.stringify(result),before);assert.equal(core.lockPlan(result).length,0);
});
test('review highlights enhanced owned perks and priority stat while keeping alternatives visible',()=>{
  const f=fixture(),sockets=f.profile.itemComponents.sockets.data[best].sockets;
  f.defs.items[sockets[2].plugHash].displayProperties.name='Enhanced Utility';
  const item=core.scan(f.profile,f.defs,catalog).items.find(i=>i.id===best);
  const [roll]=core.weaponReviewRolls(item,catalog.weapons);
  assert.deepEqual(roll.rows[2].actual,['Enhanced Utility']);assert.deepEqual(roll.rows[2].matches,['Utility']);
  assert.deepEqual(roll.rows[4].recommended,['Range']);assert.deepEqual(roll.rows[4].matches,['Range']);
  assert.deepEqual(roll.rows[5].matches,['Example Origin']);
});
test('ambiguous versions are shown separately and a confirmed origin narrows the references',()=>{
  const versions=[weapon,{...weapon,id:1,name:'Example Rifle — New Version',source:'Other source',origin:'New Origin',rollCols:[['Other barrel'],['Magazine'],['Other utility'],['Damage']]}];
  const item={kind:'weapon',name:'Example Rifle',element:'Arc',origin:[],columns:[]};
  let rolls=core.weaponReviewRolls(item,versions);
  assert.equal(rolls.length,2);assert.ok(rolls.every(r=>r.warnings.some(w=>w.includes('Multiple catalog versions'))));
  assert.deepEqual(rolls[0].rows[0].recommended,['Barrel']);assert.deepEqual(rolls[1].rows[0].recommended,['Other barrel']);
  rolls=core.weaponReviewRolls({...item,origin:['New Origin']},versions);
  assert.equal(rolls.length,1);assert.equal(rolls[0].weapon.id,1);
});
test('missing socket data still shows recommendations with actual values left unconfirmed',()=>{
  const f=fixture();delete f.profile.itemComponents.sockets.data[best];
  const item=core.scan(f.profile,f.defs,catalog).review.find(i=>i.id===best);
  const [roll]=core.weaponReviewRolls(item,catalog.weapons);
  assert.equal(roll.rows.length,6);assert.ok(roll.rows.every(r=>r.actual.length===0 && r.matches.length===0));
  assert.match(roll.warnings.join(' '),/Origin trait could not be confirmed/);
});
test('unknown names have no invented recommendations; different elements are clearly reference-only',()=>{
  assert.deepEqual(core.weaponReviewRolls({kind:'weapon',name:'Missing weapon'},catalog.weapons),[]);
  assert.deepEqual(core.weaponReviewRolls({kind:'unknown',name:'Example Rifle'},catalog.weapons),[]);
  const [roll]=core.weaponReviewRolls({kind:'weapon',name:'Example Rifle',element:'Void'},catalog.weapons);
  assert.match(roll.warnings.join(' '),/Damage type differs.*Same-name/);
});
test('recommendation matching stays within the same column and physical copy',()=>{
  const f=fixture(),result=core.scan(f.profile,f.defs,catalog);
  const a=core.weaponReviewRolls(result.items.find(i=>i.id==='900719925474099101'),catalog.weapons)[0];
  const b=core.weaponReviewRolls(result.items.find(i=>i.id==='900719925474099102'),catalog.weapons)[0];
  assert.deepEqual(a.rows[2].matches,['Utility']);assert.deepEqual(a.rows[3].matches,[]);
  assert.deepEqual(b.rows[2].matches,[]);assert.deepEqual(b.rows[3].matches,['Damage']);
  const wrong=core.weaponReviewRolls({...result.items[0],columns:[['Utility'],[],[],[]]},catalog.weapons)[0];
  assert.deepEqual(wrong.rows[2].matches,[]);
});
test('an incomplete catalog entry stays visibly incomplete instead of borrowing another column',()=>{
  const [roll]=core.weaponReviewRolls({kind:'weapon',name:'Example Rifle',element:'Arc'},[{...weapon,rollCols:[['Barrel']]}]);
  assert.equal(roll.rows[1].recommended.length,0);assert.equal(roll.rows[3].recommended.length,0);
  assert.match(roll.warnings.join(' '),/recommendation is incomplete/);
});
