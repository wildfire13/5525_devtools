'use strict';
const assert=require('node:assert/strict');
const C=require('../vendor/5525/native/campaign.js');
const T=require('../quest-timeline.cjs');
const manifest=require('../vendor/source-manifest.json');
const clone=value=>JSON.parse(JSON.stringify(value));
const saved=s=>JSON.parse(C.serialize(s));
const porter=s=>C.view(s).roster.find(r=>r.job==='porter'&&s.selected.includes(r.id)).id;
const ages={turnip:[17,18,19],kiln:[19,20,21,22,23,24],wheel:[9,10,11,17,18,19,23,24,25,35,36,37]};
function accepted(eventId,age=0,location,epoch=0){
  const s=C.create();s.location={turnip:'north',kiln:'astaris',wheel:'east'}[eventId];
  s.worldTime=epoch;s.standaloneEvents.epoch=epoch;
  assert(C.accept(s,'standalone-'+eventId,porter(s)));
  s.worldTime=epoch+age;s.hours=age;s.activeQuest.elapsedHours=age;
  if(location)s.location=location;
  return saved(s);
}
let passed=0;
function test(name,fn){fn();console.log('PASS '+name);passed++;}
test('all fixed boundaries independently match official settlement at the retained location',()=>{
  for(const eventId of Object.keys(ages))for(const location of ['astaris','east','south']){
    const input=accepted(eventId,0,location),r=T.boundaryComparison(input);
    assert.equal(r.rows.length,ages[eventId].length);
    assert.equal(r.sourceSha,manifest.sourceSha);
    for(const row of r.rows){
      assert.equal(row.status,'run');
      assert.equal(row.worldTime,row.age);
      assert.equal(row.state.location,location);
      assert.equal(row.activeEventId,eventId);
      const s=C.deserialize(input);s.worldTime=row.age;s.hours=row.age;s.activeQuest.elapsedHours=row.age;C.view(s);
      assert.equal(row.stage,C.view(s).scenarioStages[row.eventId]);
      const did=C.completeQuest(s);
      assert.equal(row.delivery.actionAccepted,did);
      if(did)assert.deepEqual(row.delivery.result,s.result);
    }
    assert.deepEqual(r.rows.filter(row=>row.eventId===eventId).map(row=>row.age),ages[eventId]);
  }
});
test('immutable repeatable report strips frontend metadata and cannot import as a save',()=>{
  const input=accepted('kiln',0,'east');
  input.godotCampaignId='abcdef0123456789abcdef0123456789';
  input.godotFrontend={version:1,journey_key:'PRIVATE_METADATA_SENTINEL'};
  const before=JSON.stringify(input),a=T.boundaryComparison(input),b=T.boundaryComparison(input);
  assert.equal(JSON.stringify(input),before);assert.deepEqual(a,b);
  const raw=JSON.stringify(a);
  for(const key of ['PRIVATE_METADATA_SENTINEL','godotCampaignId','godotFrontend','nativePortraits','"characters"','"rollback"'])assert(!raw.includes(key),key);
  assert(!('save' in a));assert.throws(()=>C.deserialize(a));
  const twenty=a.rows.find(row=>row.eventId==='kiln'&&row.age===20);
  const nineteen=a.rows.find(row=>row.eventId==='kiln'&&row.age===19);
  assert.equal(nineteen.delivery.result.outcome,'success');
  assert.equal(twenty.delivery.result.outcome,'success'); // Never consumes prior row's cargo.
  assert.equal(twenty.discrepancies[0].code,'kiln_closed_but_success');
});
test('past rows explicitly skip, epoch and baseline advance are never rewound',()=>{
  const r=T.boundaryComparison(accepted('wheel',18,'south',100),{advanceHours:6});
  assert.equal(r.baseline.clock.calendarAge,24);
  for(const row of r.rows){
    assert.equal(row.worldTime,100+row.age);
    if(row.age<24){assert.equal(row.status,'not_run');assert.equal(row.delivery,null);assert.equal(row.stage,null);assert.deepEqual(row.changes,[]);}
    else assert.equal(row.status,'run');
  }
  const at=r.rows.find(row=>row.eventId==='wheel'&&row.age===24);
  assert.deepEqual(at.changes,[]);
  const after=r.rows.find(row=>row.eventId==='wheel'&&row.age===25);
  const change=after.changes.find(x=>x.field==='delivery');
  assert.equal(change.before.result.gold,220);assert.equal(change.after.result.gold,110);
});
test('quest selection and destination remain hypothetical official departures, never teleport',()=>{
  const input=saved(C.create());
  const opt={questId:'standalone-kiln',destination:'east',advanceHours:2};
  const r=T.boundaryComparison(input,opt);
  for(const row of r.rows){
    assert.equal(row.state.phase,'road');assert.equal(row.state.location,'astaris');
    assert.equal(row.state.journeyDestination,'east');assert.equal(row.delivery.available,false);
    assert.equal(row.forecasts[0].worldTime,row.age+6);
    assert.deepEqual(row.forecasts,T.timeline(input,{...opt,advanceHours:row.age}).forecasts);
  }
  const noQuest=T.boundaryComparison(input);
  assert(noQuest.rows.every(row=>row.activeEventId===null&&!row.delivery.available));
});
test('missing cargo carrier and wrong destination never produce false success warnings',()=>{
  const s=C.deserialize(accepted('wheel',0,'astaris'));
  assert(C.select(s,s.selected.filter(id=>id!==porter(s))));
  const r=T.boundaryComparison(saved(s));
  assert(r.rows.every(row=>!row.delivery.available&&row.discrepancies.length===0));
  const kiln=T.boundaryComparison(accepted('kiln',0,'astaris'));
  assert(kiln.rows.every(row=>!row.delivery.available&&row.discrepancies.length===0));
});
test('strict options and malformed saves reject without partial reports',()=>{
  for(const opt of [null,[],true,new Date(),Object.create({advanceHours:10}),{[Symbol('extra')]:1},{ages:[1]},{advanceHours:-1},{advanceHours:1.1},{advanceHours:'2'},{advanceHours:100001},{destination:'moon'},{questId:'imaginary'},{carrierId:'none'}])
    assert.throws(()=>T.boundaryComparison(saved(C.create()),opt));
  assert.throws(()=>T.boundaryComparison({}));
  const s=C.create();assert(C.accept(s,C.board(s)[0].id,porter(s)));
  assert.throws(()=>T.boundaryComparison(saved(s)),/単発3件/);
  assert.throws(()=>T.boundaryComparison(saved(C.create()),{questId:C.board(C.create())[0].id}),/単発3件/);
  assert.throws(()=>T.boundaryComparison(accepted('kiln'),{questId:'standalone-kiln'}));
});
console.log('\n'+passed+' boundary comparison groups passed (synthetic saves only).');
