"""Fetch one verified game revision from GitHub and publish it to the user cache."""
from contextlib import contextmanager
import hashlib
import http.client
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
import tempfile
import time
import urllib.request

REPOSITORY = 'wildfire13/5525'
API = f'https://api.github.com/repos/{REPOSITORY}'
SHA = re.compile(r'[0-9a-f]{40}')
ENTRY_FILES = {
    'native/campaign.js', 'native/campaign-battle.js', 'native/equipment-slots.js',
    'native/equipment-skills.js', 'native/journey.js', 'native/master_data.py',
    'native/data/master.sqlite', 'native/data/master-source.json',
}
# The official Node code uses literal relative imports. The DB reader is invoked
# as a Python subprocess, so its script and data files are explicit entry points.
REQUIRE = re.compile(rb"""\brequire\(\s*['"](\./[\w./-]+)['"]\s*\)""")


class GameSourceError(ValueError):
    pass


def cache_directory():
    configured = os.environ.get('SAVE_LAB_CACHE_DIR')
    return Path(configured).expanduser().resolve() if configured else Path.home()/'.cache'/'5525-save-lab'


def _get(url, limit):
    request = urllib.request.Request(url, headers={'User-Agent': '5525-save-lab', 'Accept': '*/*'})
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            data = response.read(limit + 1)
    except (OSError, http.client.HTTPException) as exc:
        raise GameSourceError(f"GitHubから取得できません: {exc}") from exc
    if len(data) > limit:
        raise GameSourceError('ゲーム参照のファイルが取得上限を超えました')
    return data


def _head():
    data = json.loads(_get(f'{API}/git/ref/heads/main', 65536))
    ref = data.get('object') if isinstance(data, dict) else None
    sha = ref.get('sha') if isinstance(ref, dict) else None
    if not isinstance(sha, str) or not SHA.fullmatch(sha):
        raise GameSourceError('GitHub main のコミットIDが不正です')
    return sha


def _valid_path(name):
    return isinstance(name, str) and name.startswith('native/') and all(
        re.fullmatch(r'[A-Za-z0-9_-][A-Za-z0-9_.-]*', part) for part in name.split('/'))


def _blob(data):
    return hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()


def _download_revision(stage, sha):
    tree = json.loads(_get(f'{API}/git/trees/{sha}?recursive=1', 8 * 1024 * 1024))
    if not isinstance(tree, dict) or tree.get('truncated') or not isinstance(tree.get('tree'), list):
        raise GameSourceError('GitHubのファイル一覧が不完全です')
    files = {e['path']: e for e in tree['tree'] if e.get('type')=='blob' and e.get('mode') in ('100644','100755')}
    todo = list(ENTRY_FILES)
    hashes = {}
    while todo:
        name = todo.pop()
        if name in hashes:
            continue
        entry = files.get(name)
        if not _valid_path(name) or not entry or len(hashes) >= 128:
            raise GameSourceError(f'ゲーム側の必要ファイルを解決できません: {name}')
        size = entry['size']
        if not 0 <= size <= 16 * 1024 * 1024:
            raise GameSourceError(f'ゲーム参照のファイルサイズが不正です: {name}')
        data = _get(f'https://raw.githubusercontent.com/{REPOSITORY}/{sha}/{name}', size)
        if len(data) != size or _blob(data) != entry['sha']:
            raise GameSourceError(f'GitHubの内容ハッシュと一致しません: {name}')
        target = stage / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        hashes[name] = entry['sha']
        if name.endswith(('.js','.cjs')):
            for relative in REQUIRE.findall(data):
                dep = str(PurePosixPath(name).parent / relative.decode('ascii'))
                if dep not in files and dep + '.js' in files:
                    dep += '.js'
                todo.append(dep)
    (stage/'files.json').write_text(json.dumps(hashes, sort_keys=True), encoding='utf-8')


def _verified(revision):
    try:
        hashes = json.loads((revision/'files.json').read_text(encoding='utf-8'))
        return (isinstance(hashes, dict) and ENTRY_FILES <= hashes.keys() and
                all(_valid_path(name) and _blob((revision/name).read_bytes()) == digest
                    for name, digest in hashes.items()))
    except (ValueError, OSError):
        return False


