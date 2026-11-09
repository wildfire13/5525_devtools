"""Offline regression tests for save-lab's upstream game source fetcher.

save-lab/game_source.py has three deliberate integration points and every test
here uses only them as its mocking boundary (no HTTP, no Node runtime):

- ``_head()``                       remote main SHA, resolved inside sync
- ``_download_revision(stage, sha)`` fills a SHA-named staging tree
- ``_probe(stage)``                 pre-publish engine gate on `stage`

Asserted public behavior: ``cache_directory()`` (SAVE_LAB_CACHE_DIR override,
default ``~/.cache/5525-save-lab``), offline-only ``cached_source()``,
``ensure_source()`` fast path/bootstrap, and ``sync_source()`` publishing a
SHA-named immutable revision under ``<cache>/revisions/<sha>`` with an atomic
``active.json`` pointer ``{"sha": <40 hex>}`` that survives failures.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import threading
import time
import unittest
from contextlib import ExitStack
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import game_source


CACHE_ENV = 'SAVE_LAB_CACHE_DIR'
SHA_A = 'a' * 40
SHA_B = 'b' * 40
POINTER_PAYLOAD = {'sha': SHA_A}


class FakeRemote:
    """Stub replacing game_source._head/_download_revision/_probe only."""

    def __init__(self, heads=(SHA_A,), *, corrupt_digest=False, download_delay=0.0,
                 raise_on_head=None, raise_on_download=None, raise_on_probe=None):
        self.heads = list(heads)
        self.head_calls = 0
        self.download_calls = []   # (stage path, sha)
        self.probe_calls = []      # stage path
        self.corrupt_digest = corrupt_digest
        self.download_delay = download_delay
        self.raise_on_head = raise_on_head
        self.raise_on_download = raise_on_download
        self.raise_on_probe = raise_on_probe

    def head(self):
        self.head_calls += 1
        if self.raise_on_head is not None:
            raise AssertionError('network use after activation: ' + self.raise_on_head)
        return self.heads[min(self.head_calls - 1, len(self.heads) - 1)]

    def content(self, relative_path):
        if relative_path.endswith('master.sqlite'):
            return b'\x00FAKE-MASTER-SQLITE-5525\x00' * 512
        return f'// offline stub {relative_path}\nmodule.exports={{}};\n'.encode('utf-8')

    def download(self, stage, sha):
        self.download_calls.append((str(stage), sha))
        if self.raise_on_download is not None:
            raise AssertionError('download refused: ' + self.raise_on_download)
        payloads = {name: self.content(name) for name in game_source.ENTRY_FILES}
        for name, data in payloads.items():
            target = Path(stage) / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        if self.download_delay:
            time.sleep(self.download_delay)
        if self.corrupt_digest:
            marker = game_source._blob(b'corrupt-digest-marker')
            digests = {name: marker for name in payloads}
        else:
            digests = {name: game_source._blob(data) for name, data in payloads.items()}
        (Path(stage) / 'files.json').write_text(
            json.dumps(digests, sort_keys=True), encoding='utf-8')

    def probe(self, stage):
        self.probe_calls.append(str(stage))
        if self.raise_on_probe is not None:
            raise self.raise_on_probe


class GameSourceContract(unittest.TestCase):

    def setUp(self):
        self.base = Path(tempfile.mkdtemp(prefix='save-lab-game-source-tests-'))
        self.cache = self.base / 'cache'
        self.scoped = ExitStack()
        self.addCleanup(self.scoped.close)
        self.scoped.enter_context(patch.dict(os.environ, {CACHE_ENV: str(self.cache), 'SAVE_LAB_OFFLINE': '0'}))
        self.addCleanup(shutil.rmtree, self.base, True)

    def remote(self, **options):
        remote = FakeRemote(**options)
        for binding, handler in (('_head', remote.head),
                                 ('_download_revision', remote.download),
                                 ('_probe', remote.probe)):
            self.scoped.enter_context(patch.object(game_source, binding, new=handler))
        return remote

    def pointer(self):
        try:
            return json.loads((self.cache / 'active.json').read_text(encoding='utf-8'))
        except (OSError, ValueError):
            return None

    def stage_residue(self):
        if not self.cache.is_dir():
            return []
        return [entry.name for entry in self.cache.iterdir()
                if entry.is_dir() and entry.name.startswith('stage-')]

    # --- cache layout --------------------------------------------------------

    def test_cache_directory_env_override_and_default(self):
        self.assertEqual(game_source.cache_directory(), self.cache)
        environ = os.environ.copy()
        environ.pop(CACHE_ENV, None)
        with patch.dict(os.environ, environ, clear=True):
            self.assertEqual(game_source.cache_directory(),
                             Path.home() / '.cache' / '5525-save-lab')

    def test_pointer_payload_is_exactly_the_active_sha(self):
        self.remote()
        snapshot = Path(game_source.sync_source())
        self.assertEqual(json.loads((self.cache / 'active.json').read_text(
            encoding='utf-8')), POINTER_PAYLOAD)
        self.assertTrue((snapshot / 'native' / 'campaign.js').is_file())

    # --- publication and pointer drift ----------------------------------------

    def test_sync_publishes_revision_and_pointer(self):
        remote = self.remote()
        snapshot = game_source.sync_source()
        target = (self.cache / 'revisions' / SHA_A).resolve()
        self.assertEqual(Path(snapshot).resolve(), target)
        self.assertTrue(game_source._verified(target))
        self.assertEqual(remote.head_calls, 1)
        self.assertEqual([sha for _, sha in remote.download_calls], [SHA_A])
        self.assertEqual([Path(stage).name for stage, _ in remote.download_calls],
                         [SHA_A], 'download must target a SHA-named staging tree')
        self.assertEqual(remote.probe_calls, [remote.download_calls[0][0]],
                         'probe must validate the same staged tree it downloaded')
        self.assertEqual(self.stage_residue(), [])

    def test_sync_follows_remote_main_without_pinned_constant(self):
        remote = self.remote(heads=(SHA_A, SHA_B))
        first = game_source.sync_source()
        second = game_source.sync_source()
        self.assertEqual(Path(first).resolve(), (self.cache / 'revisions' / SHA_A).resolve())
        self.assertEqual(Path(second).resolve(), (self.cache / 'revisions' / SHA_B).resolve())
        self.assertEqual(self.pointer(), {'sha': SHA_B})
        for sha in (SHA_A, SHA_B):
            self.assertTrue(game_source._verified(self.cache / 'revisions' / sha))
        self.assertEqual(remote.head_calls, 2, 'each sync resolves remote main')

    # --- offline behavior ------------------------------------------------------

    def test_cached_source_never_fetches(self):
        remote = self.remote()
        self.cache.mkdir(parents=True, exist_ok=True)
        self.assertIsNone(game_source.cached_source())
        (self.cache / 'active.json').write_text('{ broken json', encoding='utf-8')
        self.assertIsNone(game_source.cached_source())
        (self.cache / 'active.json').write_text(json.dumps({'sha': 'not-a-sha'}),
                                                encoding='utf-8')
        self.assertIsNone(game_source.cached_source())
        (self.cache / 'active.json').write_text(json.dumps({'sha': 'c' * 40}),
                                                encoding='utf-8')
        self.assertIsNone(game_source.cached_source())
        self.assertEqual((remote.head_calls, len(remote.download_calls),
                          len(remote.probe_calls)), (0, 0, 0))

    def test_ensure_source_never_fetches_when_active(self):
        pristine = self.remote()
        snapshot = game_source.sync_source()
        self.assertEqual(pristine.head_calls, 1)
        offline = self.remote(raise_on_head='ensure_source fast path',
                              raise_on_download='cached fast path',
                              raise_on_probe='cached fast path')
        self.assertEqual(game_source.cached_source(), snapshot)
        self.assertEqual(game_source.ensure_source(), snapshot)
        self.assertEqual((offline.head_calls, offline.download_calls.__len__(),
                          len(offline.probe_calls)), (0, 0, 0))

    def test_ensure_source_bootstraps_when_cache_is_empty(self):
        remote = self.remote()
        snapshot = game_source.ensure_source()
        self.assertEqual(Path(snapshot).resolve(),
                         (self.cache / 'revisions' / SHA_A).resolve())
        self.assertEqual(self.pointer(), POINTER_PAYLOAD)
        self.assertEqual((remote.head_calls, len(remote.download_calls),
                          len(remote.probe_calls)), (1, 1, 1))

    def test_offline_flag_blocks_every_fetch(self):
        remote = self.remote(raise_on_head='SAVE_LAB_OFFLINE=1',
                             raise_on_probe=AssertionError('offline'),
                             raise_on_download=AssertionError('offline'))
        self.scoped.enter_context(patch.dict(os.environ, {'SAVE_LAB_OFFLINE': '1'}))
        with self.assertRaises(game_source.GameSourceError):
            game_source.sync_source()
        with self.assertRaises(game_source.GameSourceError):
            game_source.ensure_source()
        self.assertEqual((remote.head_calls, len(remote.download_calls),
                          len(remote.probe_calls)), (0, 0, 0))

    # --- integrity --------------------------------------------------------------

    def test_corrupted_revision_refuses_offline_and_resyncs(self):
        remote = self.remote()
        snapshot = game_source.sync_source()
        victim = Path(snapshot) / 'native' / 'campaign.js'
        victim.write_bytes(b'\x00deceptive-bytes\x00')
        with ExitStack() as shield:
            for binding in ('_head', '_download_revision', '_probe'):
                def refuse(*_args, __binding=binding):
                    raise AssertionError('offline refusal: ' + __binding)
                shield.enter_context(patch.object(game_source, binding, new=refuse))
            self.assertIsNone(game_source.cached_source())
        repaired = game_source.ensure_source()
        self.assertEqual(Path(repaired).resolve(), Path(snapshot).resolve())
        self.assertTrue(game_source._verified(repaired))
        self.assertEqual((remote.head_calls, len(remote.download_calls),
                          len(remote.probe_calls)), (2, 2, 2))

    def test_digest_mismatch_after_download_never_publishes(self):
        self.remote(corrupt_digest=True)
        with self.assertRaises(game_source.GameSourceError):
            game_source.sync_source()
        self.assertIsNone(self.pointer())
        revisions = self.cache / 'revisions'
        self.assertEqual([entry.name for entry in revisions.iterdir()], [])
        self.assertEqual(self.stage_residue(), [])

    def test_probe_failure_retains_pointer_and_stages_nothing(self):
        self.remote(heads=(SHA_A, SHA_A),
                    raise_on_probe=RuntimeError('staged tree failed the probe'))
        with self.assertRaises(RuntimeError):
            game_source.sync_source()
        self.assertIsNone(self.pointer())
        self.assertFalse((self.cache / 'revisions' / SHA_A).exists())
        self.assertEqual(self.stage_residue(), [])
        # A later healthy sync still publishes cleanly.
        fresh = self.remote(heads=(SHA_A,))
        snapshot = game_source.sync_source()
        self.assertEqual(Path(snapshot).resolve(),
                         (self.cache / 'revisions' / SHA_A).resolve())
        self.assertEqual(fresh.head_calls, 1)

    # --- concurrency --------------------------------------------------------------

    def test_concurrent_sync_is_safe(self):
        self.remote(download_delay=0.05)
        outcomes = {}

        def worker(slot):
            try:
                outcomes[slot] = game_source.sync_source()
            except BaseException as exc:
                outcomes[slot] = exc

        threads = [threading.Thread(target=worker, args=(slot,)) for slot in (0, 1)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(60)
            self.assertFalse(thread.is_alive())
        for slot in (0, 1):
            self.assertNotIsInstance(outcomes[slot], BaseException)
        self.assertEqual(self.pointer(), POINTER_PAYLOAD)
        revisions = [entry.name for entry in (self.cache / 'revisions').iterdir()]
        self.assertEqual(revisions, [SHA_A])
        self.assertEqual(self.stage_residue(), [])


class DownloadTests(unittest.TestCase):
    def test_relative_dependency_is_fetched_at_the_same_sha_and_verified(self):
        files = {'native/campaign.js': b"require('./new-rule.js');", 'native/new-rule.js': b'good'}
        tree = {'tree': [{'path': name, 'type': 'blob', 'mode': '100644',
                          'size': len(data), 'sha': game_source._blob(data)}
                         for name, data in files.items()]}
        def get(url, limit):
            if url == f'{game_source.API}/git/trees/{SHA_A}?recursive=1':
                return json.dumps(tree).encode()
            prefix = f'https://raw.githubusercontent.com/{game_source.REPOSITORY}/{SHA_A}/'
            self.assertTrue(url.startswith(prefix))
            return files[url[len(prefix):]]
        with tempfile.TemporaryDirectory() as tmp, patch.object(game_source, '_get', side_effect=get), \
                patch.object(game_source, 'ENTRY_FILES', {'native/campaign.js'}):
            root = Path(tmp)
            game_source._download_revision(root, SHA_A)
            self.assertTrue(game_source._verified(root))
            self.assertEqual((root/'native/new-rule.js').read_bytes(), b'good')
            files['native/new-rule.js'] = b'evil'
            with self.assertRaises(game_source.GameSourceError):
                game_source._download_revision(root, SHA_A)


if __name__ == '__main__':
    unittest.main()
