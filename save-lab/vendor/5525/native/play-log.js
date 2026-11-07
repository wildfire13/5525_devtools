"use strict";
// Local, bounded diagnostics only. No storage, network, URL, or device information.
const PlayLog = (() => {
  const SCHEMA_VERSION = 1;
  const DEFAULT_MAX_EVENTS = 600;
  const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
  const copy = value => JSON.parse(JSON.stringify(value));
  const pick = (value, keys) => Object.fromEntries(keys.filter(key => value[key] !== undefined).map(key => [key, value[key]]));
  function bounded(value, depth = 0) {
    if (value == null || typeof value === 'boolean') return value ?? null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string') return value.slice(0, 500);
    if (depth >= 5) return '[truncated]';
    if (Array.isArray(value)) return value.slice(0, 40).map(item => bounded(item, depth + 1));
    if (typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 40).map(([key, item]) => [key, bounded(item, depth + 1)]));
    return null;
  }
  function snapshot({journey = null, battle = null} = {}) {
    const unit = u => bounded(pick(u, ['id', 'side', 'job', 'weapon', 'pos', 'hp', 'max', 'mp', 'maxMp', 'atk', 'agi', 'reach', 'skillStage', 'next', 'tie', 'guard', 'cover', 'boost', 'intent']));
    return {
      journey: journey ? {
        ...bounded(pick(journey, ['phase', 'hours', 'gold', 'xp', 'level', 'stage', 'rested', 'kit', 'formation', 'selected', 'potions', 'route', 'outcome', 'failureReason', 'completionSeen'])),
        job: journey.job ? pick(journey.job, ['id', 'deadline', 'reward']) : null,
        party: journey.party ? journey.party.slice(0, 20).map(unit) : null,
        history: bounded(journey.history.slice(-20))
      } : null,
      battle: battle ? {
        ...bounded(pick(battle, ['actor', 'actions', 'deploying', 'result', 'failure', 'potions', 'recentEnemies'])),
        units: battle.units.slice(0, 20).map(unit),
        messages: bounded(battle.log.slice(-15))
      } : null
    };
  }
  function create({mode = 'journey', maxEvents = DEFAULT_MAX_EVENTS, maxBytes = DEFAULT_MAX_BYTES, now = () => new Date().toISOString()} = {}) {
    if (!Number.isInteger(maxEvents) || maxEvents < 1 || !Number.isInteger(maxBytes) || maxBytes < 1) throw new RangeError('Positive integer log limits required');
    const startedAt = now(), events = [], sizes = [], encoder = new TextEncoder();
    let run = 1, sequence = 0, retainedBytes = 0, droppedEvents = 0;
    function record(type, details = {}, context = {}) {
      const event = {sequence: ++sequence, run, at: now(), type: String(type).slice(0, 80), details: bounded(details), state: snapshot(context)};
      const bytes = encoder.encode(JSON.stringify(event)).length;
      // An oversized event must not defeat the memory bound. Its omission is explicit.
      if (bytes > maxBytes) { droppedEvents++; return; }
      events.push(event); sizes.push(bytes); retainedBytes += bytes;
      while (events.length > maxEvents || retainedBytes > maxBytes) {
        events.shift(); retainedBytes -= sizes.shift(); droppedEvents++;
      }
    }
    function startRun(context = {}, reason = 'restart') {
      run++;
      record('run.started', {reason}, context);
    }
    function exportLog(context = {}) {
      return copy({schemaVersion: SCHEMA_VERSION, game: '5525', mode, startedAt, exportedAt: now(), run,
        retention: {maxEvents, maxBytes, retainedBytes, droppedEvents, firstRetainedSequence: events[0]?.sequence ?? null, lastSequence: sequence},
        current: snapshot(context), events});
    }
    return {record, startRun, export: exportLog};
  }
  return {create, snapshot, SCHEMA_VERSION, DEFAULT_MAX_EVENTS, DEFAULT_MAX_BYTES};
})();
if (typeof module !== 'undefined') module.exports = PlayLog;
