#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const C=require(process.env.QUEST_DECISIONS_ENGINE||'./campaign.js');
const towns=['astaris','east','west','south','north'];
function at(s,age,town){s.worldTime=s.standaloneEvents.epoch+age;s.hours=s.worldTime;s.location=town;C.view(s);return s;}
function start(event='wheel',epoch=0){
  const s=C.create();s.hours=epoch;s.worldTime=epoch;s.standaloneEvents.epoch=epoch;s.location={wheel:'east',kiln:'astaris',turnip:'north'}[event];
  const q=C.board(s).find(q=>q.eventId===event),porter=C.view(s).roster.find(c=>s.selected.includes(c.id)&&c.job==='porter').id;
  assert(C.accept(s,q.id,porter));return s;
}
let settlements=0,boundaries=0;
// Every town can explicitly settle an expired wheel contract, even with its carrier in reserve.
for(const epoch of [0,42])for(const town of towns)for(const offparty of [false,true])for(const revision of [undefined,1]){
  let s=at(start('wheel',epoch),37,town);if(offparty)s.selected=s.selected.filter(id=>id!==s.activeQuest.cargoOwnerId);
  if(revision===undefined)delete s.activeQuest.rewardRevision;
  s=C.deserialize(C.serialize(s));const snapshot=structuredClone(s.rollback),before=C.serialize(s),m=C.view(s).activeQuest.meeting;
  assert.equal(m.canDeliver,false);assert.equal(m.canSettleFailure,true);assert.match(C.view(s).activeQuest.text,/どの町でも/);
  assert.equal(C.serialize(s),before,'reading the expired contract does not settle it');assert(s.activeQuest);
  for(const invalid of [{...m.failureExpected,questToken:999},{...m.failureExpected,location:'unknown'},{...m.failureExpected,worldTime:s.worldTime-1},{},true]){
    assert.equal(C.completeQuest(s,invalid),false);assert.equal(C.serialize(s),before,'stale or malformed confirmation is inert');
  }
  assert(C.completeQuest(s,m.failureExpected));assert.equal(s.result.outcome,'failed');assert.equal(s.result.gold,0);assert.equal(s.result.xp,0);assert.equal(s.result.rp||0,0);
  for(const key of ['gold','hours','characters','selected','location','completed','partyRP'])assert.deepEqual(s[key],snapshot[key],`${key} restored`);
  assert.equal(s.worldTime,epoch+37);assert.equal(s.standaloneEvents.epoch,epoch);assert.equal(s.standaloneEvents.events.wheel.status,'failed');
  assert.equal(s.activeQuest,null);assert.equal(C.validate(s).ok,true,C.validate(s).error);
  s=C.deserialize(C.serialize(s));const failed=C.serialize(s);assert.equal(C.completeQuest(s,m.failureExpected),false);assert.equal(C.serialize(s),failed);
  assert(C.acknowledge(s));assert.equal(C.completeQuest(s),false);at(s,37,'south');assert(!C.scenarioAftermath(s).some(x=>x.id==='wheel-aftermath'));settlements++;
}
// Inclusive successful/late delivery boundaries still require the recipient and cargo.
for(const epoch of [0,42])for(const age of [24,25,36])for(const town of towns)for(const offparty of [false,true]){
  const s=at(start('wheel',epoch),age,town);if(offparty)s.selected=s.selected.filter(id=>id!==s.activeQuest.cargoOwnerId);
  const m=C.recipientMeeting(s),before=C.serialize(s),allowed=town==='south'&&!offparty;
  assert.equal(m.canSettleFailure,false);assert.equal(m.canDeliver,allowed);assert.equal(C.completeQuest(s),allowed);
  if(allowed){assert.equal(s.result.gold,age===24?220:110);assert.equal(s.result.rp,age===24?100:60);}
  else assert.equal(C.serialize(s),before);boundaries++;
}
for(const phase of ['road','camp','deployment','battle','arrival','result']){
  const s=at(start(),37,'north');s.phase=phase;const before=JSON.stringify(s);assert.equal(C.recipientMeeting(s).canSettleFailure,false);assert.equal(C.completeQuest(s),false);assert.equal(JSON.stringify(s),before);
}
// Never extend the all-town settlement exception to fixed-recipient or repeatable contracts.
for(const [event,wrong,right,age] of [['turnip','south','astaris',19],['kiln','north','east',21]]){
  const s=at(start(event),age,wrong),before=C.serialize(s);assert.equal(C.completeQuest(s),false);assert.equal(C.serialize(s),before);s.location=right;assert(C.completeQuest(s));assert.equal(s.result.outcome,'failed');
}
// Preserve the original early cargo rejection, including unsynchronized in-memory clocks.
for(const event of ['turnip','kiln']){
  const s=start(event);s.selected=s.selected.filter(id=>id!==s.activeQuest.cargoOwnerId);
  s.worldTime=37;s.hours=37;const before=JSON.stringify(s);
  assert.equal(C.completeQuest(s),false);assert.equal(JSON.stringify(s),before,'rejected missing-cargo call does not synchronize other world events');
}
// All arrival towns forecast an expired wheel contract, but arrival itself is not settlement.
for(const destination of towns){
  const s=at(start(),31,destination==='astaris'?'east':'astaris');assert(C.depart(s,destination));const before=C.serialize(s),f=C.forecast(s,'short');
  assert.equal(f.hours,37);assert.equal(f.willFail,true);assert.equal(f.handoffAvailable,false);assert.equal(f.reward,0);assert.equal(C.serialize(s),before);
}
// Existing missed saves remain missed; their aftermath is a world event after departure, not the posting deadline.
for(const epoch of [0,42])for(const age of [24,25,36,37,48])for(const town of towns){
  const s=at(C.create(),age,town);s.standaloneEvents.epoch=epoch;s.worldTime=epoch+age;s.hours=s.worldTime;
  if(age>24)s.standaloneEvents.events.wheel.status='missed'; // shape already saved by previous releases
  const loaded=C.deserialize(C.serialize(s)),before=C.serialize(loaded),entries=C.scenarioAftermath(loaded);
  assert.equal(entries.some(x=>x.id==='wheel-aftermath'),age>36&&town==='south');assert.equal(C.serialize(loaded),before);
  assert.equal(loaded.activeQuest,null);assert.equal(loaded.result,null);assert.equal(loaded.gold,s.gold);
}
// Calendarless v2 saves seed at their saved world hour. Old clocks are not interpreted as event age.
{
  const old=C.create();old.hours=42;delete old.worldTime;delete old.standaloneEvents;
  let s=C.deserialize(JSON.stringify({format:'5525-native-campaign',version:2,cargoRevision:1,state:old}));assert.equal(s.standaloneEvents.epoch,42);
  at(s,36,'south');assert(!C.scenarioAftermath(s).some(x=>x.id==='wheel-aftermath'));
  s=C.deserialize(C.serialize(s));at(s,37,'south');assert(C.scenarioAftermath(s).some(x=>x.id==='wheel-aftermath'));
}
// The kiln's successful aftermath stays in East at 23h and explicitly explains the apprentice's visit.
for(const epoch of [0,42]){
  let s=at(start('kiln',epoch),20,'east');assert(C.completeQuest(s));assert(C.acknowledge(s));s=C.deserialize(C.serialize(s));
  for(const age of [22,23])for(const town of towns){
    at(s,age,town);const before=C.serialize(s),entry=C.scenarioAftermath(s).find(x=>x.id==='kiln-return');
    assert.equal(!!entry,age===23&&town==='east');if(entry){assert.equal(entry.portrait,'apprentice');assert.match(entry.story[0][1],/若い陶工.*イース.*訪ね/);assert.equal(entry.story.at(-1)[1],'……次のを売るよ。');}
    assert.equal(C.serialize(s),before);
  }
}
console.log(`Quest decisions: ${settlements} all-town settlements, ${boundaries} delivery boundaries, plus stale actions, aftermath, epoch, legacy saves and forecast groups passed`);
