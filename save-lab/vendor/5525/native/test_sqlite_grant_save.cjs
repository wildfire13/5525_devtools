'use strict';
// Historical-ID fixtures retain the old roster; new-game/one-time migration
// behavior is tested separately in test_updateplan_roster.cjs.
const assert=require('node:assert/strict'),C=require('./campaign.js'),B=require('./campaign-battle.js');
const clone=x=>JSON.parse(JSON.stringify(x));
let count=0;function test(name,fn){fn();count++;console.log('PASS '+name);}
function town(){const s=require('./test-current-fixture.cjs')();s.location='east';s.gold=5000;return s;}
function battle(s){assert.ok(C.depart(s,'astaris'));assert.ok(C.travel(s,'safe',()=>.2));assert.ok(C.begin(s));return s.battle;}
function roundtrip(s){const result=C.deserialize(C.serialize(s));assert.deepEqual(result,clone(s));return result;}
test('two owned copies equip separately and inventory consumption is atomic',()=>{
 const s=town(),c=s.characters.mage;
 c.inventory['staff-wood']=1;
 const q=C.inventoryQuote(s,'mage','staff-wood','equip',null,1,'leftHand');assert.ok(q.ok);
 assert.ok(C.inventoryAction(s,'mage','staff-wood','equip',null,1,'leftHand',q.token));
 assert.equal(c.inventory['staff-wood']||0,0);assert.equal(c.weapon,'staff-wood');assert.equal(c.leftHand,'staff-wood');
 const st=C.stats(c);assert.equal(st.skillSources.filter(x=>x.id==='mage').length,2);
 assert.deepEqual(st.skillSources.filter(x=>x.id==='mage').map(x=>x.grantSlot),[1,1]);
 const before=clone(s);assert.equal(C.inventoryAction(s,'mage','staff-wood','equip',null,1,'leftHand',q.token),false);assert.deepEqual(s,before);
 assert.equal(C.inventoryQuote(s,'mage','staff-wood','equip',null,1,'rightHand').ok,false);roundtrip(s);
});
test('duplicate non-hand slot remains rejected',()=>{
 const s=town();s.location='north';assert.ok(C.buyGear(s,'guard','lone-ring-1','accessory1'));
 const before=clone(s);assert.equal(C.buyGear(s,'guard','lone-ring-1','accessory2'),false);assert.deepEqual(s,before);
 const bad=clone(s);bad.characters.guard.accessory2='lone-ring-1';assert.equal(C.validate(bad).ok,false);
});
test('retired fists cannot be duplicated to manufacture a second migration refund',()=>{
 const s=town();s.characters.archer.weapon='fist-1';s.characters.archer.leftHand='fist-1';assert.equal(C.validate(s).ok,false);
 assert.throws(()=>C.deserialize({format:'5525-native-campaign',version:2,cargoRevision:1,state:s}));
});
test('selected grant and cooldown survive save reload and cannot be forged',()=>{
 const s=town();assert.ok(C.buyGear(s,'mage','staff-wood','leftHand'));const b=battle(s),a=b.units.find(u=>u.id==='mage');
 const options=B.activeSkillOptions(a);assert.equal(options.length,2);assert.notEqual(options[0].key,options[1].key);
 b.actor=a.id;assert.ok(B.selectSkill(b,options[1].key));a.skillCooldowns={[options[1].key]:1};
 const loaded=roundtrip(s),u=loaded.battle.units.find(u=>u.id==='mage');assert.equal(u.selectedSkillKey,options[1].key);
 assert.deepEqual(B.activeSkillOptions(u).map(x=>x.cooldown),[0,1]);
 for(const mutate of [u=>u.selectedSkillKey='fake',u=>u.skillCooldowns={fake:1},u=>u.skillCooldowns={[options[1].key]:2},u=>u.skillCooldowns={[options[1].key]:-1},u=>u.skillSources[0].grantSlot=2,u=>u.skillSources[0].itemId='staff-silver-1']){
   const bad=clone(s);mutate(bad.battle.units.find(u=>u.id==='mage'));assert.equal(C.validate(bad).ok,false);
 }
});
test('old saves without grant slots load deterministically without changing source input',()=>{
 const s=town();battle(s);const envelope=JSON.parse(C.serialize(s));delete envelope.state.battle.skillCooldownVersion;
 for(const snapshot of [envelope.state,envelope.state.rollback].filter(Boolean))if(snapshot.battle)for(const u of snapshot.battle.units)for(const source of u.skillSources||[])delete source.grantSlot;
 const before=clone(envelope),loaded=C.deserialize(envelope);assert.deepEqual(envelope,before);assert.equal(loaded.battle.skillCooldownVersion,1);
 for(const u of loaded.battle.units)for(const source of u.skillSources||[])assert.equal(source.grantSlot,1);
 roundtrip(loaded);
 const bad=clone(envelope),a=bad.state.battle.units.find(u=>u.side==='ally');a.skillSources[0].slot='head';assert.throws(()=>C.deserialize(bad));
});
test('product trials opt in and retreat/new battle does not carry cooldown',()=>{
 const s=town(),trial=C.trial(s,'mage','staff-wood','leftHand');assert.equal(trial.battle.skillCooldownVersion,1);
 const b=battle(s),a=b.units.find(u=>u.id==='mage');assert.equal(b.skillCooldownVersion,1);
 const option=B.activeSkillOptions(a)[0];a.skillCooldowns={[option.key]:1};roundtrip(s);
 assert.ok(C.retreat(s));assert.ok(C.acknowledge(s));battle(s);
 assert.ok(s.battle.units.every(u=>u.skillCooldowns===undefined));roundtrip(s);
 const bad=clone(s);bad.battle.skillCooldownVersion=2;assert.equal(C.validate(bad).ok,false);
});
test('return grants preserve independent used states and reject forged keys',()=>{
 const s=town();s.location='north';s.characters.guard.inventory={};s.characters.guard.lowerBody='cloth-lowerBody';assert.ok(C.buyGear(s,'guard','return-ring-1','accessory1'));assert.ok(C.buyGear(s,'guard','return-ring-2','accessory2'));
 const b=battle(s),a=b.units.find(u=>u.id==='guard'),options=B.returnSkillOptions(a);assert.equal(options.length,2);
 b.actor=a.id;for(const u of b.units)u.next=u.id===a.id?1:100000;
 assert.ok(B.selectReturnSkill(b,options[1].key));assert.ok(C.act(s,'return',0));
 const loaded=roundtrip(s),hero=loaded.battle.units.find(u=>u.id===a.id);
 assert.deepEqual(B.returnSkillOptions(hero).map(o=>o.used),[false,true]);assert.equal(hero.selectedReturnSkillKey,options[1].key);
 for(const mutate of [u=>u.returnUsedGrants={fake:true},u=>u.returnUsedGrants={[options[0].key]:1},u=>u.selectedReturnSkillKey='fake',u=>u.returnUsed=true]){
  const bad=clone(s);mutate(bad.battle.units.find(u=>u.id===a.id));assert.equal(C.validate(bad).ok,false);
 }
});
test('old actor-wide used return remains consumed for every grant after load',()=>{
 const s=town();s.location='north';s.characters.guard.inventory={};s.characters.guard.lowerBody='cloth-lowerBody';C.buyGear(s,'guard','return-ring-1','accessory1');C.buyGear(s,'guard','return-ring-2','accessory2');battle(s);
 const a=s.battle.units.find(u=>u.id==='guard');a.returnUsed=true;
 const source=C.serialize(s),loaded=C.deserialize(source),hero=loaded.battle.units.find(u=>u.id==='guard');
 assert.equal(hero.returnUsed,true);assert.ok(B.returnSkillOptions(hero).every(o=>o.used));assert.equal(JSON.stringify(s),JSON.stringify(JSON.parse(source).state));
 roundtrip(loaded);
});
console.log(`PASS ${count} SQLite grant-save groups`);
