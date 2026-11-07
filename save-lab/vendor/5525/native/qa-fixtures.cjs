'use strict';

// EXPLICIT TEST-ONLY BOUNDARY FIXTURES. These are deterministic engine-generated
// states for QA controls, never ordinary gameplay or balance evidence. No HP,
// MP, position, AI parameter, reward, or journey phase is assigned by this file.
const B = require('./battle.js');
const J = require('./journey.js');
const SEED = 5525;
const ACTION_LIMIT = 250;

function requireAccepted(value, operation) {
  if (!value) throw Error('QA fixture rejected operation: ' + operation);
}

function fixedRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function createEncounter(journey, random) {
  requireAccepted(J.travel(journey, 'short'), 'travel(short)');
  const state = B.create({
    ally: journey.selected,
    enemy: J.randomEnemies(journey.stage === 0 ? 3 : 4, random),
    formation: journey.formation,
    previous: journey.party,
    bonusMp: journey.kit === 'ether' ? 2 : 0,
    skillStage: journey.level,
    potions: journey.potions,
    enemyPotions: journey.stage === 0 ? 0 : 1,
    deployment: true,
  });
  requireAccepted(B.begin(state), 'begin');
  return state;
}

function policyChoice(state) {
  // Match the public-rule planning policy used in test_journey_bridge.py.
  // Plan only on a detached copy; the real state changes exclusively via act.
  const planning = JSON.parse(JSON.stringify(state));
  const actor = planning.units.find(unit => unit.id === planning.actor);
  if (!actor) throw Error('QA fixture has no living actor before terminal state');
  B.plan(planning, actor);
  let {kind, target} = actor.intent;
  if (actor.job === 'porter') {
    const hurt = planning.units.filter(unit => unit.hp > 0 && unit.side === actor.side && unit.hp < 30)
      .sort((left, right) => left.hp - right.hp)
      .find(unit => B.legal(planning, 'item', unit.id));
    if (hurt) {kind = 'item';target = hurt.id;}
    else {kind = B.legal(planning, 'skill', actor.id) ? 'skill' : 'guard';target = kind === 'skill' ? actor.id : null;}
  }
  return {kind, target};
}

function resolveBattle(state, guardOnly = false) {
  for (let actions = 0; actions < ACTION_LIMIT && !state.result; actions++) {
    const choice = guardOnly ? {kind: 'guard', target: null} : policyChoice(state);
    requireAccepted(B.legal(state, choice.kind, choice.target), 'legal ' + choice.kind);
    requireAccepted(B.act(state, choice.kind, choice.target), 'act ' + choice.kind);
  }
  if (!state.result || state.actor !== null)
    throw Error('QA fixture failed to reach a terminal battle within ' + ACTION_LIMIT + ' actions');
}

function makeJourneyFixture(name) {
  if (!['ontime_delivery', 'failed_result'].includes(name))
    throw new RangeError('Unknown test-only journey fixture: ' + String(name));
  const journey = J.create(), random = fixedRandom(SEED), actions = [];
  requireAccepted(J.accept(journey, 'parts'), 'accept(parts)');
  if (name === 'failed_result')
    requireAccepted(J.select(journey, ['porter']), 'select(one porter)');
  requireAccepted(J.depart(journey, 'medicine', 'convoy'), 'depart(medicine,convoy)');
  let state;

  if (name === 'ontime_delivery') {
    for (let leg = 0; leg < 2; leg++) {
      state = createEncounter(journey, random);
      resolveBattle(state);
      if (state.failure || state.units.some(unit => unit.side === 'enemy' && unit.hp > 0))
        throw Error('QA on-time fixture did not win encounter ' + (leg + 1));
      actions.push(state.actions);
      requireAccepted(J.finishBattle(journey, state), 'finishBattle');
      if (leg === 0) requireAccepted(J.onward(journey), 'onward(no rest)');
    }
    if (journey.phase !== 'delivery' || journey.hours !== 6 || journey.stage !== 2 ||
        journey.hours > journey.job.deadline || journey.gold !== 0 || journey.xp !== 0 || journey.outcome !== null)
      throw Error('QA on-time fixture must stop at unrewarded delivery after two victories');
  } else {
    state = createEncounter(journey, random);
    resolveBattle(state, true);
    const porter = state.units.find(unit => unit.id === 'porter');
    if (state.failure !== 'porter' || !porter || porter.hp !== 0)
      throw Error('QA failure fixture must end through actual porter death');
    actions.push(state.actions);
    requireAccepted(J.finishBattle(journey, state), 'finishBattle(porter failure)');
    if (journey.phase !== 'result' || journey.outcome !== 'failed' ||
        journey.stage !== 0 || journey.gold !== 0 || journey.xp !== 0 || !journey.failureReason)
      throw Error('QA failure fixture has an invalid failed journey result');
  }

  return {
    journey,
    state,
    metadata: {
      name,
      label: name === 'ontime_delivery'
        ? 'QA固定局面：納期内配達直前（実戦2回・自動生成）'
        : 'QA固定局面：ポーター戦闘不能の失敗結果（実戦・自動生成）',
      testOnly: true,
      seed: SEED,
      actions,
      method: name === 'ontime_delivery'
        ? 'TEST ONLY: parts/default party; two short routes, no rest; locally seeded Journey.randomEnemies; detached-copy Battle.plan policy with legal porter support/guard; full Battle.act battles; stops before Journey.deliver'
        : 'TEST ONLY: parts/valid one-porter party; one short route; locally seeded Journey.randomEnemies; legal guard actions and unchanged enemy AI until actual porter death; Journey.finishBattle produces failed result',
    },
  };
}

module.exports = {makeJourneyFixture};
