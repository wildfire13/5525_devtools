'use strict';
const {verifyRoundtrip} = require('./save-validation.cjs');
const {gameModule, sourceSha, repository} = require('./game-source.cjs');
// Read-only probes over independent copies. Never return an importable save.
const C = gameModule('campaign.js');
const J = gameModule('journey.js');
const Envelope = require('./metadata-envelope.cjs');
const clone = value => JSON.parse(JSON.stringify(value));
const fail = message => { throw new Error(message); };
const place = id => C.locations.find(p => p.id === id)?.name || id || '移動中・出発済み';
function verified(state) {
  return verifyRoundtrip(state, '検証コピーの再読込で差分が生じました').reloaded;
}
function options(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length) fail('options must be a plain object');
  for (const key of Object.keys(value)) if (!['questId', 'carrierId', 'destination', 'advanceHours'].includes(key)) fail('Unsupported timeline option: ' + key);
  for (const key of ['questId', 'carrierId', 'destination']) if (value[key] !== undefined && (typeof value[key] !== 'string' || value[key].length > 200)) fail(key + ' must be a short string');
  if (value.advanceHours !== undefined && (!Number.isSafeInteger(value.advanceHours) || value.advanceHours < 0 || value.advanceHours > 100000)) fail('追加時間は0〜100000の整数にしてください');
  return value;
}
function advance(s, hours) {
  if (!hours) return;
  s.worldTime += hours;
  s.hours += hours;
  if (s.journey && s.phase !== 'result') s.journey.hours += hours;
  else if (s.activeQuest) s.activeQuest.elapsedHours = (s.activeQuest.elapsedHours || 0) + hours;
  // Official presentation synchronizes the current calendar and missed offers.
  C.view(s);
}
function delivery(s) {
  const probe = verified(clone(s)), q = probe.activeQuest;
  if (!q) return {available:false, actionAccepted:false, reason:'受注中の依頼がありません', result:null};
  if (probe.phase !== 'town') return {available:false, actionAccepted:false, reason:'街での到着処理後に納品判定します', result:null};
  const view = C.view(probe), shown = view.activeQuest;
  if (!C.completeQuest(probe)) {
    const meeting = shown.meeting;
    const reason = meeting?.reason === 'before_arrival' ? `この町で行商人の到着を待てます（${meeting.waitHours}時間）` : !view.cargoAboard ? '荷物を持つポーターが編成にいません' : q.eventId === 'wheel' && shown.merchantTraveling ? '行商人はまだ到着していません' : q.eventId === 'wheel' && shown.merchantDeparted ? '行商人は出発済みです。どの町でも期限切れを確認できます' : '納品先にいません';
    return {available:false, actionAccepted:false, reason, result:null};
  }
  verified(probe);
  const result = clone(probe.result), available = result.outcome !== 'failed';
  return {available, actionAccepted:true, reason:available ? result.outcome === 'late' ? '納品可能・基本報酬' : '納品可能・希望条件達成' : '失敗処理・受注前へ復元（世界時刻は維持）', result};
}
// These are observed stage/settlement disagreements, not overrides of the game rules.
function discrepancies(s, view, settlement) {
  if (!settlement.actionAccepted || !settlement.available) return [];
  const eventId = s.activeQuest?.eventId, age = s.worldTime-s.standaloneEvents.epoch;
  const stage = view.scenarioStages[eventId], result = settlement.result;
  const known = eventId === 'kiln' && age === 20 && stage === 'closed'
    ? ['kiln_closed_but_success', '最後の窯は20時間ちょうどでclosed表示ですが、現在の納品条件では150Gの成功処理になります。']
    : eventId === 'wheel' && age === 24 && stage === 'south_late'
    ? ['wheel_late_stage_but_full', '車輪は24時間ちょうどでsouth_late表示ですが、現在の納品条件では満額220Gになります。']
    : eventId === 'wheel' && age === 36 && stage === 'departed'
    ? ['wheel_departed_but_late', '車輪は36時間ちょうどでdeparted表示ですが、現在の納品条件では基本報酬110Gになります。'] : null;
  return known ? [{code:known[0],eventId,age,stage,settlement:{outcome:result.outcome,gold:result.gold,rp:result.rp,xp:result.xp},message:'段階表示と納品処理の境界差: '+known[1]+' 納品可否はcompleteQuestの実結果を基準にします。'}] : [];
}
function waitProbe(s) {
  const probe = clone(s), expected = C.recipientMeeting(probe)?.waitExpected;
  if (!C.waitForEvent(probe, expected)) return null;
  const after = verified(probe);
  return {hours:after.worldTime-s.worldTime,worldTime:after.worldTime,calendarAge:after.worldTime-after.standaloneEvents.epoch,meeting:clone(C.recipientMeeting(after)),delivery:delivery(after)};
}
function arrivalProbe(s, delta, destination) {
  const probe = clone(s), travelled = (probe.journey?.hours || 0) + delta;
  probe.worldTime += delta; probe.hours += delta;
  if (probe.activeQuest) probe.activeQuest.elapsedHours = (probe.activeQuest.elapsedHours || 0) + travelled;
  probe.phase = 'town'; probe.location = destination; probe.journey = null; probe.battle = null; probe.result = null;
  if (!probe.activeQuest) probe.rollback = null;
  C.view(probe);
  return verified(probe);
}
function forecasts(s) {
  if (!s.journey || !['road','camp'].includes(s.phase) || C.view(s).inventoryOverflow.length) return [];
  const rows = [], choices = s.journey.returning ? [s.journey.outboundRoute || s.journey.route] : ['short','safe'];
  if (s.phase === 'camp' && !s.journey.rested) choices.push('rest');
  if (C.canTurnBack(s)) choices.push('turnBack');
  for (const choice of choices) {
    const probe = clone(s);
    if (s.phase === 'camp' && ['short','safe'].includes(choice) && !C.onward(probe)) continue;
    if (choice === 'rest' && !C.rest(clone(probe))) continue;
    const forecast = C.forecast(probe, choice);
    if (!forecast) continue;
    // Journey owns the travel-time calculation; campaign owns deadlines.
    const total = choice === 'turnBack' ? probe.journey.hours + ((probe.journey.outboundRoute || probe.journey.route) === 'safe' ? 4 : 2) + 1 : J.forecast(probe.journey, choice).hours;
    const delta = total - probe.journey.hours, destination = choice === 'turnBack' ? probe.journey.origin : probe.journey.destination;
    const arriving = arrivalProbe(probe, delta, destination);
    const arrivalView = C.view(arriving), settlement = delivery(arriving), differences = discrepancies(arriving, arrivalView, settlement);
    rows.push({choice, label:{short:'近道で進む',safe:'迂回で進む',rest:'休息して進む',turnBack:'引き返す'}[choice], additionalHours:delta, worldTime:arriving.worldTime, calendarAge:arriving.worldTime-arriving.standaloneEvents.epoch, destination, destinationName:place(destination), scenarioStages:clone(arrivalView.scenarioStages), officialForecast:forecast, delivery:settlement, afterWait:waitProbe(arriving), discrepancies:differences, warnings:differences.map(d => d.message)});
  }
  return rows;
}
function timeline(save, suppliedOptions) {
  const opt = options(suppliedOptions), parts = Envelope.split(save), s = C.deserialize(parts.core);
  const original = clone({phase:s.phase, location:s.location, hours:s.hours, worldTime:s.worldTime});
  const first = C.view(s), offered = clone(first.board), carriers = first.roster.filter(r => r.job === 'porter' && s.selected.includes(r.id)).map(r => ({id:r.id,name:r.name}));
  if (opt.carrierId && !opt.questId) fail('荷物担当の指定には、検証する未受注依頼を選んでください');
  if (opt.questId) {
    if (s.activeQuest) fail('受注済みの依頼があるため別の依頼を選べません');
    if (!offered.some(q => q.id === opt.questId)) fail('この状態では選択した依頼を受注できません');
    const carrier = opt.carrierId || carriers[0]?.id;
    if (!carrier || !C.accept(s, opt.questId, carrier)) fail('検証コピーで受注できません。編成中のポーターと所持枠を確認してください');
  }
  advance(s, opt.advanceHours || 0);
  if (opt.destination && !C.depart(s, opt.destination)) fail('検証コピーで出発できません。街・経路・所持枠・ポーターHPを確認してください');
  const current = verified(s), view = C.view(current), q = view.activeQuest;
  const currentDelivery = delivery(current), rows = forecasts(current), age = current.worldTime-current.standaloneEvents.epoch;
  const afterWait = waitProbe(current);
  const arrival = clone(current), canArrive = current.phase === 'arrival' && C.arrive(arrival);
  const differences = discrepancies(current, view, currentDelivery);
  const warnings = differences.map(d => d.message);
  if (view.inventoryOverflow.length) warnings.push('所持枠を超過しているため、移動・休息・引き返しの予測は表示しません。編成メンバーの所持品をゲーム側で確認してください。');
  if (['deployment','battle'].includes(current.phase)) warnings.push('戦闘準備・戦闘中は時刻と依頼条件の確認のみです。勝敗や残り戦闘時間は予測しません。');
  const selectedId = q?.id || null;
  return {
    schemaVersion:1, sourceSha, sourceUrl:`https://github.com/${repository}/blob/${sourceSha}/native/campaign.js`,
    copyOnly:true, original, options:clone(opt),
    clock:{worldTime:current.worldTime, elapsedHours:current.hours, calendarEpoch:current.standaloneEvents.epoch, calendarAge:age, journeyHours:current.journey?.hours || 0, questHours:q ? (q.elapsedHours || 0)+(current.journey?.hours || 0) : null},
    state:{phase:current.phase,location:current.location,locationName:place(current.location),journeyDestination:current.journey?.destination || null,scenarioStages:clone(view.scenarioStages)},
    activeQuest:q ? {...q,fromName:place(q.from),toName:place(q.to),timeBasis:q.eventId?'calendar':'quest',conditionHours:q.deadline,conditionClock:q.eventId?age:(q.elapsedHours||0)+(current.journey?.hours||0)} : null,
    availableQuests:offered, selectedQuestId:selectedId, carriers, destinations:current.phase === 'town' ? view.destinations : [],
    delivery:currentDelivery, forecasts:rows, discrepancies:differences,
    waitForMerchant:afterWait,
    afterArrival:canArrive ? {locationName:place(arrival.location),delivery:delivery(verified(arrival)),afterWait:waitProbe(arrival)} : null,
    aftermath:clone(C.scenarioAftermath(current)),
    calendar:{epoch:current.standaloneEvents.epoch,events:clone(current.standaloneEvents.events),
      schedule:[{at:10, label:'行商人がアスタリスに到着', detail:'10以上・18未満で受取'}, {at:18,label:'行商人がサウスへ / カブの希望条件',detail:'行商人は18以上・36以下。カブは18ちょうどまで'}, {at:20,label:'最後の窯の希望条件',detail:'20以上・21未満はclosed表示ですが、20ちょうどまで納品成功'}, {at:21,label:'窯の段階表示: 焼成',detail:'21以上・22未満はfired。納品期限は20以下のため、21以降は納品先で失敗処理'}, {at:22,label:'窯の段階表示: 冷却',detail:'22以上・23未満はcooling。時刻のみの段階表示であり、納品成功を意味しません'}, {at:23,label:'窯の段階表示: 返却',detail:'23以上はreturned。窯焚きの後日談は依頼完了済み・23以上・現在地イースの場合のみ表示'}, {at:24,label:'車輪の希望条件',detail:'24ちょうどはsouth_full・満額220G、超過後はsouth_late・110G'}, {at:36,label:'車輪の受取最終時刻',detail:'36ちょうどはsouth_late・110G。超過後はdeparted、どの町でも確認後に失敗処理'}, {at:37,label:'未受注の荷車のあと',detail:'未受注・募集終了（missed）でサウスにいる場合のみ表示。受注済みの失敗とは別'}]},
    assumptions:[
      `公式ゲームの固定参照 ${sourceSha} に基づく検証です。別SHAのゲームの動作は保証しません。`,
      '到着直後と待機後は別々の独立コピーで実処理を確認します。待機だけでは自動納品・報酬受取・回復を行いません。',
      '検証コピーのみで受注・時刻追加・出発を仮定し、原本A・作業B・実ファイルは変更しません。コピーをゲームのセーブとして書き出す機能はありません。',
      '追加時間は時間条件だけを調べる仮定です。移動、回復、戦闘や所持品消費を再現しません。受注を選んだ場合はコピーで受注してから追加します。',
      '予測は公式forecastを使用。次の区間は近道2h / 迂回4h、戦闘各1h、その先は近道・休息なしを仮定します。休息は2hです。戦闘勝利と荷物維持が前提です。',
      '予測の金額は勝利後に荷物を納品できる場合の配達報酬です。戦利品・戦闘EXPは含みません。公式予測額だけでなく到着地点でcompleteQuestを試してG / RP / EXPを区別します。',
      '世界時刻は復元しても進む時計、経過時間は失敗時に復元し得る時計です。単発依頼は予定開始からの時刻、通常依頼は受注後の旅の経過で判定します。',
      '予定表は固定版campaign.jsの10 / 18 / 20 / 21 / 22 / 23 / 24 / 36境界を参照。参照版を更新した際は境界テストを再実行してください。'
    ],warnings
  };
}
const BOUNDARY_AGES = {
  turnip:[17,18,19],
  kiln:[19,20,21,22,23,24],
  wheel:[9,10,11,17,18,19,23,24,25,35,36,37]
};
function boundaryComparison(save, suppliedOptions) {
  const opt = options(suppliedOptions), baseline = timeline(save, opt);
  if (baseline.activeQuest && !baseline.activeQuest.eventId) fail('境界比較は単発3件または未受注のNPC予定のみ対応しています。通常依頼は時間・条件の個別検証を使用してください');
  const baselineAge = baseline.clock.calendarAge;
  const rows = [];
  const activeEventId = baseline.activeQuest?.eventId || null;
  const groups = Object.entries(BOUNDARY_AGES).filter(([eventId]) => !activeEventId || eventId === activeEventId);
  for (const [eventId, ages] of groups) for (const age of ages) {
    const base = {eventId,age,worldTime:baseline.clock.calendarEpoch+age};
    if (age < baselineAge) {
      rows.push({...base,status:'not_run',reason:'基準時刻より過去のため未実行。入力状態を巻き戻して推測しません。',stage:null,delivery:null,forecasts:[],warnings:[],discrepancies:[],changes:[]});
      continue;
    }
    // Each probe starts from the input, accepting the same offer before adding
    // time and departing normally. No settled/failed probe feeds a later row.
    const report = timeline(save, {...opt,advanceHours:(opt.advanceHours || 0)+age-baselineAge});
    const snapshot = {
      stage:report.state.scenarioStages[eventId],delivery:report.delivery,aftermath:report.aftermath,
      waitForMerchant:report.waitForMerchant,forecasts:report.forecasts,warnings:report.warnings,discrepancies:report.discrepancies
    };
    const previous = {...snapshot,stage:baseline.state.scenarioStages[eventId],delivery:baseline.delivery,aftermath:baseline.aftermath,
      waitForMerchant:baseline.waitForMerchant,forecasts:baseline.forecasts,warnings:baseline.warnings,discrepancies:baseline.discrepancies};
    const changes = Object.keys(snapshot).filter(key => JSON.stringify(snapshot[key]) !== JSON.stringify(previous[key]))
      .map(field => ({field,before:clone(previous[field]),after:clone(snapshot[field])}));
    rows.push({...base,status:'run',activeEventId:report.activeQuest?.eventId || null,state:report.state,...snapshot,changes});
  }
  return {
    schemaVersion:1,kind:'boundaryComparison',copyOnly:true,sourceSha:baseline.sourceSha,sourceUrl:baseline.sourceUrl,
    options:clone(opt),activeEventId,baseline,rows,
    assumptions:[...baseline.assumptions,
      '各行は入力と同じ受注・移動先条件から独立に検証します。単発依頼の受注中はその依頼の境界だけを表示します。未受注では全予定の段階を表示します。別依頼の受注や地点の変更は行いません。',
      '追加時間適用後の基準時刻より過去はnot_runです。各行の納品結果は現行の受注依頼・現在地・編成による結果です。変更欄は基準結果との比較であり直前行との比較ではありません。']
  };
}
module.exports = {timeline,boundaryComparison};
