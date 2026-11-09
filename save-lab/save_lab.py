"""5525 Save Lab: local files only, native GUI and agent-friendly CLI."""
from __future__ import annotations
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import re
import time
from contextlib import closing
import game_source
from game_source import offline_mode

ROOT = Path(__file__).resolve().parent
MAX_BYTES = 1024 * 1024
TOOL_VERSION = '0.4.0'
# CLI auto-update checks the network only when active.json is older than this.
# GUI launches always check once before the first catalog. SAVE_LAB_OFFLINE=1
# disables automatic network access for tests and offline use.
SOURCE_REFRESH_SECONDS = 24 * 60 * 60

class LabError(ValueError):
    pass

def reject_constant(value):
    raise LabError(f'JSONに非有限値は使えません: {value}')

def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise LabError(f'JSONに重複キーがあります: {key}')
        result[key] = value
    return result

def parse_json(text):
    try:
        return json.loads(text, parse_constant=reject_constant, object_pairs_hook=unique_object)
    except (ValueError, RecursionError) as exc:
        raise LabError(f'JSONを読み込めません: {exc}') from exc

def load_json(path):
    source = Path(path).expanduser()
    with source.open('rb') as handle:
        raw = handle.read(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES:
        raise LabError('対応ファイルは1 MiB以下です')
    try:
        value = parse_json(raw.decode('utf-8-sig'))
    except UnicodeError as exc:
        raise LabError('UTF-8のJSONファイルを選択してください') from exc
    return value, hashlib.sha256(raw).hexdigest()

def configured_save_directory():
    """Optional dialog starting directory, without selecting or reading a save."""
    directory = os.environ.get('SAVE_LAB_SAVE_DIR', '').strip()
    config_path = ROOT / 'save-lab.local.json'
    if not directory and config_path.exists():
        if config_path.stat().st_size > 4096:
            raise LabError('save-lab.local.jsonは4 KiB以内で指定してください')
        config = parse_json(config_path.read_text(encoding='utf-8-sig'))
        if not isinstance(config, dict) or any(k not in ('python', 'saveDirectory') or not isinstance(v, str) or any(c in v for c in ('\r', '\n', '\0')) for k, v in config.items()):
            raise LabError('save-lab.local.jsonには文字列のpythonとsaveDirectoryを指定してください')
        directory = config.get('saveDirectory', '').strip()
    if not directory:
        return None
    target = Path(directory).expanduser()
    if not target.is_absolute():
        target = ROOT / target
    if not target.is_dir():
        raise LabError(f'設定したセーブフォルダが見つかりません: {target}')
    return str(target.resolve())

def source_sha(path):
    """game-source.cjs and game_source.py name each checkout after its SHA."""
    name = Path(path).expanduser().resolve().name
    if not game_source.SHA.fullmatch(name):
        raise LabError(f'ゲームソースのフォルダー名が40桁のコミットIDではありません: {path}')
    return name

def cache_is_fresh():
    """CLI-only 24h TTL; GUI launches pass ttl=False and always check once."""
    try:
        age = time.time() - (Path(game_source.cache_directory()).expanduser() / 'active.json').stat().st_mtime
    except OSError:
        return False
    return 0 <= age < SOURCE_REFRESH_SECONDS

_PIN = None
_SOURCE_ERROR = None

def reset_source_pin():
    """Test hook: forget this process's pin and any cached failure."""
    global _PIN, _SOURCE_ERROR
    _PIN = None
    _SOURCE_ERROR = None

def _pin_source(path, origin, warning=None):
    directory = Path(path).expanduser().resolve()
    if not directory.is_dir():
        raise LabError(f'ゲームソースのフォルダーが見つかりません: {directory}')
    return {'directory': str(directory), 'sha': source_sha(directory),
            'origin': origin, 'warning': warning}


def ensure_pinned_source(auto_sync=True, ttl=True):
    """Resolve and freeze one verified revision for this Python process.

    The first call may sync once. Later calls never change revision, even after
    a manual sync publishes a new active.json for the next launch.
    """
    global _PIN, _SOURCE_ERROR
    if _PIN is not None:
        return dict(_PIN)
    if _SOURCE_ERROR is not None:
        raise LabError(_SOURCE_ERROR)
    try:
        _PIN = _resolve_source(auto_sync=auto_sync, ttl=ttl)
    except LabError as exc:
        _SOURCE_ERROR = str(exc)
        raise
    return dict(_PIN)

def _resolve_source(auto_sync, ttl):
    cached = game_source.cached_source()
    if cached is not None:
        cached = Path(cached).expanduser()
    if offline_mode():
        if cached is not None:
            sha = source_sha(cached)
            return _pin_source(cached, 'cache',
                               f'オフライン指定 (SAVE_LAB_OFFLINE=1) のため最新確認をしていません。使用中 {sha[:8]}')
        raise LabError('オフライン指定 (SAVE_LAB_OFFLINE=1) で利用できる検証済みキャッシュがありません。'
                       'ネット接続できる場所で「python save_lab.py sync」を実行してから再試行してください')
    if auto_sync and not (ttl and cached is not None and cache_is_fresh()):
        try:
            path = game_source.sync_source()
        except Exception as exc:
            if cached is not None:
                sha = source_sha(cached)
                return _pin_source(cached, 'cache',
                                   f'最新のゲーム更新を確認できませんでした。検証済みキャッシュ {sha[:8]} を使用します（{exc}）')
            raise LabError('ゲームソースを準備できませんでした。最新確認に失敗し、検証済みキャッシュもありません。'
                           f'（{exc}）ネット接続を確認して「python save_lab.py sync」を実行してください') from exc
        return _pin_source(path, 'sync')
    if cached is not None:
        return _pin_source(cached, 'cache')
    raise LabError('検証済みゲームソースのキャッシュがありません。'
                   '「python save_lab.py sync」で最新ソースを取得するか、'
                   '「python save_lab.py doctor」で配布物とネット接続を確認してください')

def source_state():
    """Pinned revision plus the published next-launch revision, if different."""
    if _PIN is None:
        return None
    state = dict(_PIN)
    cached = game_source.cached_source()
    cached = Path(cached).expanduser() if cached is not None else None
    state['next_sha'] = source_sha(cached) if cached is not None else state['sha']
    state['revision_changed'] = state['next_sha'] != state['sha']
    state['offline'] = offline_mode()
    state['cache'] = str(Path(game_source.cache_directory()).expanduser().resolve())
    return state

def sync_source_now():
    """Explicit online sync. Publishes for the next launch, never repins this process."""
    if offline_mode():
        raise LabError('SAVE_LAB_OFFLINE=1 のためゲームソースを同期しません。'
                       'オンラインで更新する場合は SAVE_LAB_OFFLINE を解除してから再実行してください')
    before = game_source.cached_source()
    before_sha = source_sha(before) if before is not None else None
    path = game_source.sync_source()
    sha = source_sha(path)
    after = game_source.cached_source()
    after_sha = source_sha(after) if after is not None else None
    return {'sourceSha': sha, 'sourceDir': str(Path(path).expanduser().resolve()),
            'directory': str(Path(path).expanduser().resolve()),
            'previousSha': before_sha, 'nextSha': after_sha or sha,
            'changed': before_sha != sha, 'published': after_sha == sha,
            'cache': str(Path(game_source.cache_directory()).expanduser().resolve())}

def engine(cmd, **values):
    source = ensure_pinned_source()
    node = os.environ.get('SAVE_LAB_NODE', '').strip() or shutil.which('node')
    if not node:
        raise LabError('Node.jsが見つかりません。Node.js 18以降をインストールしてください')
    env = os.environ.copy()
    env['NATIVE5525_PYTHON'] = sys.executable
    env['SAVE_LAB_SOURCE_DIR'] = source['directory']
    try:
        run = subprocess.run([node, str(ROOT / 'engine.cjs')], input=json.dumps({'cmd': cmd, **values}, ensure_ascii=False, allow_nan=False), text=True, encoding='utf-8', capture_output=True, cwd=ROOT, env=env, timeout=30)
    except subprocess.TimeoutExpired as exc:
        raise LabError('検証が30秒以内に完了しませんでした。変更は保存していません') from exc
    try:
        response = json.loads(run.stdout)
    except ValueError as exc:
        raise LabError(f'検証エンジンの起動に失敗しました: {run.stderr[-1200:]}') from exc
    if run.returncode or not response.get('ok'):
        raise LabError(response.get('error', '検証に失敗しました'))
    return response['result']

def save_new(path, value):
    """Never truncate, replace, or follow an existing output file/symlink."""
    destination = Path(path).expanduser()
    text = json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + '\n'
    # O_EXCL refuses files, symlinks and hard links. No --force mode exists.
    try:
        with destination.open('x', encoding='utf-8', newline='\n') as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
    except FileExistsError as exc:
        raise LabError('同名ファイルが存在します。原本・既存ファイルは上書きしません。別の名前を指定してください') from exc
    return str(destination.resolve())

def export_qa_bundle(path, case_ids=None):
    """Fresh synthetic data only. Never reads Workspace, imported saves or profiles."""
    options = {} if case_ids is None else {'caseIds': case_ids}
    bundle = engine('qa-fixtures', options=options)
    destination = Path(path).expanduser()
    # Exclusive directory creation also refuses existing directories and symlinks.
    try:
        destination.mkdir()
    except FileExistsError as exc:
        raise LabError('保存先は新規フォルダにしてください。既存フォルダや本番セーブには書き込みません') from exc
    marker = destination / 'INCOMPLETE-TEST-ONLY.txt'
    marker.write_text('生成未完了。このフォルダのセーブを使用しないでください。\n', encoding='utf-8')
    cases = []
    try:
        for item in bundle['cases']:
            filename = f'TEST-ONLY.{item["case"]["id"]}.json'
            target = destination / filename
            save_new(target, item['save'])
            digest = hashlib.sha256(target.read_bytes()).hexdigest()
            cases.append({'filename': filename, 'sha256': digest, **item['report']})
        manifest = {k: v for k, v in bundle.items() if k != 'cases'}
        manifest.update({'toolVersion': TOOL_VERSION, 'complete': True, 'cases': cases})
        save_new(destination / 'fixture-manifest.json', manifest)
        with (destination / 'README-TEST-ONLY.txt').open('x', encoding='utf-8') as handle:
            handle.write('5525 人工QAセーブ / TEST ONLY\n\n'
                         + '\n'.join(bundle['assumptions'])
                         + '\n\n参照SHA: ' + bundle['sourceSha']
                         + '\n各ケースの条件・納品実処理・SHA-256はfixture-manifest.jsonを参照してください。'
                         + '\n実画面の合格を示すデータではありません。元のセーブとは別のテスト用プロフィールで確認してください。\n')
        marker.unlink()
    except (OSError, ValueError):
        # Leave the explicit incomplete marker, never remove or overwrite user files.
        raise
    return {'saved_directory': str(destination.resolve()), 'case_count': len(cases),
            'sourceSha': bundle['sourceSha'], 'synthetic': True, 'testOnly': True,
            'gameUi': 'not_run', 'manifest': str((destination / 'fixture-manifest.json').resolve())}

def doctor():
    """Headless diagnostics using only runtime probes and an in-memory sample."""
    report = {
        'schema_version': 1, 'tool': '5525 Save Lab', 'version': TOOL_VERSION,
        'ok': True, 'checks': [],
        'runtimes': {'python': {'executable': sys.executable, 'version': sys.version.split()[0]}},
        'constraints': {'max_save_bytes': MAX_BYTES, 'editable_scope': 'unaccepted_town',
                        'overwrites_existing_files': False, 'preserves_godot_metadata': True,
                        'network_requests': False,
                        'network_policy': {
                            'doctor': 'no network access',
                            'gui_launch': 'one game-source update check before the first catalog',
                            'cli_first_engine': 'one check per process; active.json newer than 24h skips it',
                            'skip_automatic_sync': 'SAVE_LAB_OFFLINE=1',
                            'manual_sync': 'python save_lab.py sync / GUI update button',
                        }},
        'gui': {'tested': False, 'next_step': 'node launch.cjs --diagnose'},
        'next_steps': [],
    }
    def check(name, status, detail, code=None):
        item = {'name': name, 'status': status, 'detail': detail}
        if code:
            item['code'] = code
        report['checks'].append(item)
        if status == 'fail':
            report['ok'] = False
    if sys.version_info >= (3, 10):
        check('python_version', 'pass', sys.version.split()[0])
    else:
        check('python_version', 'fail', 'Python 3.10以上が必要です', 'python_version_unsupported')
        report['next_steps'].append('Python 3.10以上の実体で実行してください')
    sqlite_errors = (ImportError, OSError, ValueError)
    try:
        import sqlite3
        sqlite_errors += (sqlite3.Error,)
        with closing(sqlite3.connect(':memory:')) as connection:
            if connection.execute("SELECT json_valid('{}')").fetchone()[0] != 1:
                raise ValueError('SQLite JSON validation failed')
        check('sqlite_json', 'pass', sqlite3.sqlite_version)
    except sqlite_errors as exc:
        check('sqlite_json', 'fail', str(exc), 'sqlite_json_unavailable')
        report['next_steps'].append('SQLiteのJSON機能を備えたPython実体を指定してください')
    source = None
    try:
        # Doctor must not sync: it only inspects a verified cache.
        source = ensure_pinned_source(auto_sync=False)
        state = source_state()
        report['source'] = {'sha': state['sha'], 'directory': state['directory'],
                            'origin': state['origin'], 'warning': state['warning'],
                            'next_sha': state['next_sha'],
                            'revision_changed': state['revision_changed'],
                            'offline': state['offline'], 'cache': state['cache']}
        detail = f'{state["sha"][:8]} ({state["origin"]})'
        if state['warning']:
            detail += ' / ' + state['warning']
        check('game_source', 'pass', detail)
        if state['revision_changed']:
            report['next_steps'].append('次回起動で新しいゲームソースが使われます。現在の作業を保存してから再起動してください')
    except (LabError, OSError, ValueError) as exc:
        check('game_source', 'fail', str(exc), 'game_source_unavailable')
        report['source'] = {'sha': None, 'directory': None, 'origin': None, 'warning': str(exc),
                            'next_sha': None, 'revision_changed': False,
                            'offline': offline_mode(),
                            'cache': str(Path(game_source.cache_directory()).expanduser().resolve())}
        report['next_steps'].append('ネット接続を確認し「python save_lab.py sync」で検証済みゲームソースを取得してください')
        report['next_steps'].append('オフラインで既存キャッシュを使う場合は SAVE_LAB_OFFLINE=1 を設定してください')
    node = os.environ.get('SAVE_LAB_NODE', '').strip() or shutil.which('node')
    report['runtimes']['node'] = {'executable': node, 'version': None}
    node_ready = False
    if not node:
        check('node_version', 'fail', 'Node.jsが見つかりません', 'node_not_found')
        report['next_steps'].append('既存Node.js 18以上の実体をSAVE_LAB_NODEに指定してください')
    else:
        try:
            probe = subprocess.run([node, '--version'], capture_output=True, text=True,
                                   encoding='utf-8', timeout=5, shell=False)
            version = probe.stdout.strip()
            match = re.fullmatch(r'v(\d+)\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?', version)
            if probe.returncode or not match:
                raise ValueError((probe.stderr or probe.stdout or 'Node.js version probe failed')[-1000:])
            report['runtimes']['node']['version'] = version
            if int(match.group(1)) < 18:
                check('node_version', 'fail', version, 'node_version_unsupported')
                report['next_steps'].append('Node.js 18以上の実体を指定してください')
            else:
                check('node_version', 'pass', version)
                node_ready = True
        except (OSError, subprocess.SubprocessError, ValueError) as exc:
            check('node_version', 'fail', str(exc), 'node_probe_failed')
            report['next_steps'].append('SAVE_LAB_NODEのパスと実行可否を確認してください。自動インストールは行いません')
    if node_ready and report['ok'] and source is not None:
        try:
            sample = engine('new')
            normalized = engine('normalize', save=sample)
            if normalized.get('migrated') or normalized.get('save') != sample:
                raise LabError('人工サンプルの往復結果が一致しません')
            info = engine('inspect', save=normalized['save'])
            if info.get('sourceSha') != source['sha']:
                raise LabError(f'検証エンジンの参照SHAが一致しません: {info.get("sourceSha")} / {source["sha"]}')
            report['source_commit'] = info['sourceSha']
            check('engine_roundtrip', 'pass', '人工サンプルの生成・公式検証・再読込が一致しました')
        except (LabError, OSError, ValueError, KeyError, TypeError, AttributeError) as exc:
            check('engine_roundtrip', 'fail', str(exc), 'engine_failed')
            report['next_steps'].append('配布物をフォルダーごと展開し、game_source.py・game-source.cjs・native が揃っているか確認してください')
    else:
        check('engine_roundtrip', 'not_run', '先にランタイムまたはゲームソースの失敗を解消してください')
    return report

class Workspace:
    def __init__(self):
        self.source_path = None
        self.source_hash = None
        self.before = None
        self.after = None
        self.info = None
        self.undo_stack = []
        self.import_warnings = []

    def open(self, path):
        save, digest = load_json(path)
        normalized = engine('normalize', save=save)
        save = normalized['save']
        info = engine('inspect', save=save)
        self.import_warnings = normalized.get('warnings', [])
        info['warnings'] = self.import_warnings + info.get('warnings', [])
        self.source_path = Path(path).resolve()
        self.source_hash = digest
        self.before = copy.deepcopy(save)
        self.after = copy.deepcopy(save)
        self.info = info
        self.undo_stack = []
        return info

    def sample(self):
        save = engine('new')
        info = engine('inspect', save=save)
        self.source_path = self.source_hash = None
        self.import_warnings = []
        self.before = copy.deepcopy(save)
        self.after = copy.deepcopy(save)
        self.info = info
        self.undo_stack = []
        return info

    def _inspect_work(self, save):
        info = engine('inspect', save=save)
        info['warnings'] = self.import_warnings + info.get('warnings', [])
        return info

    def apply(self, patch):
        if self.after is None:
            raise LabError('先にセーブを開いてください')
        candidate = engine('edit', save=self.after, patch=patch)
        info = self._inspect_work(candidate)
        self.undo_stack.append(copy.deepcopy(self.after))
        self.after, self.info = candidate, info
        return info

    def undo(self):
        if self.undo_stack:
            info = self._inspect_work(self.undo_stack[-1])
            self.after = self.undo_stack.pop()
            self.info = info
        return self.info

    def reset(self):
        if self.before is not None:
            info = self._inspect_work(self.before)
            self.undo_stack.append(copy.deepcopy(self.after))
            self.after = copy.deepcopy(self.before)
            self.info = info
        return self.info

    def compare(self):
        return engine('compare', before=self.before, after=self.after)

    def export(self, path):
        if self.after is None:
            raise LabError('先にセーブを開いてください')
        if self.source_path:
            if Path(path).expanduser().resolve() == self.source_path:
                raise LabError('原本には保存できません。別名を指定してください')
            _, digest = load_json(self.source_path)
            if digest != self.source_hash:
                raise LabError('読込後に原本が変更されています。再度読み込んでから作業してください')
        # Validate immediately before new-file write.
        engine('inspect', save=self.after)
        return save_new(path, self.after)

def main(argv=None):
    parser = argparse.ArgumentParser(description='5525 local save manager with automatic game-source updates.')
    parser.add_argument('--version', action='version', version=f'5525 Save Lab {TOOL_VERSION}')
    sub = parser.add_subparsers(dest='command')
    sub.add_parser('gui', help='ネイティブ画面を開く')
    sub.add_parser('doctor', help='画面やセーブを開かずJSONで環境・公式エンジンを診断')
    sub.add_parser('sync', help='最新のゲームソースを取得し、次回起動用に公開')
    sub.add_parser('catalog', help='装備・スキルのマスター情報')
    p = sub.add_parser('sample', help='公式エンジンで新規サンプルを生成')
    p.add_argument('--out', required=True)
    for name in ('inspect', 'validate'):
        p = sub.add_parser(name)
        p.add_argument('save')
    p = sub.add_parser('edit', help='制限付きJSONパッチを適用し別名保存')
    p.add_argument('save'); p.add_argument('--patch', required=True); p.add_argument('--out', required=True)
    p = sub.add_parser('compare')
    p.add_argument('before'); p.add_argument('after'); p.add_argument('--out')
    p = sub.add_parser('qa-fixtures', help='実セーブを使わず人工QAセーブを新規フォルダへ生成')
    p.add_argument('--out-dir', required=True)
    p.add_argument('--case', dest='case_ids', action='append', help='qa-catalogの既定ケースID。省略時は全件')
    sub.add_parser('qa-catalog', help='人工QAの既定ケース一覧。実セーブは読みません')
    p = sub.add_parser('boundaries', help='独立コピーで時間境界を一括比較')
    p.add_argument('save'); p.add_argument('--quest', dest='questId'); p.add_argument('--carrier', dest='carrierId')
    p.add_argument('--destination'); p.add_argument('--advance-hours', type=int, default=0)
    p.add_argument('--out')
    p = sub.add_parser('timeline', help='独立コピーでクエスト時間・条件を検証しJSON表示')
    p.add_argument('save'); p.add_argument('--quest', dest='questId'); p.add_argument('--carrier', dest='carrierId')
    p.add_argument('--destination'); p.add_argument('--advance-hours', type=int, default=0)
    p.add_argument('--out', help='検証レポートの別名保存。セーブは出力しません')
    args = parser.parse_args(argv)
    try:
        if args.command in (None, 'gui'):
            try:
                from ui import run_gui
            except ImportError as exc:
                raise LabError('GUIにはPythonのTkが必要です。Tk対応Pythonで起動するか、CLIを使用してください') from exc
            run_gui()
            return 0
        if args.command == 'doctor':
            result = doctor()
            print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))
            return 0 if result['ok'] else 2
        if args.command == 'sync':
            result = sync_source_now()
            if not result['published']:
                raise LabError('同期は完了しましたが、次回起動用の active.json が同じSHAに更新されていません')
        elif args.command in ('catalog', 'qa-catalog'):
            result = engine(args.command)
        elif args.command == 'qa-fixtures':
            result = export_qa_bundle(args.out_dir, args.case_ids)
        elif args.command == 'sample':
            work = Workspace(); work.sample()
            result = {'saved': work.export(args.out), 'validation': 'official engine passed'}
        elif args.command in ('inspect', 'validate'):
            work = Workspace(); result = work.open(args.save)
            if args.command == 'validate':
                result = {'valid': True, 'sha256': work.source_hash, 'summary': result['summary'], 'warnings': result.get('warnings', [])}
        elif args.command == 'edit':
            work = Workspace(); work.open(args.save)
            patch, _ = load_json(args.patch); work.apply(patch)
            result = {'saved': work.export(args.out), 'comparison': work.compare(), 'source_sha256': work.source_hash}
        elif args.command in ('timeline', 'boundaries'):
            save, digest = load_json(args.save)
            options = {k: getattr(args, k) for k in ('questId', 'carrierId', 'destination') if getattr(args, k)}
            options['advanceHours'] = args.advance_hours
            result = engine(args.command, save=save, options=options)
            result['source_sha256'] = digest
            if args.out:
                save_new(args.out, result)
        elif args.command == 'compare':
            before, _ = load_json(args.before); after, _ = load_json(args.after)
            result = engine('compare', before=before, after=after)
            if args.out:
                save_new(args.out, result)
        if _PIN and _PIN.get('warning') and not offline_mode():
            print(_PIN['warning'], file=sys.stderr)
        print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))
        return 0
    except (LabError, OSError, ValueError) as exc:
        print(json.dumps({'ok': False, 'error': str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 2

if __name__ == '__main__':
    raise SystemExit(main())
