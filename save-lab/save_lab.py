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
from contextlib import closing

ROOT = Path(__file__).resolve().parent
MAX_BYTES = 1024 * 1024
TOOL_VERSION = '0.1.3'

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

def engine(cmd, **values):
    node = os.environ.get('SAVE_LAB_NODE', '').strip() or shutil.which('node')
    if not node:
        raise LabError('Node.jsが見つかりません。Node.js 18以降をインストールしてください')
    env = os.environ.copy()
    env['NATIVE5525_PYTHON'] = sys.executable
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

def doctor():
    """Headless diagnostics using only runtime probes and an in-memory sample."""
    report = {
        'schema_version': 1, 'tool': '5525 Save Lab', 'version': TOOL_VERSION,
        'ok': True, 'checks': [],
        'runtimes': {'python': {'executable': sys.executable, 'version': sys.version.split()[0]}},
        'constraints': {'max_save_bytes': MAX_BYTES, 'editable_scope': 'unaccepted_town',
                        'overwrites_existing_files': False, 'preserves_godot_metadata': True,
                        'network_requests': False},
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
    if node_ready and report['ok']:
        try:
            sample = engine('new')
            normalized = engine('normalize', save=sample)
            if normalized.get('migrated') or normalized.get('save') != sample:
                raise LabError('人工サンプルの往復結果が一致しません')
            info = engine('inspect', save=normalized['save'])
            report['source_commit'] = info['sourceSha']
            check('engine_roundtrip', 'pass', '人工サンプルの生成・公式検証・再読込が一致しました')
        except (LabError, OSError, ValueError, KeyError, TypeError, AttributeError) as exc:
            check('engine_roundtrip', 'fail', str(exc), 'engine_failed')
            report['next_steps'].append('配布物をフォルダーごと展開し、vendorを含むファイルが揃っているか確認してください')
    else:
        check('engine_roundtrip', 'not_run', '先にランタイムの失敗を解消してください')
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

    def apply(self, patch):
        if self.after is None:
            raise LabError('先にセーブを開いてください')
        candidate = engine('edit', save=self.after, patch=patch)
        info = engine('inspect', save=candidate)
        info['warnings'] = self.import_warnings + info.get('warnings', [])
        self.undo_stack.append(copy.deepcopy(self.after))
        self.after, self.info = candidate, info
        return info

    def undo(self):
        if self.undo_stack:
            self.after = self.undo_stack.pop()
            self.info = engine('inspect', save=self.after)
            self.info['warnings'] = self.import_warnings + self.info.get('warnings', [])
        return self.info

    def reset(self):
        if self.before is not None:
            self.undo_stack.append(copy.deepcopy(self.after))
            self.after = copy.deepcopy(self.before)
            self.info = engine('inspect', save=self.after)
            self.info['warnings'] = self.import_warnings + self.info.get('warnings', [])
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
    parser = argparse.ArgumentParser(description='5525 local save manager. No network, no overwrite.')
    parser.add_argument('--version', action='version', version=f'5525 Save Lab {TOOL_VERSION}')
    sub = parser.add_subparsers(dest='command')
    sub.add_parser('gui', help='ネイティブ画面を開く')
    sub.add_parser('doctor', help='画面やセーブを開かずJSONで環境・公式エンジンを診断')
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
        if args.command == 'catalog':
            result = engine('catalog')
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
        elif args.command == 'compare':
            before, _ = load_json(args.before); after, _ = load_json(args.after)
            result = engine('compare', before=before, after=after)
            if args.out:
                save_new(args.out, result)
        print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))
        return 0
    except (LabError, OSError, ValueError) as exc:
        print(json.dumps({'ok': False, 'error': str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 2

if __name__ == '__main__':
    raise SystemExit(main())
