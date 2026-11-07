'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const C=require('../vendor/5525/native/campaign.js'),T=require('../quest-timeline.cjs'),E=require('../engine.cjs');
const G=process.env.EXACT_GAME_ROOT?require(path.join(process.env.EXACT_GAME_ROOT,'native/campaign.js')):C;
const towns=['astaris','east','west','south','north'],saved=s=>JSON.parse(C.serialize(s));
function at(s,age,place){s.worldTime=s.standaloneEvents.epoch+age;s.hours=s.worldTime;s.location=place;C.view(s);return s;}
function accepted(event='wheel',epoch=0){const s=C.create();s.location={wheel:'east',kiln:'astaris',turnip:'north'}[event];s.worldTime=epoch;s.hours=epoch;s.standaloneEvents.epoch=epoch;assert(C.accept(s,'standalone-'+event,C.view(s).roster.find(r=>r.job==='porter'&&s.selected.includes(r.id)).id));return s;}
const counts={allTownFailure:0,deliveryBoundary:0,aftermath:0,kiln:0,arrivalForecast:0};
for(const epoch of [0,42])for(const place of towns)for(const missing of [false,true])for(const legacy of [false,true]){
 const s=at(accepted('wheel',epoch),37,place);if(missing)s.selected=s.selected.filter(id=>id!==s.activeQuest.cargoOwnerId);if(legacy)delete s.activeQuest.rewardRevision;
 const raw=saved(s),before=JSON.stringify(raw),r=T.timeline(raw),direct=G.deserialize(raw),snap=structuredClone(direct.rollback),m=G.recipientMeeting(direct);
 assert(m.canSettleFailure);assert(!m.canDeliver);assert(r.delivery.actionAccepted);assert(!r.delivery.available);assert.match(r.delivery.reason,/失敗.*世界時刻/);
 assert(G.completeQuest(direct,m.failureExpected));assert.deepEqual(r.delivery.result,direct.result);for(const key of ['gold','hours','characters','selected','location','completed','partyRP'])assert.deepEqual(direct[key],snap[key]);assert.equal(direct.worldTime,epoch+37);assert.equal(direct.standaloneEvents.epoch,epoch);assert.equal(direct.result.gold,0);assert.equal(direct.result.xp,0);assert.equal(direct.result.rp||0,0);assert.equal(direct.activeQuest,null);
 const once=G.serialize(direct);assert.equal(G.completeQuest(direct,m.failureExpected),false);assert.equal(G.serialize(direct),once);assert.equal(JSON.stringify(raw),before);counts.allTownFailure++;
}
for(const epoch of [0,42])for(const age of [24,25,36])for(const place of towns)for(const missing of [false,true]){
 const s=at(accepted('wheel',epoch),age,place);if(missing)s.selected=s.selected.filter(id=>id!==s.activeQuest.cargoOwnerId);const raw=saved(s),r=T.timeline(raw),g=G.deserialize(raw),ok=G.completeQuest(g);assert.equal(r.delivery.actionAccepted,ok);assert.equal(r.delivery.available,place==='south'&&!missing);if(ok){assert.deepEqual(r.delivery.result,g.result);assert.equal(g.result.gold,age===24?220:110);}counts.deliveryBoundary++;
}
for(const epoch of [0,42])for(const age of [24,25,36,37,48])for(const place of towns){
 const s=C.create();s.worldTime=epoch;s.hours=epoch;s.standaloneEvents.epoch=epoch;at(s,age,place);if(age>24)s.standaloneEvents.events.wheel.status='missed';const raw=saved(s),before=JSON.stringify(raw),r=T.timeline(raw),g=G.deserialize(raw);assert.deepEqual(r.aftermath,G.scenarioAftermath(g));assert.equal(r.aftermath.some(x=>x.id==='wheel-aftermath'),age>36&&place==='south');assert.equal(r.delivery.actionAccepted,false);assert.equal(JSON.stringify(raw),before);assert.equal(g.activeQuest,null);assert.equal(g.result,null);counts.aftermath++;
}
for(const epoch of [0,42]){
 const s=at(accepted('kiln',epoch),20,'east');assert(C.completeQuest(s));assert(C.acknowledge(s));
 for(const age of [22,23])for(const place of towns){at(s,age,place);const r=T.timeline(saved(s)),story=r.aftermath.find(x=>x.id==='kiln-return');assert.equal(!!story,age===23&&place==='east');if(story){assert.match(story.story[0][1],/若い陶工.*イース.*訪ね/);assert.equal(story.story.at(-1)[1],'……次のを売るよ。');}counts.kiln++;}
}
for(const destination of towns){
 const s=at(accepted(),31,destination==='astaris'?'east':'astaris'),raw=saved(s),before=JSON.stringify(raw),r=T.timeline(raw,{destination}),direct=G.deserialize(raw);assert(G.depart(direct,destination));const f=r.forecasts.find(x=>x.choice==='short');assert.equal(f.calendarAge,37);assert.equal(f.delivery.available,false);assert.equal(f.delivery.actionAccepted,true);assert.equal(f.delivery.result.outcome,'failed');assert.equal(f.delivery.result.gold,0);assert.equal(f.officialForecast.willFail,true);assert.equal(f.officialForecast.handoffAvailable,false);assert.deepEqual(f.officialForecast,G.forecast(direct,'short'));assert.equal(JSON.stringify(raw),before);counts.arrivalForecast++;
}
// Boundary mode must show conditional aftermath changes, not confuse world stage with the event.
{const s=C.create();s.location='south';const raw=saved(s),r=T.boundaryComparison(raw);for(const age of [25,36,37]){const row=r.rows.find(x=>x.eventId==='wheel'&&x.age===age);assert.equal(row.aftermath.some(x=>x.id==='wheel-aftermath'),age===37);}assert(r.rows.find(x=>x.eventId==='wheel'&&x.age===37).changes.some(x=>x.field==='aftermath'));}
// Fixed-delivery contracts retain their destination restriction.
for(const [id,age,place] of [['turnip',19,'south'],['kiln',21,'north']]){const s=at(accepted(id),age,place);assert.equal(T.timeline(saved(s)).delivery.actionAccepted,false);}
const summary={pass:true,sourceSha:E.sourceSha,counts,total:Object.values(counts).reduce((a,b)=>a+b,0),extraGroups:['boundary conditional aftermath','fixed recipient restrictions'],exactExternalGameComparison:!!process.env.EXACT_GAME_ROOT};if(process.env.DECISIONS_REPORT_PATH)fs.writeFileSync(process.env.DECISIONS_REPORT_PATH,JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary));
