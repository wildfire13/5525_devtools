'use strict';
// Synthetic QA is deliberately separate from imported saves and timeline reports.
const C = require('./vendor/5525/native/campaign.js');
const Timeline = require('./quest-timeline.cjs');
const manifest = require('./vendor/source-manifest.json');
const fail = message => { throw new Error(message); };
const source = () => ({sourceSha:manifest.sourceSha,sourceUrl:`https://github.com/${manifest.repository}/blob/${manifest.sourceSha}/native/campaign.js`});
const definitions = [
  ...[['turnip','north','astaris',[17,18,19]],['kiln','astaris','east',[19,20,21,22,23]],['wheel','east','astaris',[9,10,17]],['wheel','east','south',[18,23,24,25,35,36,37]]].flatMap(([eventId,origin,location,ages]) => ages.map(age => ({id:`${eventId}-accepted-${age}h`,eventId,origin,location,age,mode:'accepted',label:`${{turnip:'カブ',kiln:'最後の窯',wheel:'車輪'}[eventId]} / 受注中 / ${age}h`}))),
  ...[['turnip','north'],['kiln','astaris'],['wheel','east']].map(([eventId,location])=>({id:`${eventId}-offered-0h`,eventId,origin:location,location,age:0,mode:'offered',label:`${{turnip:'カブ',kiln:'最後の窯',wheel:'車輪'}[eventId]} / 未受注 / 0h`})),
  {id:'kiln-completed-23h',eventId:'kiln',origin:'astaris',location:'east',age:23,mode:'completed',label:'最後の窯 / 19hで納品済み / 23h後日談'}
];
const assumptions = [
  'TEST ONLY: 実セーブを入力せず、固定版の公式create/acceptから作る人工状態です。',
  '時刻と場所を直接設定します。移動・戦闘・回復・消費を再現した通しプレイではありません。',
  '報酬や期限は変更しません。公式validatorと保存再読込の一致を確認します。',
  '保存先は新規QAフォルダのみです。本番プロフィールに配置・読込しません。実ゲームでの読込・表示は別途確認が必要です。',
  'この結果は固定参照版のものです。別SHAのゲームや修正候補を検証済みとは扱えません。'
];
function catalog() { return {schemaVersion:1,kind:'syntheticQaCatalog',synthetic:true,...source(),cases:definitions.map(d=>({...d})),assumptions:[...assumptions]}; }
function verified(s) {
  const v=C.validate(s);if(!v.ok)fail(v.error);
  const raw=C.serialize(s),again=C.deserialize(raw);if(C.serialize(again)!==raw)fail('人工QAセーブの再読込が一致しません');
  return again;
}
function make(def) {
  const s=C.create(); s.location=def.origin;
  if(def.mode!=='offered') {
    const porter=C.view(s).roster.find(r=>r.job==='porter'&&s.selected.includes(r.id));
    if(!porter||!C.accept(s,'standalone-'+def.eventId,porter.id))fail('人工状態を受注できません');
    const age=def.mode==='completed'?19:def.age;
    s.worldTime=age;s.hours=age;s.activeQuest.elapsedHours=age;s.location=def.location;
    if(def.mode==='completed') {
      if(!C.completeQuest(s)||s.result?.outcome==='failed')fail('人工後日談の納品に失敗しました');
      // Official result dismissal, then a clock-only assumption, not an action replay.
      if(!C.acknowledge(s))fail('人工後日談の結果画面を終了できません');
      s.worldTime=def.age;s.hours=def.age;
    }
  }
  C.view(s);
  const state=verified(s),save=JSON.parse(C.serialize(state));
  const view=C.view(state);
  return {case:{...def},save,report:{schemaVersion:1,kind:'syntheticQaFixture',synthetic:true,testOnly:true,...source(),case:{...def},validation:{officialValidator:true,serializeReloadIdentical:true,gameUi:'not_run'},aftermath:view.scenarioAftermath.map(({id,name})=>({id,name})),timeline:Timeline.timeline(save),assumptions:[...assumptions]}};
}
function fixtures(options={}) {
  if(!options||typeof options!=='object'||Array.isArray(options))fail('options must be an object');
  for(const key of Object.keys(options))if(key!=='caseIds')fail('Unsupported QA option: '+key);
  const ids=options.caseIds===undefined?definitions.map(d=>d.id):options.caseIds;
  if(!Array.isArray(ids)||!ids.length||ids.length>definitions.length||ids.some(id=>typeof id!=='string')||new Set(ids).size!==ids.length)fail('caseIdsには重複のない既定ケースを指定してください');
  const cases=ids.map(id=>{const d=definitions.find(d=>d.id===id);if(!d)fail('Unknown QA case: '+id);return make(d);});
  return {schemaVersion:1,kind:'syntheticQaBundle',synthetic:true,testOnly:true,...source(),cases,assumptions:[...assumptions]};
}
module.exports={catalog,fixtures};
