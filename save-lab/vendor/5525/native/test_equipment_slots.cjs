'use strict';
// Historical-ID fixtures retain the old roster; new-game/one-time migration
// behavior is tested separately in test_updateplan_roster.cjs.
const assert=require('node:assert/strict'),C=require('./campaign.js'),B=require('./campaign-battle.js');
const clone=x=>JSON.parse(JSON.stringify(x));
let count=0;function test(name,fn){fn();count++;console.log('PASS '+name);}
function town(location='east'){const s=require('./test-current-fixture.cjs')();s.location=location;s.gold=5000;return s;}
function roundtrip(s){assert.deepEqual(C.deserialize(C.serialize(s)),clone(s));}
function battle(s){assert.ok(C.depart(s,'astaris'));assert.ok(C.travel(s,'safe',()=>.2));assert.ok(C.begin(s));return s.battle;}
function turn(b,id){b.actor=id;for(const u of b.units)u.next=u.id===id?1:100000;return b.units.find(u=>u.id===id);}
test('eight distinct slots, old keys map losslessly and all body slots exchange',()=>{
 const s=town('west'),c=s.characters.guard,old=clone(c);
 assert.equal(Object.keys(C.equipment(c)).length,8);assert.equal(C.equipment(c).rightHand,old.weapon);assert.equal(C.equipment(c).upperBody,old.armor);
 for(const slot of ['head','lowerBody','feet']){assert.ok(C.buyGear(s,'guard',`cloth-${slot}`,slot));roundtrip(s);assert.ok(C.buyGear(s,'guard',`empty-${slot}`,slot));}
 assert.ok(C.buyGear(s,'guard','armor-leather-1','upperBody'));assert.equal(c.armor,'armor-leather-1');
 const before=clone(s);assert.equal(C.buyGear(s,'guard','armor-iron-2','head'),false);assert.deepEqual(s,before);
});
test('two hands preserve sources; selection spends nothing and each action pays its cost',()=>{
 const s=town();assert.ok(C.buyGear(s,'mage','rest-staff','rightHand'));assert.ok(C.buyGear(s,'mage','breaker-hammer','leftHand'));
 const st=C.stats(s.characters.mage);assert.deepEqual(st.activeSkills,['healingCross','knockback']);assert.deepEqual(st.skillSources.filter(x=>x.classification==='active').map(x=>x.slot),['rightHand','leftHand']);
 const b=battle(s),a=turn(b,'mage'),e=b.units.find(u=>u.side==='enemy');b.units.find(u=>u.id==='guard').pos=a.pos;a.pos=24;e.pos=25;a.hp-=40;
 const actions=b.actions,mp=a.mp;assert.ok(B.selectSkill(b,'healingCross'));assert.equal(b.actions,actions);assert.equal(a.mp,mp);
 assert.ok(C.act(s,'skill',a.id));assert.equal(a.mp,mp-2);
 turn(b,a.id);assert.ok(B.selectSkill(b,'knockback'));const hp=e.hp;assert.ok(C.act(s,'skill',e.id));assert.ok(e.hp<hp);assert.equal(a.mp,mp-3);
 turn(b,a.id);const before=clone(b);assert.equal(B.selectSkill(b,'splitShot'),false);assert.deepEqual(clone(b),before);roundtrip(s);
 assert.deepEqual(b.skillEvents.filter(x=>x.actorId===a.id&&x.classification==='active').map(x=>x.skillId),['healingCross','knockback']);
});
test('separate hand copies allowed; invalid slots rejected atomically and sources retained',()=>{
 const s=town(),gold=s.gold;assert.ok(C.buyGear(s,'guard','sword-wood','leftHand'));assert.equal(s.gold,gold-C.gear.find(g=>g.id==='sword-wood').price);
 assert.ok(C.buyGear(s,'mage','staff-silver-1','leftHand'));const st=C.stats(s.characters.mage);assert.deepEqual(st.activeSkills,['mage']);assert.equal(st.skillSources.filter(x=>x.id==='mage').length,2);
 const bad=clone(s);bad.characters.guard.head='sword-wood';assert.equal(C.validate(bad).ok,false);
 for(const slot of ['head','accessory1','nonsense','__proto__']){const old=clone(s);assert.equal(C.buyGear(s,'guard','breaker-hammer',slot),false);assert.deepEqual(s,old);}
 roundtrip(s);
});
test('passives coexist, legacy duplicate effect copies load without stacking',()=>{
 const s=town('north');assert.ok(C.buyGear(s,'guard','victory-earring-1','accessory1'));assert.ok(C.buyGear(s,'guard','lone-ring-2','accessory2'));
 assert.deepEqual(C.stats(s.characters.guard).effects,['victoryBreath','loneWolf']);roundtrip(s);
 assert.ok(C.buyGear(s,'guard','victory-earring-2','accessory2'));const st=C.stats(s.characters.guard);assert.deepEqual(st.effects,['victoryBreath']);assert.equal(st.skillSources.filter(x=>x.id==='victoryBreath').length,2);roundtrip(s);
});
test('return remains once per battle across selection changes and save reload',()=>{
 const s=town('north');C.buyGear(s,'guard','return-ring-1');s.location='east';C.buyGear(s,'guard','undertow-sword','rightHand');C.buyGear(s,'guard','battleline-shield','leftHand');
 const b=battle(s),a=turn(b,'guard');assert.ok(B.selectSkill(b,'defenseLine'));assert.ok(C.act(s,'return',0));turn(b,'guard');assert.ok(B.selectSkill(b,'retreatSlash'));assert.equal(B.legal(b,'return',1),false);
 const loaded=C.deserialize(C.serialize(s));assert.ok(B.returnSkillOptions(loaded.battle.units.find(u=>u.id==='guard')).every(option=>option.used));assert.equal(B.legal(loaded.battle,'return',1),false);
});
test('unequip removes only that source; stats and HP/MP do not regenerate',()=>{
 const s=town();C.buyGear(s,'mage','sharing-tome','leftHand');const c=s.characters.mage;c.mp=1;c.hp=10;
 assert.ok(C.stats(c).activeSkills.includes('manaGift'));assert.ok(C.buyGear(s,'mage','empty-leftHand','leftHand'));assert.deepEqual(C.stats(c).activeSkills,['mage']);assert.equal(c.mp,1);assert.equal(c.hp,10);roundtrip(s);
});
test('empty hands expose item use rather than inherited job skill; left-only weapon becomes primary',()=>{
 const s=town();assert.ok(C.buyGear(s,'mage','empty-rightHand','rightHand'));
 assert.deepEqual(C.stats(s.characters.mage).activeSkills,[]);
 const t=C.trial(s,'mage','empty-leftHand','leftHand'),a=t.battle.units.find(u=>u.id==='mage');
 assert.equal(B.activeSkill(a),null);assert.equal(B.itemUseLevel(a),1);assert.deepEqual(B.skillTargets(t.battle,a),[]);
 assert.ok(C.buyGear(s,'mage','breaker-hammer','leftHand'));assert.equal(C.stats(s.characters.mage).atk,29);assert.deepEqual(C.stats(s.characters.mage).activeSkills,['knockback']);roundtrip(s);
});
test('race and ability restrictions unchanged; porter cannot select offensive skills',()=>{
 const s=town();assert.ok(C.buyGear(s,'mage','hammer-wood','leftHand'));assert.equal(C.buyGear(s,'mage','hammer-iron-1','leftHand'),false);assert.equal(C.buyGear(s,'scout','hammer-wood','leftHand'),false);
 assert.ok(C.buyGear(s,'porter','breaker-hammer','leftHand'));const b=battle(s),p=turn(b,'porter');assert.deepEqual(B.activeSkills(p),['porter']);assert.equal(B.selectSkill(b,'knockback'),false);assert.equal(p.atk,0);assert.equal(B.legal(b,'attack',b.units.find(u=>u.side==='enemy').id),false);roundtrip(s);
});
test('left-hand preview/trial isolated and selects offered skill',()=>{
 const s=town(),before=clone(s),preview=C.previewGear(s,'mage','breaker-hammer','leftHand'),t=C.trial(s,'mage','breaker-hammer','leftHand');assert.ok(t);assert.equal(preview.slot,'leftHand');assert.equal(preview.current.id,'empty-leftHand');assert.equal(B.activeSkill(t.battle.units.find(u=>u.id==='mage')),'knockback');assert.deepEqual(s,before);
});
test('save rejects forged skills, sources, selection and body equipment',()=>{
 const s=town();C.buyGear(s,'mage','sharing-tome','leftHand');battle(s);
 for(const mutate of [x=>x.battle.units.find(u=>u.id==='mage').activeSkills.push('knockback'),x=>x.battle.units.find(u=>u.id==='mage').selectedSkill='knockback',x=>x.battle.units.find(u=>u.id==='mage').skillSources[0].slot='head',x=>x.characters.mage.head='staff-wood',x=>x.characters.mage.head=null,x=>x.characters.mage.accessory1='']){const bad=clone(s);mutate(bad);assert.equal(C.validate(bad).ok,false);}
});
console.log(`PASS ${count} equipment-slot groups`);
