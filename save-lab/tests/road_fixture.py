"""Create a read-only road save with the active official engine."""
import json
import os
from pathlib import Path
import subprocess
import sys


def road_save():
    root = Path(__file__).resolve().parents[1]
    command = """
const C = require('./game-source.cjs').gameModule('campaign.js');
const state = C.create();
if (!C.depart(state, C.view(state).destinations[0].id)) throw Error('departure failed');
process.stdout.write(C.serialize(state));
"""
    result = subprocess.run([os.environ.get('SAVE_LAB_NODE') or 'node', '-e', command],
                            cwd=root, env={**os.environ, 'NATIVE5525_PYTHON': sys.executable},
                            capture_output=True, text=True, encoding='utf-8', check=True)
    return json.loads(result.stdout)