def cached_source():
    cache = cache_directory()
    try:
        sha = json.loads((cache/'active.json').read_text(encoding='utf-8'))['sha']
    except (ValueError, OSError, TypeError, KeyError):
        return None
    if not isinstance(sha,str) or not SHA.fullmatch(sha):
        return None
    revision = cache/'revisions'/sha
    return revision if _verified(revision) else None


def _probe(stage):
    script = """
const {run,sourceSha}=require(process.argv[1]);
const assert=require('node:assert/strict');
const save=run({cmd:'new'});
assert.equal(sourceSha,process.argv[2]);
assert.deepEqual(run({cmd:'normalize',save}).save,save);
assert(run({cmd:'inspect',save}).members.length);
assert(run({cmd:'catalog'}).gear.length);
assert.deepEqual(run({cmd:'edit', save, patch:{gold:save.state.gold}}),save);
assert.equal(run({cmd:'timeline', save}).sourceSha,sourceSha);
const cases=run({cmd:'qa-catalog'}).cases;
assert(cases.length);
assert.equal(run({cmd:'qa-fixtures',options:{caseIds:[cases[0].id]}}).cases.length,1);
"""
    env = {**os.environ, 'SAVE_LAB_SOURCE_DIR': str(stage), 'NATIVE5525_PYTHON': sys.executable,
           'PYTHONUTF8':'1', 'PYTHONDONTWRITEBYTECODE':'1'}
    try:
        result = subprocess.run(
            [env.get('SAVE_LAB_NODE') or 'node', '-e', script,
             str(Path(__file__).with_name('engine.cjs').resolve()), stage.name],
            env=env, capture_output=True, encoding='utf-8', errors='replace', timeout=45)
    except subprocess.TimeoutExpired as exc:
        raise GameSourceError('取得したゲームの動作検証がタイムアウトしました') from exc
    if result.returncode:
        raise GameSourceError('取得したゲームはsave-labの動作検証に失敗しました: ' + result.stderr[-1200:])


@contextmanager
def _writer(cache):
    # The OS releases the lock if an updater crashes. Readers keep using their
    # immutable revision. Resolve main only after acquiring the lock so an older
    # fetch cannot overwrite the result of a more recent one.
    with (cache/'update.lock').open('a+b') as f:
        if os.name == 'nt':
            import msvcrt
            if not f.tell():
                f.write(b'0')
                f.flush()
            deadline = time.monotonic() + 90
            while True:
                f.seek(0)
                try:
                    msvcrt.locking(f.fileno(), msvcrt.LK_NBLCK, 1)
                    break
                except OSError:
                    if time.monotonic() >= deadline:
                        raise GameSourceError('他のsave-labがゲーム参照を更新中です')
                    time.sleep(0.15)
        else:
            import fcntl
            fcntl.flock(f, fcntl.LOCK_EX)
        yield


def _offline():
    return os.environ.get('SAVE_LAB_OFFLINE','').strip().lower() in ('1','true','yes','on')


def ensure_source():
    current = cached_source()
    return current if current else sync_source()


def sync_source():
    if _offline():
        raise GameSourceError('オフライン指定中はゲーム参照を取得できません')
    cache = cache_directory()
    revisions = cache/'revisions'
    revisions.mkdir(parents=True, exist_ok=True)
    with _writer(cache):
        sha = _head()
        target = revisions/sha
        with tempfile.TemporaryDirectory(dir=cache,prefix='stage-') as tmp:
            staging = Path(tmp)
            if not _verified(target):
                stage = staging/sha
                stage.mkdir()
                _download_revision(stage,sha)
                _probe(stage)
                if not _verified(stage):
                    raise GameSourceError('ゲーム参照の検証後にファイルが変わりました')
                damaged = staging/'damaged'
                if target.exists():
                    target.rename(damaged)
                try:
                    stage.rename(target)
                except OSError:
                    if damaged.exists():
                        damaged.rename(target)
                    raise
            else:
                # A previously fetched revision can be reused after a rollback.
                if cached_source() != target:
                    _probe(target)
            pointer = staging/'active.json'
            pointer.write_text(json.dumps({'sha':sha})+'\n',encoding='utf-8')
            os.replace(pointer,cache/'active.json')
        return target
