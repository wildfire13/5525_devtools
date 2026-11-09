// TEST ONLY. Pure synthetic fixture bundle; never reads a user save or writes a file.
'use strict';
const {gameModule} = require('../game-source.cjs');
const C=gameModule('campaign.js'),T=require('../quest-timeline.cjs'),Q=require('../qa-fixtures.cjs');
const assert=require('node:assert/strict');
const bundle=Q.fixtures();
const definitions=[
 ...[0,9,15,17].map(age=>({id:`npc-wheel-south-${age}h`,age,location:'south'})),
 {id:'npc-wheel-astaris-18h',age:18,location:'astaris'},
 {id:'npc-wheel-wrong-east-24h',age:24,location:'east'},
 {id:'npc-wheel-wrong-east-37h',age:37,location:'east'},
 {id:'npc-wheel-missing-cargo-south-15h',age:15,location:'south',missingCargo:true},
 {id:'npc-wheel-missing-cargo-south-24h',age:24,location:'south',missingCargo:true},
 {id:'npc-wheel-after-wait-south',age:15,location:'south',wait:true},
 {id:'npc-wheel-after-wait-astaris',age:9,location:'astaris',wait:true},
 {id:'npc-wheel-success-result-24h',age:24,location:'south',complete:true},
 {id:'npc-wheel-failed-result-37h',age:37,location:'south',complete:true},
 ...[15,24,36].map(age=>({id:`npc-wheel-epoch42-south-${age}h`,age,location:'south',epoch:42})),
 {id:'npc-wheel-road-south-3h',age:3,location:'east',destination:'south'},
 {id:'npc-wheel-road-astaris-3h',age:3,location:'east',destination:'astaris'},
 {id:'npc-wheel-missing-cargo-road-south-3h',age:3,location:'east',missingCargo:true,destination:'south'}
];
for(const d of definitions){const s=C.create(),epoch=d.epoch||0;s.location='east';s.worldTime=epoch;s.standaloneEvents.epoch=epoch;assert(C.accept(s,'standalone-wheel',C.view(s).roster.find(r=>r.job==='porter'&&s.selected.includes(r.id)).id));s.worldTime=epoch+d.age;s.hours=d.age;s.activeQuest.elapsedHours=d.age;s.location=d.location;if(d.missingCargo)s.selected=s.selected.filter(id=>id!==s.activeQuest.cargoOwnerId);if(d.wait)assert(C.waitForEvent(s,C.recipientMeeting(s).waitExpected));if(d.complete)assert(C.completeQuest(s));if(d.destination)assert(C.depart(s,d.destination));C.view(s);assert(C.validate(s).ok);const raw=C.serialize(s);assert.equal(C.serialize(C.deserialize(raw)),raw);const save=JSON.parse(raw);const definition={...d,eventId:'wheel',mode:d.complete?'result':d.destination?'road':'accepted',expectedAge:s.worldTime-epoch,label:'TEST ONLY '+d.id};bundle.cases.push({case:definition,save,report:{schemaVersion:1,kind:'syntheticQaFixture',synthetic:true,testOnly:true,sourceSha:bundle.sourceSha,case:definition,validation:{officialValidator:true,serializeReloadIdentical:true,gameUi:'not_run'},timeline:T.timeline(save),result:s.result,assumptions:bundle.assumptions}});}
bundle.assumptions.push(`固定参照 ${bundle.sourceSha} 用の人工QA: 既存22ケースとNPC追加19ケース。実プレイや画面の合格証明ではありません。`);
if(require.main===module)console.log(JSON.stringify(bundle));module.exports=bundle;
