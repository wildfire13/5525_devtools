'use strict';

const {gameModule} = require('./game-source.cjs');
const campaign = gameModule('campaign.js');

function verifyRoundtrip(state, mismatchMessage) {
  const validation = campaign.validate(state);
  if (!validation.ok) throw Error(validation.error);

  const raw = campaign.serialize(state);
  const reloaded = campaign.deserialize(raw);
  if (campaign.serialize(reloaded) !== raw) throw Error(mismatchMessage);
  return {raw, reloaded};
}

module.exports = {verifyRoundtrip};
