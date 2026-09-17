/* Synthetic API-shaped data for the example and regression tests. No account data. */
(function(root,factory){const value=factory();if(typeof module==='object'&&module.exports)module.exports=value;else root.VaultScanExample=value;})(globalThis,function(){
  return function example(catalog){
    const defs={items:{},stats:{9001:{displayProperties:{name:'Impact'}}},sets:{}};
    const profile={responseMintedTimestamp:new Date().toISOString(),profile:{data:{userInfo:{membershipId:'1234567890123456789',membershipType:3}}},characters:{data:{'100':{classType:0,dateLastPlayed:'2026-09-17T00:00:00Z'}}},
      profileInventory:{data:{items:[]}},characterInventories:{data:{'100':{items:[]}}},characterEquipment:{data:{'100':{items:[]}}},
      itemComponents:{sockets:{data:{}},reusablePlugs:{data:{}},instances:{data:{}}}};
    let hash=10000;
    function plug(name,category,stats=[]){const key=++hash;defs.items[key]={displayProperties:{name},plug:{plugCategoryHash:category,plugCategoryIdentifier:category===42?'v400.weapon.masterwork':'test'},investmentStats:stats};return key;}
    if(catalog.kind==='weapon'){
      const w=catalog.weapons[0];
      defs.stats[9001].displayProperties.name=w.statFocus;
      const columns=w.rollCols.map(c=>c[0]);
      const origin=plug(w.origin,164955586),focus=plug(w.statFocus,42,[{statTypeHash:9001,value:10}]);
      const weaponHash=111;defs.items[weaponHash]={itemType:3,displayProperties:{name:w.name},defaultDamageType:{Kinetic:1,Arc:2,Solar:3,Void:4,Stasis:6,Strand:7}[w.element],
        sockets:{socketCategories:[{socketCategoryHash:4241085061,socketIndexes:[0,1,2,3,4]}]}};
      for(let n=0;n<3;n++){
        const instance='900719925474099'+String(101+n);
        const values=columns.map((p,c)=>n===0&&c===3?'Other damage perk':n===1&&c===2?'Other utility perk':p);
        const sockets=values.map(p=>({plugHash:plug(p,100),isEnabled:true}));sockets.push({plugHash:origin,isEnabled:true},{plugHash:focus,isEnabled:true});
        profile.itemComponents.sockets.data[instance]={sockets};profile.itemComponents.reusablePlugs.data[instance]={plugs:{}};
        profile.itemComponents.instances.data[instance]={primaryStat:{value:2000+n}};
        const raw={itemInstanceId:instance,itemHash:weaponHash,state:n===0?1:0,bucketHash:1498876634};
        (n===2?profile.characterInventories.data['100'].items:profile.profileInventory.data.items).push(raw);
      }
    }else{
      const arch=catalog.archetypes[0],set=catalog.sets[0];
      const statHashes={Weapons:2996146975,Health:392767087,Class:1943323491,Grenade:1735777505,Super:144602215,Melee:4244567218};
      defs.sets[222]={displayProperties:{name:set.name}};
      defs.items[333]={itemType:2,displayProperties:{name:set.name+' Helmet'},classType:0,inventory:{bucketTypeHash:3448274439,tierType:5},equippingBlock:{equipableItemSetHash:222}};
      [arch.tertiaryOptions[0],arch.tertiaryOptions[1],arch.tertiaryOptions[0]].forEach((stat,n)=>{
        const instance='900719925474098'+String(101+n);
        const statPlug=plug('Base stats',748854354,[{statTypeHash:statHashes[arch.primary],value:n===2?35:30},{statTypeHash:statHashes[arch.secondary],value:25},{statTypeHash:statHashes[stat],value:20}]);
        const archetypePlug=plug(arch.name,778194869);
        profile.itemComponents.sockets.data[instance]={sockets:[{plugHash:statPlug,isEnabled:true},{plugHash:archetypePlug,isEnabled:true}]};
        profile.itemComponents.instances.data[instance]={primaryStat:{value:2000},gearTier:3};
        (n===2?profile.characterInventories.data['100'].items:profile.profileInventory.data.items).push({itemInstanceId:instance,itemHash:333,state:n===0?1:0});
      });
    }
    return {profile,defs};
  };
});
