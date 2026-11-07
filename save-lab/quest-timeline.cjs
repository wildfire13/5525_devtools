'use strict';
// Read-only probes over independent copies. Never return an importable save.
const C = require('./vendor/5525/native/campaign.js');
const J = require('./vendor/5525/native/journey.js');
const Envelope = require('./metadata-envelope.cjs');
const manifest = require('./vendor/source-manifest.json');
const clone = value => JSON.parse(JSON.stringify(value));
const fail = message => { throw new Error(message); };
const place = id => C.locations.find(p => p.id === id)?.name || id || '移動中・出発済み';
function verified(s) {
  const validation = C.validate(s);
  if (!validation.ok) fail(validation.error);
  const raw = C.serialize(s), again = C.deserialize(raw);
  if (C.serialize(again) !== raw) fail('検証コピーの再読込で差分が生じました');
  return again;
}
function options(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('options must be an object');
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
    const reason = !view.cargoAboard ? '荷物を持つポーターが編成にいません' : q.eventId === 'wheel' && shown.merchantTraveling ? '行商人はまだ到着していません' : q.eventId === 'wheel' && shown.merchantDeparted ? '行商人は出発済みです。失敗処理はサウスでのみ可能です' : '納品先にいません';
    return {available:false, actionAccepted:false, reason, result:null};
  }
  verified(probe);
  const result = clone(probe.result), available = result.outcome !== 'failed';
  return {available, actionAccepted:true, reason:available ? result.outcome === 'late' ? '納品可能・基本報酬' : '納品可能・希望条件達成' : '失敗処理・受注前へ復元', result};
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
    const settlement = delivery(arriving);
    rows.push({choice, label:{short:'近道で進む',safe:'迂回で進む',rest:'休息して進む',turnBack:'引き返す'}[choice], additionalHours:delta, worldTime:arriving.worldTime, calendarAge:arriving.worldTime-arriving.standaloneEvents.epoch, destination, destinationName:place(destination), officialForecast:forecast, delivery:settlement});
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
  const wait = clone(current), canWait = C.waitForEvent(wait);
  const arrival = clone(current), canArrive = current.phase === 'arrival' && C.arrive(arrival);
  const warnings = [];
  if (view.inventoryOverflow.length) warnings.push('所持枠を超過しているため、移動・休息・引き返しの予測は表示しません。編成メンバーの所持品をゲーム側で確認してください。');
  if ([24,36].includes(age)) warnings.push('行商人の段階表示と納品処理に境界差があります。24時間ちょうどは満額、36時間ちょうどは基本報酬で納品可能です。納品可否にはcompleteQuestの実結果を使用しています。');
  if (['deployment','battle'].includes(current.phase)) warnings.push('戦闘準備・戦闘中は時刻と依頼条件の確認のみです。勝敗や残り戦闘時間は予測しません。');
  const selectedId = q?.id || null;
  return {
    schemaVersion:1, sourceSha:manifest.sourceSha, sourceUrl:`https://github.com/${manifest.repository}/blob/${manifest.sourceSha}/native/campaign.js`,
    copyOnly:true, original, options:clone(opt),
    clock:{worldTime:current.worldTime, elapsedHours:current.hours, calendarEpoch:current.standaloneEvents.epoch, calendarAge:age, journeyHours:current.journey?.hours || 0, questHours:q ? (q.elapsedHours || 0)+(current.journey?.hours || 0) : null},
    state:{phase:current.phase,location:current.location,locationName:place(current.location),journeyDestination:current.journey?.destination || null,scenarioStages:clone(view.scenarioStages)},
    activeQuest:q ? {...q,fromName:place(q.from),toName:place(q.to),timeBasis:q.eventId?'calendar':'quest',conditionHours:q.deadline,conditionClock:q.eventId?age:(q.elapsedHours||0)+(current.journey?.hours||0)} : null,
    availableQuests:offered, selectedQuestId:selectedId, carriers, destinations:current.phase === 'town' ? view.destinations : [],
    delivery:currentDelivery, forecasts:rows,
    waitForMerchant:canWait ? {hours:wait.worldTime-current.worldTime,worldTime:wait.worldTime,delivery:delivery(verified(wait))} : null,
    afterArrival:canArrive ? {locationName:place(arrival.location),delivery:delivery(verified(arrival))} : null,
    calendar:{epoch:current.standaloneEvents.epoch,events:clone(current.standaloneEvents.events),
      schedule:[{at:10, label:'行商人がアスタリスに到着', detail:'10以上・18未満で受取'}, {at:18,label:'行商人がサウスへ / カブの希望条件',detail:'行商人は18以上・36以下。カブは18ちょうどまで'}, {at:20,label:'最後の窯の希望条件',detail:'20ちょうどまで納品成功'}, {at:24,label:'車輪の希望条件',detail:'24ちょうどまで満額220G、超過後は110G'}, {at:36,label:'車輪の受取最終時刻',detail:'36ちょうどは110G。超過後はサウスで失敗処理'}]},
    assumptions:[
      '固定参照版の実装検証です。企画用シナリオや新しい条件は作成・編集しません。',
      '検証コピーのみで受注・時刻追加・出発を仮定し、原本A・作業B・実ファイルは変更しません。コピーをゲームのセーブとして書き出す機能はありません。',
      '追加時間は時間条件だけを調べる仮定です。移動、回復、戦闘や所持品消費を再現しません。受注を選んだ場合はコピーで受注してから追加します。',
      '予測は公式forecastを使用。次の区間は近道2h / 迂回4h、戦闘各1h、その先は近道・休息なしを仮定します。休息は2hです。戦闘勝利と荷物維持が前提です。',
      '予測の金額は勝利後に荷物を納品できる場合の配達報酬です。戦利品・戦闘EXPは含みません。公式予測額だけでなく到着地点でcompleteQuestを試してG / RP / EXPを区別します。',
      '世界時刻は復元しても進む時計、経過時間は失敗時に復元し得る時計です。単発依頼は予定開始からの時刻、通常依頼は受注後の旅の経過で判定します。',
      '予定表は固定版campaign.jsの10 / 18 / 20 / 24 / 36境界を参照。参照版を更新した際は境界テストを再実行してください。'
    ],warnings
  };
}
module.exports = {timeline};
