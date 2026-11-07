#!/usr/bin/env node
'use strict';
// Historical-ID fixtures retain the old roster; new-game/one-time migration
// behavior is tested separately in test_updateplan_roster.cjs.
const assert=require('node:assert/strict');
const C=require('./campaign.js');
function acceptWithPorter(s,id){return C.accept(s,id,s.selected.find(uid=>C.view(s).roster.find(u=>u.id===uid)?.job==='porter'));}
const B=require('./campaign-battle.js');
const clone=x=>JSON.parse(JSON.stringify(x));
let passed=0;
function test(name,fn){try{fn();passed++;console.log('PASS '+name);}catch(e){console.error('FAIL '+name);throw e;}}
function random(seed=5525){return ()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);}
function okay(s){const result=C.validate(s);assert.equal(result.ok,true,result.error);assert.deepEqual(C.deserialize(C.serialize(s)),clone(s));}
function deployHealthy(s){
  if(s.selected.length<=s.battle.units.filter(u=>u.side==='ally').length)return;
  const b=s.battle,chosen=s.selected.filter(id=>s.characters[id].hp>0).sort((a,b)=>s.characters[b].hp/C.stats(s.characters[b]).max-s.characters[a].hp/C.stats(s.characters[a]).max).slice(0,b.battleLimit||5),keep=new Set(chosen);
  for(const u of [...b.units.filter(u=>u.side==='ally')])if(!keep.has(u.id))assert(C.deployment_assign(s,u.id,null));
  for(const id of chosen){if(b.units.some(u=>u.side==='ally'&&u.id===id))continue;const occupied=new Set(b.units.filter(u=>u.hp>0).map(u=>u.pos)),pos=Array.from({length:50},(_,p)=>p).find(p=>B.boardOf(p)==='ally'&&!occupied.has(p));assert.notEqual(pos,undefined);assert(C.deployment_assign(s,id,pos));}
}
function fight(s,guardOnly=false){
  deployHealthy(s);assert.equal(C.begin(s),true);okay(s);
  for(let n=0;n<300&&!s.battle.result;n++){
    const copy=clone(s.battle),actor=copy.units.find(u=>u.id===copy.actor);B.plan(copy,actor);let {kind,target}=actor.intent;
    if(guardOnly){kind='guard';target=null;}
    else {
      const hurt=copy.units.filter(u=>u.side==='ally'&&u.hp>0&&u.hp<u.max*.5).sort((a,b)=>a.hp/a.max-b.hp/b.max).find(u=>B.legal(copy,'item',u.id));
      if(hurt){kind='item';target=hurt.id;}
      else if(actor.job==='porter'){kind=B.legal(copy,'skill',actor.id)?'skill':'guard';target=kind==='skill'?actor.id:null;}
    }
    assert.equal(C.act(s,kind,target),true,`${kind} ${target}`);
  }
  assert.ok(s.battle.result,'battle terminates');if(!s.battle.failure)assert.equal(s.battle.result,'勝利！ 街道を切り抜けた。');okay(s);
  assert.equal(C.finishBattle(s),true);okay(s);
}
// Reward/accounting fixture: seed 2 provides a completable encounter sequence
// with per-grant cooldowns. This test is not a guarantee that the simple bot
// wins every roster; retreat/failure behavior is covered separately below.
function trip(s,destination,{quest=true,route='short',rest=true,seed=2}={}){
  if(quest){const q=C.board(s).find(q=>q.to===destination);assert.ok(q,'offered destination');assert.equal(acceptWithPorter(s,q.id),true);}
  assert.equal(C.depart(s,destination),true);okay(s);const rng=random(seed);
  for(let i=0;i<2;i++){
    assert.equal(C.travel(s,route,rng),true);okay(s);fight(s);assert.notEqual(s.result?.outcome,'failed','trip won');
    if(i===0){if(rest)assert.equal(C.rest(s),true);assert.equal(C.onward(s),true);}
  }
  assert.equal(s.phase,'arrival');assert.equal(C.arrive(s),true);okay(s);
  if(quest){assert.equal(s.phase,'town');assert.equal(C.completeQuest(s),true);okay(s);}
}
function town(id){const s=require('./test-current-fixture.cjs')();s.location=id;return s;}
test('city and four source-map villages, correct facilities',()=>{
  assert.deepEqual(C.locations.map(p=>p.name),['アスタリス','イース','ウエス','サウス','ノース']);
  assert.deepEqual(C.locations.map(p=>p.facilities),[['board','guild','inn'],['board','weapon'],['board','armor'],['board','items'],['board','accessory']]);
  for(const p of C.locations){const s=town(p.id);assert.ok(C.board(s).length);assert.equal(C.view(s).guildAvailable,p.id==='astaris');okay(s);}
});
test('guild is city-only, free, party cap twelve, unique roster; porter required only at acceptance',()=>{
  const s=require('./test-current-fixture.cjs')(),gold=s.gold;for(const ids of [[],['porter','porter'],['bogus','porter']])assert.equal(C.select(s,ids),false);
  assert.equal(C.select(s,['guard']),true);okay(s);assert.equal(acceptWithPorter(s,C.board(s)[0].id),false);
  assert.equal(C.select(s,['porter','warrior']),true);assert.equal(s.gold,gold);s.location='east';assert.equal(C.select(s,['porter']),false);
});
test('boards expose real deadline/reward tradeoff and refresh after trip',()=>{
  const s=require('./test-current-fixture.cjs')(),offers=C.board(s);assert.equal(offers[0].deadline,6);assert.equal(offers[0].reward,180);assert.equal(offers[1].deadline,10);assert.equal(offers[1].reward,150);
  assert.equal(acceptWithPorter(s,offers[0].id),true);assert.deepEqual(C.board(s),[]);assert.equal(acceptWithPorter(s,offers[1].id),false);assert.equal(C.depart(s,offers[1].to),true);
});
test('public-operation delivery accumulates separate battle loot/XP, cannot double claim',()=>{
  const s=require('./test-current-fixture.cjs')();trip(s,'east',{rest:false});assert.equal(s.result.outcome,'success');assert.equal(s.result.gold,180);assert.equal(s.gold,180+16+180);assert.equal(s.characters.guard.xp,40);assert.equal(s.partyRP,100);assert.equal(s.xp,0);
  assert.equal(C.arrive(s),false);assert.equal(C.finishBattle(s),false);assert.equal(s.completed,1);assert.equal(C.acknowledge(s),true);assert.equal(C.acknowledge(s),false);assert.ok(C.board(s).length);okay(s);
});
test('completed quest retains loot and gear while KO members remain down away from Astaris',()=>{
  const s=require('./test-current-fixture.cjs')(),reserves=Object.keys(s.characters).filter(id=>id.startsWith('recruit-')).slice(0,7);assert(C.select(s,[...s.selected,...reserves]));s.characters.mage.inventory.potion=1;s.characters.archer.inventory.potion=1;trip(s,'east');assert.equal(C.acknowledge(s),true);const oldGold=s.gold;assert.equal(C.buyGear(s,'archer','bow-wood-1'),true);assert.equal(s.gold,oldGold-140);assert.equal(s.characters.archer.inventory['bow-wood'],1);
  assert.ok(s.selected.some(id=>s.characters[id].hp===0),'fallen characters stay KO after travel; only Astaris inn can restore them');assert.equal(C.view(s).inn.available,false);assert.ok(C.board(s).length);assert.equal(s.characters.guard.xp,40);assert.equal(s.partyRP,60);assert.equal(s.xp,0);assert.equal(s.characters.archer.weapon,'bow-wood-1');okay(s);
});
test('questless travel grants normal fight rewards but no delivery bonus',()=>{
  const s=require('./test-current-fixture.cjs')(),start=s.gold;trip(s,'south',{quest:false,route:'safe'});assert.equal(s.result.outcome,'travel');assert.equal(s.result.gold,0);assert.equal(s.result.xp,0);assert.equal(s.gold,start+16);assert.equal(s.characters.guard.xp,40);assert.equal(s.xp,0);assert.equal(s.completed,0);assert.equal(s.location,'south');
});
test('six-hour deadline is on time, rest produces late payout',()=>{
  const s=require('./test-current-fixture.cjs')();trip(s,'east',{rest:true});assert.equal(s.result.hours,8);assert.equal(s.result.outcome,'late');assert.equal(s.result.gold,117);assert.equal(s.result.xp,0);assert.equal(s.result.rp,60);
});
test('forecast handles quest and questless without fake reward',()=>{
  const s=require('./test-current-fixture.cjs')();assert.equal(C.forecast(s,'short'),null);acceptWithPorter(s,C.board(s)[0].id);C.depart(s,'east');assert.equal(C.forecast(s,'short').hours,6);assert.equal(C.forecast(s,'short').late,false);assert.equal(C.forecast(s,'safe').late,true);
  const t=require('./test-current-fixture.cjs')();C.depart(t,'north');assert.equal(C.forecast(t,'safe').reward,0);assert.equal(C.forecast(t,'safe').questless,true);
});
test('R08 ring routes prohibit opposite-village and unknown departures',()=>{
  const s=town('east'),before=clone(s);assert.equal(C.depart(s,'west'),false);assert.equal(C.depart(s,'garbage'),false);assert.deepEqual(s,before);assert.equal(C.depart(s,'astaris'),true);
});
test('deployment can reset without rerolling enemies or spending resources',()=>{
  const s=require('./test-current-fixture.cjs')();C.depart(s,'north');C.travel(s,'safe',random());const initial=clone(s.battle),enemy=clone(initial.units.filter(u=>u.side==='enemy'));assert.equal(C.deploy(s,'guard',0),true);assert.equal(C.deployment_reset(s),true);assert.deepEqual(clone(s.battle),initial);assert.deepEqual(s.battle.units.filter(u=>u.side==='enemy'),enemy);assert.equal(C.begin(s),true);assert.equal(C.deployment_reset(s),false);
});
test('quest failure restores snapshot from immediately before acceptance',()=>{
  const s=require('./test-current-fixture.cjs')();C.select(s,['porter']);const before=clone(s);acceptWithPorter(s,C.board(s)[0].id);C.depart(s,'east');C.travel(s,'short',random());fight(s,true);assert.equal(s.result.outcome,'failed');assert.equal(s.result.restored,true);C.acknowledge(s);
  for(const key of ['gold','xp','level','hours','selected','characters','inventory','sequence','completed','boardRound','location'])assert.deepEqual(s[key],before[key],key);assert(s.worldTime>before.worldTime,'world calendar continues while failed trip restores gameplay state');okay(s);
});
test('questless failure restores departure snapshot',()=>{
  const s=require('./test-current-fixture.cjs')();C.select(s,['porter']);const before=clone(s);C.depart(s,'north');C.travel(s,'short',random());fight(s,true);assert.equal(s.result.outcome,'failed');C.acknowledge(s);
  for(const key of ['gold','xp','level','hours','selected','characters','inventory','sequence','completed','location'])assert.deepEqual(s[key],before[key],key);assert(s.worldTime>before.worldTime,'world calendar continues while questless trip restores gameplay state');okay(s);
});
test('R09 shops stock their source-map categories; accessories belong to North',()=>{
  assert.ok(C.shop(town('east')).every(g=>['weapon','leftHand'].includes(g.slot)));assert.ok(C.shop(town('west')).every(g=>['armor','head','lowerBody','feet'].includes(g.slot)));
  assert.deepEqual(C.shop(town('south')).map(g=>g.id),['potion','ether']);assert(C.shop(town('north')).length>0);assert(C.shop(town('north')).every(g=>['accessory1','accessory2'].includes(g.slot)));assert.deepEqual(C.shop(require('./test-current-fixture.cjs')()),[]);
});
test('buy at catalog price, retain old gear, and re-equip owned gear without charging',()=>{
  const s=town('east'),before=s.gold;assert.equal(C.buyGear(s,'archer','bow-wood-1'),true);assert.equal(s.gold,before-140);assert.equal(s.characters.archer.inventory['bow-wood'],1);
  assert(C.inventoryAction(s,'archer','bow-wood','equip',null,1,'rightHand',C.inventoryToken(s)));assert.equal(s.gold,before-140);assert.equal(s.characters.archer.inventory['bow-wood-1'],1);assert.equal(C.buyGear(s,'archer','bow-wood'),false);okay(s);
});
test('wrong shop, insufficient gold, unselected character and invalid item rejected atomically',()=>{
  const s=require('./test-current-fixture.cjs')(),before=clone(s);assert.equal(C.buyGear(s,'archer','bow-wood-1'),false);assert.deepEqual(s,before);s.location='east';s.gold=0;const zero=clone(s);
  assert.equal(C.buyGear(s,'archer','bow-wood-1'),false);assert.equal(C.buyGear(s,'archer-2','bow-wood-1'),false);assert.equal(C.buyGear(s,'archer','__proto__'),false);assert.deepEqual(s,zero);
});
test('race/material/stat conditions, no job gate: elf healer may wield wooden hammer',()=>{
  const s=town('east');assert.equal(C.eligibility(s,'mage','hammer-wood').ok,true);assert.equal(C.buyGear(s,'mage','hammer-wood'),true);assert.equal(C.eligibility(s,'mage','hammer-iron-1').ok,false);assert.equal(C.eligibility(s,'mage','staff-silver-1').ok,true);assert.equal(C.eligibility(s,'scout','hammer-wood').ok,false);assert.equal(C.eligibility(s,'warrior','sword-wood').ok,false);okay(s);
});
test('equipped hammer skill changes healer battle skill without mutating original job',()=>{
  const s=town('east');C.buyGear(s,'mage','hammer-wood');C.depart(s,'astaris');C.travel(s,'safe',random());const u=s.battle.units.find(u=>u.id==='mage');assert.equal(u.job,'mage');assert.equal(B.activeSkill(u),'stamp');assert.equal(u.atk,29);okay(s);
});
test('C01 porter retains support/no attack despite meeting hammer equip conditions',()=>{
  const s=town('east');assert.equal(C.buyGear(s,'porter','hammer-wood'),true);C.depart(s,'astaris');C.travel(s,'safe',random());const p=s.battle.units.find(u=>u.id==='porter');assert.equal(p.equippedSkill,'porter');assert.equal(B.activeSkill(p),'porter');assert.equal(p.atk,0);assert.equal(p.reach,0);C.begin(s);for(const e of s.battle.units.filter(u=>u.side==='enemy'))assert.equal(B.legalFor(s.battle,p,'attack',e.id),false);
});
test('armor increases maxHP but swap cycles cannot heal or revive',()=>{
  const s=town('west');s.characters.guard.hp=28;const before=s.gold;assert.equal(C.buyGear(s,'guard','armor-leather-1'),true);assert.equal(s.characters.guard.hp,28);assert.equal(C.stats(s.characters.guard).max,208);
  const equip=id=>C.inventoryAction(s,'guard',id,'equip',null,1,'upperBody',C.inventoryToken(s));assert(equip('armor-cloth'));assert(equip('armor-leather-1'));assert.equal(s.characters.guard.hp,28);
  s.characters.guard.hp=0;assert(equip('armor-cloth'));assert.equal(s.characters.guard.hp,0);assert.equal(s.gold,before-95);
});
test('staff MP swap cannot regenerate MP; item restoration is real consumption',()=>{
  const s=town('east');s.characters.mage.mp=1;assert.equal(C.buyGear(s,'mage','staff-silver-1'),true);assert.equal(s.characters.mage.mp,1);assert(C.inventoryAction(s,'mage','staff-wood','equip',null,1,'rightHand',C.inventoryToken(s)));assert.equal(s.characters.mage.mp,1);
  s.location='south';assert.equal(C.buyItem(s,'ether',1,'mage',C.inventoryToken(s)),true);const stock=C.inventoryTotals(s).ether;assert.equal(C.useItem(s,'ether','mage','mage',C.inventoryToken(s)),true);assert.equal(s.characters.mage.mp,4);assert.equal(C.inventoryTotals(s).ether,stock-1);okay(s);
});
test('trial is isolated, affordable or not, and uses actual controllable stamp damage',()=>{
  const s=town('east');s.gold=0;const before=C.serialize(s),t=C.trial(s,'mage','hammer-wood');assert.ok(t);assert.equal(t.preview.affordable,false);assert.equal(t.battle.actor,'mage');assert.equal(B.activeSkill(t.battle.units.find(u=>u.id==='mage')),'stamp');
  assert.equal(C.trialAct(t,'skill',25),true);const changes=t.lastAction.changes.filter(c=>c.id.startsWith('enemy-'));assert.equal(changes.length,3);assert.ok(changes.every(c=>c.hp<0));assert.equal(t.battle.actor,'mage');assert.equal(C.serialize(s),before);assert.equal(C.trial(s,'scout','hammer-wood'),null);
});
test('trial heal hits injured ally and consumes only trial MP',()=>{
  const s=town('east'),before=C.serialize(s),t=C.trial(s,'mage','staff-wood');assert.ok(t);assert.equal(C.trialAct(t,'skill','archer'),true);assert.ok(t.lastAction.changes.some(c=>c.id==='archer'&&c.hp>0));assert.equal(C.serialize(s),before);
});
test('growth points can wait and later change stats within available budget',()=>{
  const s=require('./test-current-fixture.cjs')();trip(s,'west',{rest:false});C.acknowledge(s);const c=s.characters.mage;assert.equal(c.statPoints,2);assert.equal(C.allocate(s,'mage','str',2),true);assert.equal(C.stats(c).str,16);assert.equal(c.statPoints,0);assert.equal(c.skillPoints,1);assert.equal(C.allocate(s,'mage','str',1),false);assert.equal(C.allocate(s,'mage','__proto__',1),false);okay(s);
});
test('JSON export/import restores independent exact current state',()=>{
  const s=require('./test-current-fixture.cjs')();acceptWithPorter(s,C.board(s)[0].id);C.depart(s,'east');C.travel(s,'short',random());C.deploy(s,'guard',0);const copy=C.deserialize(C.serialize(s));assert.deepEqual(copy,clone(s));copy.gold++;assert.notEqual(copy.gold,s.gold);assert.deepEqual(C.deserialize(JSON.parse(C.serialize(s))),clone(s));
});
test('invalid save types, huge input, versions and prototype payloads rejected',()=>{
  const good=JSON.parse(C.serialize(require('./test-current-fixture.cjs')()));for(const bad of ['{',null,{},'x'.repeat(C.MAX_SAVE_BYTES+1),JSON.stringify({...good,version:999})])assert.throws(()=>C.deserialize(bad));
  const pollution=JSON.stringify(good).replace('"state":{','"state":{"__proto__":{"polluted":true},');assert.throws(()=>C.deserialize(pollution));assert.equal({}.polluted,undefined);
});
test('invalid financial, roster, inventory, gear, resources and allocation saves rejected',()=>{
  const good=JSON.parse(C.serialize(require('./test-current-fixture.cjs')()));const mutations=[s=>s.gold=-1,s=>s.gold='100',s=>s.selected=[],s=>s.selected=['porter','porter'],s=>s.location='missing',s=>s.characters.guard.inventory.potion=100,s=>s.characters.guard.weapon='missing',s=>s.characters.guard.hp=999999,s=>s.characters.guard.allocations.str=100,s=>s.characters.mage.weapon='hammer-iron-1',s=>s.characters.guard.level=99,s=>s.phase='battle'];
  for(const change of mutations){const bad=clone(good);change(bad.state);assert.throws(()=>C.deserialize(bad));}
});
test('invalid battle actor, tokens, duplicate cells and skill payloads rejected',()=>{
  const s=require('./test-current-fixture.cjs')();C.depart(s,'north');C.travel(s,'safe',random());C.begin(s);const good=JSON.parse(C.serialize(s));
  for(const change of [s=>s.battle.campaignToken++,s=>s.battle.actor='enemy-guard',s=>s.battle.units[0].pos=s.battle.units[1].pos,s=>s.battle.units[0].equippedSkill='eval',s=>s.battle.units[0].max=99999,s=>s.journey.destination='west-east',s=>s.rollback.rollback={}]){const bad=clone(good);change(bad.state);assert.throws(()=>C.deserialize(bad));}
});
test('predeparture purchases also roll back to acceptance snapshot',()=>{
  const s=town('east');s.selected=['porter'];s.characters.porter.hp=1;const before=clone(s);
  assert.equal(acceptWithPorter(s,C.board(s).find(q=>q.to==='astaris').id),true);assert.equal(C.buyGear(s,'porter','hammer-wood'),true);assert.equal(C.depart(s,'astaris'),true);C.travel(s,'short',random());fight(s,true);C.acknowledge(s);
  for(const key of ['gold','characters','inventory','selected','hours','location'])assert.deepEqual(s[key],before[key]);
});
test('two-porters any-one failure restores entire expedition',()=>{
  const s=require('./test-current-fixture.cjs')();assert.equal(C.select(s,['guard','archer','mage','porter','porter-2']),true);s.characters['porter-2'].hp=1;const before=clone(s);acceptWithPorter(s,C.board(s)[0].id);C.depart(s,'east');C.travel(s,'short',random());
  const p=s.battle.units.find(u=>u.id==='porter-2');assert.equal(C.deploy(s,p.id,24),true);fight(s,true);assert.equal(s.result.outcome,'failed');C.acknowledge(s);assert.deepEqual(s.characters,before.characters);assert.equal(s.gold,before.gold);
});
test('bad encounter generator arguments leave trip untouched',()=>{
  const s=require('./test-current-fixture.cjs')();C.depart(s,'north');const before=clone(s);for(const bad of [null,4,()=>NaN,()=>1,()=>-1]){assert.equal(C.travel(s,'short',bad),false);assert.deepEqual(s,before);}
});
test('malformed camp party and battle intents cannot poison imported saves',()=>{
  const s=require('./test-current-fixture.cjs')();C.depart(s,'north');C.travel(s,'safe',random());fight(s);const camp=JSON.parse(C.serialize(s));camp.state.journey.party[0].max='oops';assert.throws(()=>C.deserialize(camp));
  C.onward(s);C.travel(s,'safe',random());C.begin(s);const battle=JSON.parse(C.serialize(s));const enemy=battle.state.battle.units.find(u=>u.side==='enemy');enemy.intent.cells='oops';assert.throws(()=>C.deserialize(battle));
});
test('scout intent requires execution path and landing cell before importing',()=>{
  let s,scout;const rng=random(0);
  for(let i=0;i<100;i++){s=require('./test-current-fixture.cjs')();C.depart(s,'north');C.travel(s,'short',rng);C.begin(s);scout=s.battle.units.find(u=>u.side==='enemy'&&u.job==='scout'&&u.intent?.kind==='skill');if(scout)break;}
  assert.ok(scout,'real generated scout ambush intent');const original=C.serialize(s),envelope=JSON.parse(original);
  for(const key of ['path','destination']){const bad=clone(envelope);delete bad.state.battle.units.find(u=>u.id===scout.id).intent[key];assert.equal(C.validate(bad.state).ok,false);assert.throws(()=>C.serialize(bad.state));assert.throws(()=>C.deserialize(bad));}
  const loaded=C.deserialize(original);for(let i=0;i<3&&!loaded.battle.result;i++)assert.equal(C.act(loaded,'guard',null),true);okay(loaded);assert.equal(C.serialize(s),original);
});
test('required battle UI text and intent display fields cannot be omitted or replaced',()=>{
  const s=require('./test-current-fixture.cjs')();C.depart(s,'north');C.travel(s,'short',random());C.begin(s);const original=JSON.parse(C.serialize(s));
  for(const key of ['name','image','icon','role'])for(const value of [undefined,null,42,{}]){const bad=clone(original);bad.state.battle.units[0][key]=value;assert.throws(()=>C.deserialize(bad),key);}
  for(const key of ['name','reason']){const bad=clone(original);delete bad.state.battle.units.find(u=>u.side==='enemy').intent[key];assert.throws(()=>C.deserialize(bad));}
  const badLog=clone(original);badLog.state.battle.log.push({text:'bad'});assert.throws(()=>C.deserialize(badLog));
});
test('cover references and camp roster display cannot crash loaded UI',()=>{
  const s=require('./test-current-fixture.cjs')();C.depart(s,'north');C.travel(s,'safe',random());C.begin(s);const battle=JSON.parse(C.serialize(s));battle.state.battle.units[0].cover='missing-character';assert.throws(()=>C.deserialize(battle));
  while(!s.battle.result) {const copy=clone(s.battle),actor=copy.units.find(u=>u.id===copy.actor);B.plan(copy,actor);const {kind,target}=actor.intent;assert.equal(C.act(s,kind,target),true);}
  C.finishBattle(s);assert.equal(s.phase,'camp');const camp=JSON.parse(C.serialize(s));delete camp.state.journey.party[0].name;assert.throws(()=>C.deserialize(camp));
  const injected=JSON.parse(C.serialize(require('./test-current-fixture.cjs')()));injected.state.characters.guard.name=null;assert.throws(()=>C.deserialize(injected));
});
test('journey deadlines and rewards have safe types and match accepted quest',()=>{
  for(const quest of [false,true]){const s=require('./test-current-fixture.cjs')();if(quest)acceptWithPorter(s,C.board(s)[0].id);C.depart(s,quest?'east':'north');const good=JSON.parse(C.serialize(s));
    for(const [key,value] of [['deadline','oops'],['deadline',null],['reward',{}],['name',null],['deadline',99],['reward',9999]]){const bad=clone(good);bad.state.journey.job[key]=value;assert.throws(()=>C.deserialize(bad));}
  }
});
test('inert trial dummies show no threats and never damage party',()=>{
  const s=town('east'),before=C.serialize(s),t=C.trial(s,'mage','hammer-wood');assert.ok(t);
  const allies=t.battle.units.filter(u=>u.side==='ally').map(u=>({id:u.id,hp:u.hp}));
  for(const u of t.battle.units.filter(u=>u.side==='enemy'))assert.deepEqual(u.intent,{kind:'guard',target:null,name:'静止',reason:'木人は行動しません',cells:[]});
  for(let i=0;i<12;i++){assert.equal(C.trialAct(t,'guard',null),true);assert.equal(t.battle.actor,t.characterId);}
  assert.deepEqual(t.battle.units.filter(u=>u.side==='ally').map(u=>({id:u.id,hp:u.hp})),allies);
  assert.ok(t.battle.units.filter(u=>u.side==='enemy').every(u=>u.intent.cells.length===0));assert.equal(C.serialize(s),before);
});
test('retreat rejects nonbattle/finished/stale battles without mutation',()=>{
  const s=require('./test-current-fixture.cjs')();
  const reject=()=>{const before=clone(s);assert.equal(C.retreat(s),false);assert.deepEqual(clone(s),before);};
  reject();C.depart(s,'north');reject();C.travel(s,'safe',random());reject();C.begin(s);
  const stage=s.battle.campaignStage;s.battle.campaignStage++;reject();s.battle.campaignStage=stage;
  s.battle.result='already finished';reject();
});
test('normal and questless retreats restore pretrip state and cannot double apply',()=>{
  for(const quest of [false,true]){
    const s=require('./test-current-fixture.cjs')(),before=clone(s);
    if(quest)assert(acceptWithPorter(s,C.board(s)[0].id));
    assert(C.depart(s,quest?'east':'north'));assert(C.travel(s,'safe',random()));fight(s);
    assert.equal(s.gold,before.gold+8);assert.equal(s.characters.guard.xp,before.characters.guard.xp+20);assert.equal(s.xp,before.xp);
    assert(C.onward(s));assert(C.travel(s,'safe',random()));assert(C.begin(s));
    assert(C.retreat(s));assert.equal(s.result.outcome,'failed');assert.equal(s.result.restored,true);
    assert.equal(s.result.gold,0);assert.equal(s.result.xp,0);okay(s);
    const finished=clone(s);assert.equal(C.retreat(s),false);assert.equal(C.finishBattle(s),false);assert.deepEqual(s,finished);
    assert(C.acknowledge(s));
    for(const key of Object.keys(before).filter(k=>!['history','worldTime','standaloneEvents'].includes(k)))assert.deepEqual(s[key],before[key],key);
    assert(s.worldTime>before.worldTime,'world calendar advances through retreat');
    okay(s);
  }
});
test('R04 retained legacy porter-only stalemate keeps C01 and can retreat after save reload',()=>{
  const fixture=JSON.parse(require('node:fs').readFileSync(require.resolve('./test_fixtures/campaign-f736137-stalemate.json'),'utf8'));
  const migrated=C.deserialize(fixture);assert.equal(migrated.phase,'town');assert.equal(migrated.battle,null);
  let s=require('./test-stalemate-fixture.cjs')();const before=clone(s.rollback);
  assert.equal(s.battle.actions,52);assert.equal(s.battle.result,null);
  assert.deepEqual(s.battle.units.filter(u=>u.side==='ally'&&u.hp>0).map(u=>u.job),['porter']);
  for(let n=0;n<20;n++)assert(C.act(s,'guard',null));
  assert.equal(s.battle.result,null);okay(s);s=C.deserialize(C.serialize(s));
  for(const enemy of s.battle.units.filter(u=>u.side==='enemy'))assert.equal(B.legal(s.battle,'attack',enemy.id),false);
  assert(C.retreat(s));assert(C.acknowledge(s));
  for(const key of Object.keys(before).filter(k=>!['history','worldTime','standaloneEvents'].includes(k)))assert.deepEqual(s[key],before[key],key);
  assert(s.worldTime>before.worldTime,'world calendar advances through legacy retreat');
  okay(s);
});

