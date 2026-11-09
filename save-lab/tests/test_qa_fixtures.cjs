'use strict';
const {gameModule} = require('../game-source.cjs');
const assert=require('node:assert/strict');
const E=require('../engine.cjs');
const C=gameModule('campaign.js');
let passed=0;function test(name,fn){fn();console.log('PASS '+name);passed++;}
const bundle=E.run({cmd:'qa-fixtures'});
test('22 deterministic presets use official validator and exact roundtrip',()=>{
 assert.equal(bundle.cases.length,22);assert.equal(bundle.synthetic,true);assert.equal(bundle.testOnly,true);assert.equal(bundle.sourceSha,E.sourceSha);
 assert.deepEqual(bundle,E.run({cmd:'qa-fixtures'}));
 for(const c of bundle.cases){const s=C.deserialize(c.save);assert(C.validate(s).ok,c.case.id);assert.equal(C.serialize(C.deserialize(C.serialize(s))),C.serialize(s));assert.deepEqual(Object.keys(c.save).sort(),['cargoRevision','format','state','version']);assert.equal(c.report.validation.gameUi,'not_run');assert.equal(c.report.timeline.clock.calendarAge,c.case.age);}
});
test('accepted preset settlements match inclusive deadlines and official direct action',()=>{
 for(const c of bundle.cases.filter(x=>x.case.mode==='accepted')){
  const s=C.deserialize(c.save),q=s.activeQuest;assert(q);assert(s.rollback);assert.equal(q.elapsedHours,c.case.age);assert.equal(s.rollback.location,c.case.origin);assert.equal(s.rollback.worldTime,0);
  const did=C.completeQuest(s),shown=c.report.timeline.delivery;assert.equal(shown.actionAccepted,did);
  if(did){assert.deepEqual(shown.result,s.result);assert(C.validate(s).ok);assert.equal(C.completeQuest(s),false);}
 }
 for(const [id,gold] of [['turnip-accepted-18h',240],['turnip-accepted-19h',0],['kiln-accepted-20h',150],['kiln-accepted-21h',0],['wheel-accepted-24h',220],['wheel-accepted-36h',110],['wheel-accepted-37h',0]])assert.equal(bundle.cases.find(c=>c.case.id===id).report.timeline.delivery.result.gold,gold);
});
test('offered presets stay unaccepted and kiln aftermath uses real settlement',()=>{
 for(const c of bundle.cases.filter(x=>x.case.mode==='offered')){const s=C.deserialize(c.save);assert.equal(s.activeQuest,null);assert.equal(s.rollback,null);assert(C.board(s).some(q=>q.id==='standalone-'+c.case.eventId));}
 const c=bundle.cases.find(c=>c.case.id==='kiln-completed-23h'),s=C.deserialize(c.save);assert.equal(s.phase,'town');assert.equal(s.standaloneEvents.events.kiln.status,'completed');assert.equal(s.activeQuest,null);assert(c.report.aftermath.some(x=>x.id==='kiln-return'));assert.equal(C.completeQuest(s),false);
});
test('no imported save or arbitrary reward/time/location accepted',()=>{
 const input=E.run({cmd:'new'}),before=JSON.stringify(input);
 for(const request of [{cmd:'qa-fixtures',save:input},{cmd:'qa-fixtures',options:{age:20}},{cmd:'qa-fixtures',options:{caseIds:[]}},{cmd:'qa-fixtures',options:{caseIds:['missing']}},{cmd:'qa-fixtures',options:{caseIds:['kiln-accepted-20h','kiln-accepted-20h']}},{cmd:'qa-fixtures',options:null},{cmd:'qa-fixtures',options:{caseIds:'all'}}])assert.throws(()=>E.run(request));
 assert.equal(JSON.stringify(input),before);const one=E.run({cmd:'qa-fixtures',options:{caseIds:['kiln-accepted-20h']}});assert.equal(one.cases.length,1);assert(!JSON.stringify(one).includes('nativePortraits'));assert.deepEqual(E.run({cmd:'qa-catalog'}).cases.map(x=>x.id),bundle.cases.map(x=>x.case.id));
});
console.log(`\n${passed} synthetic QA groups passed.`);
