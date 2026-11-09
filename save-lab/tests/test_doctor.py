"""Headless diagnostics regression tests; all save data here is artificial."""
import builtins
import copy
from contextlib import ExitStack, redirect_stderr, redirect_stdout
import io
import json
import os
from pathlib import Path
import socket
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
# The whole suite stays offline; individual tests can override this.
os.environ.setdefault('SAVE_LAB_OFFLINE', '1')
import game_source  # noqa: F401  (co-shipped first-party module)
import save_lab


class Doctor(unittest.TestCase):
    SOURCE_COMMIT = 'a' * 40
    SAMPLE = {'version': 1, 'state': {'gold': 0}}
    CHECK_NAMES = {'python_version', 'sqlite_json', 'game_source', 'node_version', 'engine_roundtrip'}

    def setUp(self):
        save_lab.reset_source_pin()
        self.addCleanup(save_lab.reset_source_pin)
        self.real_cached = game_source.cached_source()
        self.environment = patch.dict(os.environ, {
            'SAVE_LAB_NODE': 'test-node', 'SAVE_LAB_SOURCE_DIR': '',
            'SAVE_LAB_OFFLINE': '1',
        })
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.cache = tempfile.TemporaryDirectory()
        self.addCleanup(self.cache.cleanup)
        self.source_path = Path(self.cache.name) / self.SOURCE_COMMIT
        self.source_path.mkdir()
        self.cache_patch = patch.object(save_lab.game_source, 'cache_directory',
                                        return_value=Path(self.cache.name))
        self.cache_patch.start()
        self.addCleanup(self.cache_patch.stop)
        self.cached_patch = patch.object(save_lab.game_source, 'cached_source',
                                         return_value=self.source_path)
        self.cached_patch.start()
        self.addCleanup(self.cached_patch.stop)
        # Doctor must never sync. A stray call fails the test immediately.
        self.sync_mock = MagicMock(side_effect=AssertionError('Doctor must not sync'))
        self.sync_patch = patch.object(save_lab.game_source, 'sync_source', self.sync_mock)
        self.sync_patch.start()
        self.addCleanup(self.sync_patch.stop)
        self.calls = []

    def fake_runtime(self, argv, **options):
        """Emulate only the Node version probe and the official adapter protocol."""
        self.calls.append((copy.deepcopy(argv), copy.deepcopy(options)))
        self.assertIsInstance(argv, list)
        self.assertFalse(options.get('shell', False))
        if argv[1:] == ['--version']:
            return subprocess.CompletedProcess(argv, 0, 'v18.0.0\n', '')
        self.assertEqual(argv[1:], [str(save_lab.ROOT / 'engine.cjs')])
        self.assertEqual(options['env']['NATIVE5525_PYTHON'], sys.executable)
        self.assertEqual(options['env']['SAVE_LAB_SOURCE_DIR'], str(self.source_path))
        request = json.loads(options['input'])
        if request['cmd'] == 'new':
            self.assertEqual(request, {'cmd': 'new'})
            result = copy.deepcopy(self.SAMPLE)
        elif request['cmd'] == 'normalize':
            self.assertEqual(request['save'], self.SAMPLE)
            result = {'save': copy.deepcopy(self.SAMPLE), 'migrated': False, 'warnings': []}
        elif request['cmd'] == 'inspect':
            self.assertEqual(request['save'], self.SAMPLE)
            result = {'sourceSha': self.SOURCE_COMMIT, 'summary': {'editable': True}}
        else:
            self.fail('Doctor must only generate, normalize, and inspect an artificial sample')
        return subprocess.CompletedProcess(argv, 0, json.dumps({'ok': True, 'result': result}), '')

    def assert_report(self, report, ok, source_sha=None):
        self.assertEqual(report['schema_version'], 1)
        self.assertEqual(report['tool'], '5525 Save Lab')
        self.assertEqual(report['version'], save_lab.TOOL_VERSION)
        self.assertIs(report['ok'], ok)
        self.assertEqual({item['name'] for item in report['checks']}, self.CHECK_NAMES)
        self.assertEqual(len(report['checks']), len(self.CHECK_NAMES))
        self.assertTrue(all(item['status'] in ('pass', 'fail', 'not_run') for item in report['checks']))
        self.assertEqual(report['runtimes']['python']['executable'], sys.executable)
        self.assertIsInstance(report['runtimes']['python']['version'], str)
        self.assertEqual(set(report['runtimes']['node']), {'executable', 'version'})
        self.assertEqual(report['gui'], {'tested': False, 'next_step': 'node launch.cjs --diagnose'})
        self.assertIs(report['constraints']['network_requests'], False)
        self.assertEqual(report['constraints']['network_policy']['doctor'], 'no network access')
        self.assertEqual(report['constraints']['network_policy']['skip_automatic_sync'], 'SAVE_LAB_OFFLINE=1')
        self.assertIs(report['constraints']['overwrites_existing_files'], False)
        self.assertIsInstance(report['next_steps'], list)
        self.assertEqual(set(report['source']), {'sha', 'directory', 'origin', 'warning',
                                                 'next_sha', 'revision_changed', 'offline', 'cache'})
        self.assertEqual(json.loads(json.dumps(report, allow_nan=False)), report)
        if ok:
            self.assertTrue(all(item['status'] == 'pass' for item in report['checks']))
            self.assertEqual(report['source']['sha'], source_sha or self.SOURCE_COMMIT)
            self.assertRegex(report['source_commit'], r'^[0-9a-f]{40}$')
            self.assertEqual(report['source_commit'], report['source']['sha'])
            self.assertEqual(report['next_steps'], [])
        else:
            self.assertTrue(any(item['status'] == 'fail' for item in report['checks']))
            self.assertTrue(report['next_steps'])

    def check(self, report, name):
        return next(item for item in report['checks'] if item['name'] == name)

    def call_main(self):
        output, errors = io.StringIO(), io.StringIO()
        with redirect_stdout(output), redirect_stderr(errors):
            status = save_lab.main(['doctor'])
        self.assertEqual(errors.getvalue(), '')
        return status, json.loads(output.getvalue())

    def test_real_headless_cli_succeeds(self):
        if self.real_cached is None:
            self.skipTest('run python save_lab.py sync before integration tests')
        env = os.environ.copy()
        env.pop('SAVE_LAB_NODE', None)
        env.pop('DISPLAY', None)
        env.pop('WAYLAND_DISPLAY', None)
        env['PYTHONDONTWRITEBYTECODE'] = '1'
        env['SAVE_LAB_OFFLINE'] = '1'
        # A missing save location must not matter: doctor does not open saves.
        env['SAVE_LAB_SAVE_DIR'] = str(save_lab.ROOT / 'not-a-real-user-save-directory')
        result = subprocess.run(
            [sys.executable, '-X', 'utf8', '-B', str(save_lab.ROOT / 'save_lab.py'), 'doctor'],
            env=env, capture_output=True, text=True, encoding='utf-8', timeout=60,
        )
        self.assertEqual(result.returncode, 0, f'stdout: {result.stdout!r}\nstderr: {result.stderr!r}')
        self.assertEqual(result.stderr, '')
        self.assert_report(json.loads(result.stdout), True, source_sha=self.real_cached.name)

    def test_real_cli_version_does_not_require_node(self):
        self.assertEqual(save_lab.TOOL_VERSION, '0.4.0')
        env = os.environ.copy()
        env['SAVE_LAB_NODE'] = 'not-an-installed-node-executable'
        env['PYTHONDONTWRITEBYTECODE'] = '1'
        result = subprocess.run(
            [sys.executable, '-X', 'utf8', '-B', str(save_lab.ROOT / 'save_lab.py'), '--version'],
            env=env, capture_output=True, text=True, encoding='utf-8', timeout=10,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), f'5525 Save Lab {save_lab.TOOL_VERSION}')
        self.assertEqual(result.stderr, '')

    def test_successful_cli_report_and_official_roundtrip_order(self):
        with patch.object(save_lab.subprocess, 'run', side_effect=self.fake_runtime):
            status, report = self.call_main()
        self.assertEqual(status, 0)
        self.assert_report(report, True)
        self.assertEqual(report['source_commit'], self.SOURCE_COMMIT)
        self.assertEqual([json.loads(options['input'])['cmd'] for _, options in self.calls[1:]],
                         ['new', 'normalize', 'inspect'])

    def test_missing_node_has_stable_json_failure_and_does_not_run_engine(self):
        with patch.dict(os.environ, {'SAVE_LAB_NODE': ''}), \
                patch.object(save_lab.shutil, 'which', return_value=None), \
                patch.object(save_lab.subprocess, 'run') as run, \
                patch.object(save_lab, 'engine') as engine:
            status, report = self.call_main()
            repeated_status, repeated_report = self.call_main()
        self.assertEqual(status, 2)
        self.assertEqual(repeated_status, 2)
        self.assertEqual(repeated_report, report)
        self.assert_report(report, False)
        self.assertEqual(self.check(report, 'node_version')['code'], 'node_not_found')
        self.assertEqual(self.check(report, 'engine_roundtrip')['status'], 'not_run')
        self.assertEqual(report['runtimes']['node'], {'executable': None, 'version': None})
        run.assert_not_called()
        engine.assert_not_called()

    def test_broken_node_reports_probe_failure(self):
        failures = [FileNotFoundError('synthetic missing runtime'),
                    PermissionError('synthetic non-executable runtime'),
                    subprocess.TimeoutExpired(['test-node', '--version'], 5),
                    subprocess.CompletedProcess([], 1, '', 'synthetic startup failure'),
                    subprocess.CompletedProcess([], 0, 'not a version', '')]
        for failure in failures:
            with self.subTest(failure=repr(failure)):
                options = {'side_effect': failure} if isinstance(failure, Exception) else {'return_value': failure}
                with patch.object(save_lab.subprocess, 'run', **options), \
                        patch.object(save_lab, 'engine') as engine:
                    status, report = self.call_main()
                self.assertEqual(status, 2)
                self.assert_report(report, False)
                self.assertEqual(self.check(report, 'node_version')['code'], 'node_probe_failed')
                self.assertEqual(self.check(report, 'engine_roundtrip')['status'], 'not_run')
                engine.assert_not_called()

    def test_old_node_is_rejected_without_running_engine(self):
        for version in ('v17.9.0', 'v16.20.2'):
            with self.subTest(version=version):
                with patch.object(save_lab.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, version, '')), \
                        patch.object(save_lab, 'engine') as engine:
                    report = save_lab.doctor()
                self.assert_report(report, False)
                self.assertEqual(self.check(report, 'node_version')['code'], 'node_version_unsupported')
                self.assertEqual(report['runtimes']['node']['version'], version)
                engine.assert_not_called()

    def test_explicit_node_path_has_precedence_and_stays_literal_without_shell(self):
        literal = '/synthetic/日本語 Node & $(not-a-command);node'
        with patch.dict(os.environ, {'SAVE_LAB_NODE': literal}), \
                patch.object(save_lab.shutil, 'which') as which, \
                patch.object(save_lab.subprocess, 'run', side_effect=self.fake_runtime):
            report = save_lab.doctor()
        self.assert_report(report, True)
        self.assertEqual(report['runtimes']['node']['executable'], literal)
        self.assertEqual(len(self.calls), 4)
        self.assertTrue(all(argv[0] == literal for argv, _ in self.calls))
        which.assert_not_called()

    def test_blank_override_uses_path_discovered_node(self):
        with patch.dict(os.environ, {'SAVE_LAB_NODE': '  '}), \
                patch.object(save_lab.shutil, 'which', return_value='/synthetic/path/node') as which, \
                patch.object(save_lab.subprocess, 'run', side_effect=self.fake_runtime):
            report = save_lab.doctor()
        self.assert_report(report, True)
        self.assertEqual(report['runtimes']['node']['executable'], '/synthetic/path/node')
        self.assertTrue(all(argv[0] == '/synthetic/path/node' for argv, _ in self.calls))
        self.assertTrue(all(call.args == ('node',) for call in which.call_args_list))

    def test_engine_error_remains_json_stdout_and_exit_two(self):
        for failure in (save_lab.LabError('synthetic engine failure'), OSError('synthetic adapter missing')):
            with self.subTest(failure=repr(failure)):
                with patch.object(save_lab.subprocess, 'run', side_effect=self.fake_runtime), \
                        patch.object(save_lab, 'engine', side_effect=failure):
                    status, report = self.call_main()
                self.assertEqual(status, 2)
                self.assert_report(report, False)
                self.assertEqual(self.check(report, 'engine_roundtrip')['code'], 'engine_failed')
                self.assertNotIn('source_commit', report)

    def test_invalid_engine_process_response_stays_structured(self):
        for response in ('not JSON', '[]', 'null', '{"ok":true}'):
            with self.subTest(response=response):
                def run(argv, **options):
                    if argv[1:] == ['--version']:
                        return self.fake_runtime(argv, **options)
                    return subprocess.CompletedProcess(argv, 0, response, '')
                with patch.object(save_lab.subprocess, 'run', side_effect=run):
                    status, report = self.call_main()
                self.assertEqual(status, 2)
                self.assert_report(report, False)
                self.assertEqual(self.check(report, 'engine_roundtrip')['code'], 'engine_failed')

    def test_changed_or_migrated_synthetic_roundtrip_is_failure(self):
        for normalized in ({'save': {'different': True}, 'migrated': False},
                           {'save': copy.deepcopy(self.SAMPLE), 'migrated': True}):
            with self.subTest(normalized=normalized):
                with patch.object(save_lab.subprocess, 'run', side_effect=self.fake_runtime), \
                        patch.object(save_lab, 'engine', side_effect=[copy.deepcopy(self.SAMPLE), normalized]) as engine:
                    report = save_lab.doctor()
                self.assert_report(report, False)
                self.assertEqual(self.check(report, 'engine_roundtrip')['code'], 'engine_failed')
                self.assertEqual(engine.call_count, 2)

    def test_python_below_minimum_skips_engine(self):
        with patch.object(sys, 'version_info', (3, 9, 19)), \
                patch.object(save_lab.subprocess, 'run', side_effect=self.fake_runtime), \
                patch.object(save_lab, 'engine') as engine:
            report = save_lab.doctor()
        self.assert_report(report, False)
        self.assertEqual(self.check(report, 'python_version')['code'], 'python_version_unsupported')
        self.assertEqual(self.check(report, 'engine_roundtrip')['status'], 'not_run')
        engine.assert_not_called()

    def test_sqlite_probe_only_opens_in_memory_database(self):
        with patch.object(sqlite3, 'connect', wraps=sqlite3.connect) as connect, \
                patch.object(save_lab.subprocess, 'run', side_effect=self.fake_runtime):
            report = save_lab.doctor()
        self.assert_report(report, True)
        connect.assert_called_once_with(':memory:')

    def test_sqlite_json_unavailable_skips_engine(self):
        with patch.object(sqlite3, 'connect', side_effect=sqlite3.OperationalError('no such function: json_valid')), \
                patch.object(save_lab.subprocess, 'run', side_effect=self.fake_runtime), \
                patch.object(save_lab, 'engine') as engine:
            status, report = self.call_main()
        self.assertEqual(status, 2)
        self.assert_report(report, False)
        self.assertEqual(self.check(report, 'sqlite_json')['code'], 'sqlite_json_unavailable')
        self.assertEqual(self.check(report, 'engine_roundtrip')['status'], 'not_run')
        engine.assert_not_called()

    def test_no_cache_is_actionable_and_skips_engine(self):
        with patch.object(save_lab.game_source, 'cached_source', return_value=None), \
                patch.object(save_lab, 'engine') as engine:
            status, report = self.call_main()
        self.assertEqual(status, 2)
        self.assert_report(report, False)
        self.assertEqual(self.check(report, 'game_source')['code'], 'game_source_unavailable')
        self.assertIsNone(report['source']['sha'])
        self.assertEqual(self.check(report, 'engine_roundtrip')['status'], 'not_run')
        self.assertTrue(any('sync' in step for step in report['next_steps']))
        engine.assert_not_called()
        self.sync_mock.assert_not_called()

    def test_doctor_does_not_open_save_files_write_files_import_gui_or_use_network(self):
        original_import = builtins.__import__

        def headless_import(name, *args, **kwargs):
            if name.split('.')[0] in ('ui', 'tkinter'):
                self.fail('Doctor must not import the GUI')
            return original_import(name, *args, **kwargs)

        with ExitStack() as stack:
            stack.enter_context(patch.object(save_lab.subprocess, 'run', side_effect=self.fake_runtime))
            stack.enter_context(patch.object(builtins, '__import__', side_effect=headless_import))
            stack.enter_context(patch.dict(os.environ, {'SAVE_LAB_SAVE_DIR': '/synthetic/private-saves'}))
            for target, name in ((save_lab, 'load_json'), (save_lab, 'save_new'),
                                 (save_lab, 'configured_save_directory'), (save_lab, 'Workspace'),
                                 (builtins, 'open'), (Path, 'open'), (Path, 'write_text'),
                                 (Path, 'write_bytes'), (os, 'open'), (socket, 'socket'),
                                 (socket, 'create_connection')):
                stack.enter_context(patch.object(target, name, side_effect=AssertionError(f'Unexpected access: {name}')))
            report = save_lab.doctor()
        self.assert_report(report, True)
        self.sync_mock.assert_not_called()


if __name__ == '__main__':
    unittest.main()