function assertLocalTown(s,id){
  assert.equal(s.phase,'town');assert.equal(s.location,id);
  const v=C.view(s);assert.equal(v.town,id);assert.equal(v.location,id);
  assert.equal(v.guildAvailable,id==='astaris');assert.equal(v.inn.available,id==='astaris');
  assert.ok(v.board.length);assert.ok(v.board.every(q=>q.from===id));
  assert.deepEqual(v.destinations.map(p=>p.id),{astaris:['east','west','south','north'],east:['north','astaris','south'],west:['north','astaris','south'],north:['east','astaris','west'],south:['east','astaris','west']}[id]);
  const categories={astaris:[],east:['weapon','leftHand'],west:['head','armor','lowerBody','feet'],south:['hp','mp'],north:['accessory1','accessory2']};
  assert.deepEqual([...new Set(v.shop.map(g=>g.slot||g.resource))],categories[id]);
  okay(s);
}
test('all village arrivals survive result reload and acknowledgement with local facilities',()=>{
  for(const [index,id] of ['east','west','south','north'].entries())for(const rest of [false,true]){
    let s=require('./test-current-fixture.cjs')();s.boardRound=index;trip(s,id,{rest});
    assert.equal(s.result.outcome,rest?'late':'success');assert.equal(s.location,id);assert.equal(s.result.location,id);
    s=C.deserialize(C.serialize(s));assert.equal(s.location,id);assert.equal(s.result.location,id);
    assert(C.acknowledge(s));assertLocalTown(s,id);
    const settled=C.serialize(s);assert.equal(C.acknowledge(s),false);assert.equal(C.serialize(s),settled);
    assertLocalTown(C.deserialize(settled),id);
  }
});
test('each village return reaches city, and questless arrivals retain exact village',()=>{
  for(const id of ['east','west','south','north']){
    let s=town(id);trip(s,'astaris',{rest:false});assert.equal(s.result.location,'astaris');
    s=C.deserialize(C.serialize(s));assert(C.acknowledge(s));assertLocalTown(s,'astaris');
    s=require('./test-current-fixture.cjs')();trip(s,id,{quest:false,route:'safe'});assert.equal(s.result.outcome,'travel');
    s=C.deserialize(C.serialize(s));assert(C.acknowledge(s));assertLocalTown(s,id);
  }
});
test('village-origin failure and result reload restore origin, not attempted city',()=>{
  for(const quest of [true,false])for(const id of ['east','west','south','north']){
    let s=town(id);s.selected=['porter'];s.characters.porter.hp=1;const before=clone(s);
    if(quest)assert(acceptWithPorter(s,C.board(s).find(q=>q.to==='astaris').id));
    assert(C.depart(s,'astaris'));assert(C.travel(s,'short',random()));fight(s,true);
    assert.equal(s.result.outcome,'failed');assert.equal(s.location,id);
    s=C.deserialize(C.serialize(s));assert(C.acknowledge(s));assertLocalTown(s,id);
    for(const key of Object.keys(before).filter(k=>!['history','worldTime','standaloneEvents'].includes(k)))assert.deepEqual(s[key],before[key],key);
    assert(s.worldTime>before.worldTime,'world calendar advances through village-origin failure');
  }
});
test('inn charges once for selected party, revives KO and honors equipment/growth maxima',()=>{
  let s=require('./test-current-fixture.cjs')();s.gold=30;
  for(const id of s.selected){
    const c=s.characters[id];c.xp=200;c.level=3;c.statPoints=0;c.skillPoints=2;
    c.allocations={str:2,int:2,agi:0};c.hp=1;c.mp=0;
  }
  s.characters.guard.armor='armor-leather-1';s.characters.mage.weapon='staff-silver-1';
  s.characters.archer.hp=0;s.characters.warrior.hp=0;s.characters.warrior.mp=0;
  okay(s);const before=clone(s),maxima=Object.fromEntries(s.selected.map(id=>[id,C.stats(s.characters[id])]));
  assert.deepEqual(C.view(s).inn,{price:30,available:true,needsRecovery:true,affordable:true});
  assert(C.inn(s));assert.equal(s.gold,0);
  for(const [id,c] of Object.entries(s.characters)){
    if(s.selected.includes(id))assert.deepEqual(c,{...before.characters[id],hp:maxima[id].max,mp:maxima[id].maxMp});
    else assert.deepEqual(c,before.characters[id],`reserve ${id}`);
  }
  for(const key of Object.keys(before).filter(k=>!['gold','characters','history'].includes(k)))assert.deepEqual(s[key],before[key],key);
  assert.equal(C.view(s).inn.needsRecovery,false);okay(s);s=C.deserialize(C.serialize(s));
  const recovered=clone(s);assert.equal(C.inn(s),false);assert.deepEqual(s,recovered);
});
test('inn detects HP-only, MP-only and KO recovery; healthy party/reserve-only rejects atomically',()=>{
  for(const [id,resource,value] of [['guard','hp',1],['mage','mp',0],['porter','hp',0]]){
    const s=require('./test-current-fixture.cjs')();s.characters[id][resource]=value;assert(C.view(s).inn.needsRecovery);
    assert(C.inn(s));assert.equal(s.gold,150);okay(s);
  }
  const s=require('./test-current-fixture.cjs')();s.characters.warrior.hp=0;const before=clone(s);
  assert.equal(C.view(s).inn.needsRecovery,false);assert.equal(C.inn(s),false);assert.deepEqual(s,before);
});
test('inn insufficient funds and all village locations reject without mutation',()=>{
  for(const id of C.locations.map(p=>p.id))for(const gold of [0,29,30,180]){
    const s=town(id);s.gold=gold;s.characters.mage.mp=0;
    if(id==='astaris'&&gold>=30)continue;
    assert.equal(C.view(s).inn.affordable,gold>=30);assert.equal(C.view(s).inn.available,id==='astaris');
    const before=clone(s);assert.equal(C.inn(s),false);assert.deepEqual(s,before);okay(s);
  }
});
test('inn rejects every active journey and result phase without mutation',()=>{
  const s=require('./test-current-fixture.cjs')();const reject=()=>{
    const before=clone(s);assert.equal(C.view(s).inn.available,false);assert.equal(C.inn(s),false);assert.deepEqual(clone(s),before);okay(s);
  };
  assert(C.depart(s,'east'));reject();assert(C.travel(s,'safe',random()));reject();
  assert(C.begin(s));reject();assert(C.retreat(s));reject();assert(C.acknowledge(s));
  assert(C.depart(s,'east'));
  for(let leg=0;leg<2;leg++){
    assert(C.travel(s,'safe',random()));fight(s);reject();
    if(!leg){assert(C.rest(s));assert(C.onward(s));reject();}
  }
  assert.equal(s.phase,'arrival');assert(C.arrive(s));reject();
});
test('accepted quest inn cost and recovery roll back exactly on expedition failure',()=>{
  let s=require('./test-current-fixture.cjs')();assert(C.select(s,['porter']));s.characters.porter.hp=1;s.characters.porter.mp=0;
  const before=clone(s);assert(acceptWithPorter(s,C.board(s)[0].id));const accepted=clone(s);
  assert(C.inn(s));assert.equal(s.gold,before.gold-30);assert.equal(s.characters.porter.hp,C.stats(s.characters.porter).max);
  assert.deepEqual(s.rollback,accepted.rollback);assert.deepEqual(s.activeQuest,accepted.activeQuest);okay(s);
  s=C.deserialize(C.serialize(s));assert(C.depart(s,'east'));assert(C.travel(s,'short',random()));fight(s,true);
  assert.equal(s.result.outcome,'failed');assert(C.acknowledge(s));
  for(const key of Object.keys(before).filter(k=>!['history','worldTime','standaloneEvents'].includes(k)))assert.deepEqual(s[key],before[key],key);
  assert(s.worldTime>before.worldTime,'world calendar advances while accepted-quest rollback restores gameplay state');okay(s);
});
console.log(`\n${passed} campaign checks passed (actual Battle actions; no GUI or final-balance claim).`);
