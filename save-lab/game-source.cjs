'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function activeSnapshot() {
  if (process.env.SAVE_LAB_SOURCE_DIR) return path.resolve(process.env.SAVE_LAB_SOURCE_DIR);
  const cache = process.env.SAVE_LAB_CACHE_DIR || path.join(os.homedir(), '.cache', '5525-save-lab');
  const {sha} = JSON.parse(fs.readFileSync(path.join(cache, 'active.json'), 'utf8'));
  if (typeof sha !== 'string' || !/^[0-9a-f]{40}$/.test(sha)) throw Error('ゲーム参照のコミットIDが不正です');
  return path.resolve(cache, 'revisions', sha);
}

const root = activeSnapshot();
const sourceSha = path.basename(root);
if (!/^[0-9a-f]{40}$/.test(sourceSha)) throw Error('ゲーム参照先に完全なコミットIDが必要です');

function gameModule(filename) {
  return require(path.join(root, 'native', filename));
}

module.exports = {gameModule, sourceSha, repository: 'wildfire13/5525'};
