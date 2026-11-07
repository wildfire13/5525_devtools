'use strict';
const assert = require('node:assert/strict');
const E = require('../engine.cjs');
const C = require('../vendor/5525/native/campaign.js');
const B = require('../vendor/5525/native/campaign-battle.js');
const clone = value => JSON.parse(JSON.stringify(value));
const saved = s => JSON.parse(C.serialize(s));
const run = (s, options={}) => E.run({cmd:'timeline',save:saved(s),options});
const porter = s => C.view(s).roster.find(r => r.job === 'porter' && s.selected.includes(r.id)).id;
let passed=0;
function test(name, fn) { fn(); console.log('PASS '+name); passed++; }
function accepted(eventId, age=0, location, epoch=0) {
  const s=C.create();s.location={wheel:'east',turnip:'north',kiln:'astaris'}[eventId];
  s.worldTime=epoch;s.standaloneEvents.epoch=epoch;
  assert(C.accept(s,'standalone-'+eventId,porter(s)));
  s.worldTime=epoch+age;s.hours=age;s.activeQuest.elapsedHours=age;
  if(location)s.location=location;
  return C.deserialize(C.serialize(s));
}
test('input remains byte-identical and report contains no importable save or portraits',()=>{
  const input=E.run({cmd:'new'}), before=JSON.stringify(input);
  const report=E.run({cmd:'timeline',save:input,options:{questId:'standalone-kiln',advanceHours:3,destination:'east'}});
  assert.equal(JSON.stringify(input),before);assert.equal(report.copyOnly,true);
  assert.equal(report.sourceSha,E.sourceSha);assert.equal(report.clock.worldTime,3);
  assert.equal(report.state.phase,'road');assert.equal(report.forecasts.length,2);
  assert(!('save' in report));assert(!('characters' in report.state));assert(!('nativePortraits' in report));
});
test('wheel boundaries match direct completeQuest at 9/10/17/18/23/24/25/35/36/37',()=>{
  for(const age of [9,10,17,18,23,24,25,35,36,37])for(const location of ['astaris','south']){
    const s=accepted('wheel',age,location),r=run(s),direct=clone(s),did=C.completeQuest(direct);
    assert.equal(r.delivery.actionAccepted,did,`${age} ${location}`);
    if(did)assert.deepEqual(r.delivery.result,direct.result);
    const available=age>=10&&age<18&&location==='astaris'||age>=18&&age<=36&&location==='south';
    assert.equal(r.delivery.available,available,`${age} ${location}`);
    if(available)assert.equal(r.delivery.result.gold,age<=24?220:110);
  }
});
test('candidate 24 and 36 stages agree with inclusive settlement',()=>{
  for(const [age,stage,gold] of [[24,'south_full',220],[36,'south_late',110]]){
    const r=run(accepted('wheel',age,'south'));
    assert.equal(r.state.scenarioStages.wheel,stage);assert.equal(r.delivery.result.gold,gold);assert(!r.warnings.some(w=>w.includes('境界差')));
  }
});
test('turnip18 and kiln20 are inclusive, one hour later fails',()=>{
  for(const [id,deadline,location,gold] of [['turnip',18,'astaris',240],['kiln',20,'east',150]])for(const age of [deadline-1,deadline,deadline+1]){
    const r=run(accepted(id,age,location)), direct=accepted(id,age,location);assert(C.completeQuest(direct));
    assert.deepEqual(r.delivery.result,direct.result);
    assert.equal(r.delivery.available,age<=deadline);assert.equal(r.delivery.result.gold,age<=deadline?gold:0);
  }
});
test('calendar epoch is separate from world and elapsed clocks',()=>{
  const r=run(accepted('wheel',24,'south',100));assert.equal(r.clock.worldTime,124);assert.equal(r.clock.calendarAge,24);assert.equal(r.clock.elapsedHours,24);assert.equal(r.delivery.result.gold,220);
});
test('merchant waiting and arrival probes do not change input',()=>{
  const s=accepted('wheel',6,'astaris'),before=JSON.stringify(s),r=run(s);
  assert.equal(r.delivery.available,false);assert.equal(r.waitForMerchant.hours,4);assert.equal(r.waitForMerchant.delivery.result.gold,220);assert.equal(JSON.stringify(s),before);
});
test('normal and experience rewards use settlement, not the generic forecast amount as G',()=>{
  const s=C.create();let r=run(s,{questId:C.board(s)[0].id,destination:'east'});
  assert.equal(r.forecasts[0].additionalHours,6);assert.equal(r.forecasts[0].delivery.result.gold,180);assert.equal(r.forecasts[1].delivery.result.gold,117);assert.equal(r.forecasts[1].delivery.result.rp,60);
  r=run(s,{questId:C.board(s)[1].id,destination:'west'});assert.equal(r.forecasts[0].officialForecast.reward,150);assert.equal(r.forecasts[0].delivery.result.gold,0);assert.equal(r.forecasts[0].delivery.result.xp,150);
});
test('wrong destination cannot claim a payable reward even when official forecast is positive',()=>{
  const r=run(C.create(),{questId:'standalone-kiln',destination:'north'});
  assert.equal(r.forecasts[0].officialForecast.reward,0);assert.equal(r.forecasts[0].delivery.available,false);assert.equal(r.forecasts[0].delivery.result,null);
});
test('forecast wheel handoff follows arrival stop and inclusive final hour',()=>{
  const s=accepted('wheel',18,'east');let r=run(s,{destination:'south'});
  assert.equal(r.forecasts[0].clock,undefined);assert.equal(r.forecasts[0].worldTime,24);assert.equal(r.forecasts[0].delivery.result.gold,220);
  r=run(s,{advanceHours:12,destination:'south'});assert.equal(r.forecasts[0].worldTime,36);assert.equal(r.forecasts[0].delivery.result.gold,110);assert.equal(r.forecasts[1].delivery.result.outcome,'failed');
});
test('missing active cargo carrier is not predicted as successful',()=>{
  const s=accepted('wheel',10,'astaris');assert(C.select(s,s.selected.filter(id=>id!==porter(s))));assert.equal(run(s).delivery.available,false);
});
test('existing quests only and strict options reject unsupported modifications',()=>{
  for(const options of [{advanceHours:-1},{advanceHours:1.5},{advanceHours:true},{advanceHours:100001},{advanceHours:'10'},{questId:'fictional'},{reward:999},{destination:'moon'},{carrierId:'none'}])assert.throws(()=>run(C.create(),options));
  assert.throws(()=>run(accepted('wheel'),{questId:'standalone-kiln'}));
  const s=C.create();s.characters[s.selected[0]].hp=-1;assert.throws(()=>E.run({cmd:'timeline',save:{version:2,state:s}}));
});
test('overflow blocks route predictions just as official travel does',()=>{
  const s=C.create();assert(C.depart(s,'east'));for(const g of C.gear.filter(g=>g.type!=='empty'&&!g.virtualDefault).slice(0,30))s.characters[s.selected[0]].inventory[g.id]=1;
  assert(C.validate(s).ok);assert.equal(C.travel(clone(s),'short',()=>0.5),false);const r=run(s);assert.equal(r.forecasts.length,0);assert(r.warnings.some(w=>w.includes('所持枠')));
});
test('questless routes yield no delivery, and time inspection is not an action replay',()=>{
  const s=C.create(),r=run(s,{advanceHours:5,destination:'east'});
  assert.equal(r.clock.worldTime,5);assert.equal(r.forecasts[0].worldTime,11);assert.equal(r.forecasts[0].delivery.available,false);assert.equal(r.forecasts[0].delivery.result,null);
});
// Build camp/arrival through actual official battle actions, no fake result flags.
function fight(s){
  assert(C.begin(s));
  for(let i=0;i<300&&!s.battle.result;i++){
    const b=clone(s.battle),actor=b.units.find(u=>u.id===b.actor);B.plan(b,actor);let {kind,target}=actor.intent;
    const hurt=b.units.filter(u=>u.side==='ally'&&u.hp>0&&u.hp<u.max*.5).sort((a,b)=>a.hp/a.max-b.hp/b.max).find(u=>B.legal(b,'item',u.id));
    if(hurt){kind='item';target=hurt.id;}else if(actor.job==='porter'){kind=B.legal(b,'skill',actor.id)?'skill':'guard';target=kind==='skill'?actor.id:null;}
    assert(C.act(s,kind,target));
  }
  assert(s.battle.result);assert(C.finishBattle(s));assert.notEqual(s.result?.outcome,'failed');
}
test('camp rest/return are gated by legal phase and current state, arrival is separate',()=>{
  const s=require('../vendor/5525/native/test-current-fixture.cjs')();assert(C.accept(s,C.board(s)[0].id,porter(s)));assert(C.depart(s,'east'));
  let seed=2;const rng=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
  assert(C.travel(s,'short',rng));assert.equal(run(s).forecasts.length,0);fight(s);assert.equal(s.phase,'camp');
  let r=run(s);assert.deepEqual(r.forecasts.map(f=>f.choice),['short','safe','rest','turnBack']);
  assert.equal(r.forecasts.find(f=>f.choice==='rest').additionalHours,5);assert.equal(r.forecasts.find(f=>f.choice==='turnBack').delivery.available,false);
  assert(C.rest(s));r=run(s);assert(!r.forecasts.some(f=>f.choice==='rest'));
  assert(C.onward(s));assert(C.travel(s,'short',rng));fight(s);assert.equal(s.phase,'arrival');
  r=run(s);assert.equal(r.forecasts.length,0);assert.equal(r.delivery.available,false);assert.equal(r.afterArrival.delivery.available,true);
});
test('kiln20 closed stage has an observed success discrepancy, not a generic warning',()=>{
  const r=run(accepted('kiln',20,'east'));
  assert.equal(r.state.scenarioStages.kiln,'closed');
  assert.equal(r.delivery.result.gold,150);
  assert.equal(r.discrepancies[0].code,'kiln_closed_but_success');
  assert.equal(r.discrepancies[0].settlement.outcome,'success');
  assert(r.warnings.some(w=>w.includes('境界差')));
  for(const age of [24,36]) {
    const other=run(accepted('kiln',age,'east'));
    assert.deepEqual(other.discrepancies,[]);
    assert(!other.warnings.some(w=>w.includes('行商人')||w.includes('車輪')));
  }
  assert.deepEqual(run(accepted('kiln',20,'astaris')).discrepancies,[]);
  assert.deepEqual(run(accepted('wheel',24,'east')).discrepancies,[]);
});
test('arrival forecasts include observed boundary discrepancies and schedule is precise',()=>{
  const r=run(accepted('kiln',14,'astaris'),{destination:'east'});
  assert.equal(r.forecasts[0].discrepancies[0].code,'kiln_closed_but_success');
  for(const [age,stage] of [[21,'fired'],[22,'cooling'],[23,'returned']]){
    const report=run(accepted('kiln',age,'east'));
    assert.equal(report.state.scenarioStages.kiln,stage);
    assert(report.calendar.schedule.find(row=>row.at===age).detail.includes(stage));
  }
  assert(r.calendar.schedule.find(row=>row.at===23).detail.includes('依頼完了済み'));
  assert(r.calendar.schedule.find(row=>row.at===23).detail.includes('現在地イース'));
});

test('forecast stages belong to actual arrival ages 20, 24 and 36, not departure',()=>{
  for(const [eventId,start,destination,age,stage] of [
    ['kiln',14,'east',20,'closed'],
    ['wheel',18,'south',24,'south_full'],
    ['wheel',30,'south',36,'south_late']
  ]){
    const report=run(accepted(eventId,start,eventId==='kiln'?'astaris':'east'),{destination});
    const forecast=report.forecasts.find(row=>row.choice==='short');
    assert.equal(forecast.calendarAge,age);
    assert.equal(forecast.scenarioStages[eventId],stage);
    if(eventId==='kiln')assert.notEqual(forecast.scenarioStages[eventId],report.state.scenarioStages[eventId]);
    else assert.equal(forecast.scenarioStages[eventId],report.state.scenarioStages[eventId]); // Candidate inclusive windows intentionally retain the same stage at 24/36.
    if(eventId==='kiln')assert.equal(forecast.discrepancies[0].stage,forecast.scenarioStages[eventId]);
    else assert.deepEqual(forecast.discrepancies,[]);
  }
});

console.log(`\n${passed} quest timeline groups passed (synthetic saves only).`);
