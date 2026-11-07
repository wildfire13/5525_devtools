'use strict';

// Observe one synchronous engine action without adding fields to game/save state.
// HP writes, rather than net HP deltas, retain hits followed by healing and cover.
function capture(state, engine, kind, run) {
  const events = [], descriptors = [];
  const actor = state?.units.find(u => u.id === state.actor);
  if (actor?.side === 'ally' && ['attack', 'skill', 'return'].includes(kind)) {
    events.push({character_id: actor.id,
      cue: kind === 'return' ? 'skill:returnHome' : kind === 'skill' ? 'skill:' + engine.activeSkill(actor) : 'attack'});
  }
  try {
    for (const unit of state?.units || []) {
      const descriptor = Object.getOwnPropertyDescriptor(unit, 'hp');
      let hp = unit.hp;
      descriptors.push(() => Object.defineProperty(unit, 'hp', {...descriptor, value: hp}));
      Object.defineProperty(unit, 'hp', {configurable: true, enumerable: true,
        get: () => hp,
        set: value => {
          if (value < hp && unit.side === 'ally') {
            events.push({character_id: unit.id, cue: 'hurt'});
            if (hp > 0 && value <= 0) events.push({character_id: unit.id, cue: 'incapacitated'});
          }
          hp = value;
        }});
    }
    const ok = run();
    return {ok, events: ok ? events : []};
  } finally {
    for (const restore of descriptors) restore();
  }
}
module.exports = {capture};
