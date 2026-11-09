// TEST ONLY: no imported saves, no file writes. The caller chooses a fresh output folder.
'use strict';
const {gameModule} = require('../game-source.cjs');
const C=gameModule('campaign.js'),T=require('../quest-timeline.cjs'),assert=require('node:assert/strict');
const bundle=require('./npc_fixture_bundle.cjs');const towns=['astaris','east','west','south','north'];
const definitions=[
 ...[0,42].flatMap(epoch=>towns.flatMap(location=>[false,true].map(missingCargo=>({id:`decisions-wheel-expired-${location}-37h-epoch${epoch}${missingCargo?'-offparty':''}`,eventId:'wheel',origin:'east',location,age:37,epoch,missingCargo,mode:'accepted'})))),
 ...[0,42].flatMap(epoch=>[25,36,37].map(age=>({id:`decisions-wheel-missed-south-${age}h-epoch${epoch}`,eventId:'wheel',origin:'east',location:'south',age,epoch,mode:'missed'}))),
 ...[0,42].flatMap(epoch=>[22,23].map(age=>({id:`decisions-kiln-completed-east-${age}h-epoch${epoch}`,eventId:'kiln',origin:'astaris',location:'east',age,epoch,mode:'completed'})))
];
for(const d of definitions){
 const s=C.create();s.worldTime=d.epoch;s.hours=d.epoch;s.standaloneEvents.epoch=d.epoch;s.location=d.origin;
 if(d.mode!=='missed'){assert(C.accept(s,'standalone-'+d.eventId,C.view(s).roster.find(r=>r.job==='porter'&&s.selected.includes(r.id)).id));s.worldTime=d.epoch+(d.mode==='completed'?20:d.age);s.hours=s.worldTime;s.activeQuest.elapsedHours=d.mode==='completed'?20:d.age;s.location=d.location;if(d.missingCargo)s.selected=s.selected.filter(id=>id!==s.activeQuest.cargoOwnerId);if(d.mode==='completed'){assert(C.completeQuest(s));assert(C.acknowledge(s));}}
 else s.standaloneEvents.events.wheel.status='missed';
 s.worldTime=d.epoch+d.age;s.hours=s.worldTime;s.location=d.location;C.view(s);assert(C.validate(s).ok);const raw=C.serialize(s);assert.equal(C.serialize(C.deserialize(raw)),raw);const save=JSON.parse(raw),definition={...d,label:'TEST ONLY '+d.id};
 bundle.cases.push({case:definition,save,report:{schemaVersion:1,kind:'syntheticQaFixture',synthetic:true,testOnly:true,sourceSha:bundle.sourceSha,case:definition,validation:{officialValidator:true,serializeReloadIdentical:true,gameUi:'not_run'},aftermath:C.scenarioAftermath(s),timeline:T.timeline(save),assumptions:[...bundle.assumptions]}});
}
bundle.assumptions.push('3判断用: 先行41ケースと追加30ケース。全町37hは納品成功ではなく、確認による無報酬の失敗復元。未受注の痕跡はサウス37h以降のみ。');
if(require.main===module)console.log(JSON.stringify(bundle));module.exports=bundle;
