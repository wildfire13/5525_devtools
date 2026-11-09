'use strict';
const {gameModule} = require('../game-source.cjs');
const assert=require('node:assert/strict'),path=require('node:path');
const C=gameModule('campaign.js'),T=require('../quest-timeline.cjs'),E=require('../engine.cjs');
const G=process.env.EXACT_GAME_ROOT?require(path.join(process.env.EXACT_GAME_ROOT,'native/campaign.js')):C;
const clone=x=>structuredClone(x),saved=s=>JSON.parse(C.serialize(s));
function accepted(age=0,place='east',epoch=0){const s=C.create();s.location='east';s.worldTime=epoch;s.standaloneEvents.epoch=epoch;assert(C.accept(s,'standalone-wheel',C.view(s).roster.find(r=>r.job==='porter'&&s.selected.includes(r.id)).id));s.worldTime=epoch+age;s.hours=age;s.activeQuest.elapsedHours=age;s.location=place;return C.deserialize(C.serialize(s));}
function checkDelivery(result,s){const d=G.deserialize(C.serialize(s)),ok=G.completeQuest(d);assert.equal(result.actionAccepted,ok);if(ok)assert.deepEqual(result.result,d.result);}
let checks=0;
for(const epoch of [0,42])for(const age of [0,9,10,11,17,18,19,23,24,25,35,36,37])for(const place of ['astaris','south','north']){
 const s=accepted(age,place,epoch),input=saved(s),before=JSON.stringify(input),r=T.timeline(input),m=G.recipientMeeting(G.deserialize(input));
 assert.equal(r.sourceSha,E.sourceSha);assert.deepEqual(r.activeQuest.meeting,m);checkDelivery(r.delivery,s);
 assert.equal(!!r.waitForMerchant,m.canWait);if(m.canWait){const g=G.deserialize(input);assert(G.waitForEvent(g,m.waitExpected));assert.equal(r.waitForMerchant.worldTime,g.worldTime);checkDelivery(r.waitForMerchant.delivery,g);assert.deepEqual(g.characters,s.characters);assert.equal(g.gold,s.gold);assert.equal(g.partyRP,s.partyRP);assert(g.activeQuest);const after=JSON.stringify(g);assert.equal(G.waitForEvent(g,m.waitExpected),false);assert.equal(JSON.stringify(g),after);}
 if(age===24&&place==='south'){assert.equal(r.state.scenarioStages.wheel,'south_full');assert.equal(r.delivery.result.gold,220);assert.deepEqual(r.discrepancies,[]);}
 if(age===36&&place==='south'){assert.equal(r.state.scenarioStages.wheel,'south_late');assert.equal(r.delivery.result.gold,110);assert.deepEqual(r.discrepancies,[]);}
 assert.equal(JSON.stringify(input),before);checks++;
}
for(const epoch of [0,42])for(const [start,dest] of [[3,'astaris'],[3,'south'],[9,'south'],[12,'astaris'],[18,'south'],[30,'south'],[31,'south']])for(const cargo of [true,false]){
 const s=accepted(start,'east',epoch);if(!cargo)s.selected=s.selected.filter(id=>id!==s.activeQuest.cargoOwnerId);const raw=saved(s),before=JSON.stringify(raw),r=T.timeline(raw,{destination:dest});const direct=G.deserialize(raw);assert(G.depart(direct,dest));
 for(const f of r.forecasts){const official=G.forecast(direct,f.choice);assert.deepEqual(f.officialForecast,official);assert.equal(f.delivery.available,official.handoffAvailable);assert.equal(!!f.afterWait,!!official.afterWait);if(f.afterWait){assert.equal(f.afterWait.worldTime,official.afterWait.worldTime);assert.equal(f.afterWait.delivery.available,official.afterWait.handoffAvailable);assert.equal(f.afterWait.delivery.result?.gold||0,official.afterWait.reward);assert(f.afterWait.hours>0);}}
 assert.equal(JSON.stringify(raw),before);checks++;
}
// Current-location boundary comparison also exposes waiting without carrying state from earlier rows.
{const s=accepted(0,'south');const r=T.boundaryComparison(saved(s));assert.equal(r.rows.find(x=>x.age===9).waitForMerchant.hours,9);assert.equal(r.rows.find(x=>x.age===17).waitForMerchant.hours,1);assert.equal(r.rows.find(x=>x.age===18).waitForMerchant,null);}
// The report contains no importable save or frontend data, and repeated checks are deterministic.
{const input=saved(accepted(15,'south'));input.godotCampaignId='abcdef0123456789abcdef0123456789';input.godotFrontend={version:1,journey_key:'PRIVATE_SENTINEL'};const before=JSON.stringify(input);const a=T.timeline(input),b=T.timeline(input);assert.deepEqual(a,b);assert.equal(JSON.stringify(input),before);for(const value of ['PRIVATE_SENTINEL','godotCampaignId','nativePortraits','"characters"','"rollback"'])assert(!JSON.stringify(a).includes(value));assert.throws(()=>C.deserialize(a));}
console.log(`PASS ${checks} NPC save-lab parity cases plus boundary waiting, original immutability, exact source, repeat/cargo/epoch and report isolation groups. Exact external game comparison: ${!!process.env.EXACT_GAME_ROOT}.`);
