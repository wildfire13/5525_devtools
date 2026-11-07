"""Synthetic metadata round trips through files, Workspace, undo and CLI.

All data is generated here. Never add a player's save or portrait to these tests.
"""
import base64
import binascii
import copy
import hashlib
import json
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import unittest
import zlib

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from save_lab import LabError, ROOT, Workspace, engine, load_json, save_new


METADATA_KEYS = ('nativePortraits', 'godotCampaignId', 'godotFrontend')


def synthetic_png():
    """Build a valid 64x64 RGBA PNG without loading any image or save file."""
    width = height = 64
    scanlines = bytearray()
    seed = 0x55250102
    for _ in range(height):
        scanlines.append(0)
        for _ in range(width * 4):
            seed ^= (seed << 13) & 0xffffffff
            seed ^= seed >> 17
            seed ^= (seed << 5) & 0xffffffff
            scanlines.append(seed & 255)

    def chunk(name, data):
        body = name + data
        return struct.pack('>I', len(data)) + body + struct.pack('>I', binascii.crc32(body) & 0xffffffff)

    ihdr = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr)
            + chunk(b'IDAT', zlib.compress(bytes(scanlines), level=0)) + chunk(b'IEND', b''))


def with_metadata(save):
    result = copy.deepcopy(save)
    png = synthetic_png()
    character_id = result['state']['selected'][0]
    result['nativePortraits'] = {
        'version': 1,
        'characters': {character_id: {
            'png': base64.b64encode(png).decode('ascii'),
            'sha256': hashlib.sha256(png).hexdigest(),
        }},
    }
    result['godotCampaignId'] = '0123456789abcdef0123456789abcdef'
    result['godotFrontend'] = {'version': 1, 'journey_key': '', 'quest_id': ''}
    return result


def metadata(save):
    return {key: copy.deepcopy(save[key]) for key in METADATA_KEYS if key in save}


class MetadataFiles(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sample = with_metadata(engine('new'))

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='save-lab-synthetic-')
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.source = self.directory / '人工サンプル_顔画像.json'
        save_new(self.source, self.sample)
        self.source_bytes = self.source.read_bytes()
        self.source_hash = hashlib.sha256(self.source_bytes).hexdigest()

    def assert_source_unchanged(self):
        self.assertEqual(self.source.read_bytes(), self.source_bytes)
        self.assertEqual(hashlib.sha256(self.source.read_bytes()).hexdigest(), self.source_hash)

    def assert_metadata_preserved(self, save):
        self.assertEqual(metadata(save), metadata(self.sample))
        entry = save['nativePortraits']['characters'][save['state']['selected'][0]]
        decoded = base64.b64decode(entry['png'], validate=True)
        self.assertEqual(hashlib.sha256(decoded).hexdigest(), entry['sha256'])
        self.assertGreater(len(entry['png']), 4000)

    def test_open_edit_undo_reset_export_and_reopen_preserve_exact_metadata(self):
        work = Workspace()
        work.open(self.source)
        self.assertEqual(work.before, self.sample)
        self.assertEqual(work.after, self.sample)
        self.assertEqual(work.import_warnings, [])
        self.assert_metadata_preserved(work.before)
        self.assert_metadata_preserved(work.after)

        work.apply({'gold': 777})
        expected = copy.deepcopy(self.sample)
        expected['state']['gold'] = 777
        self.assertEqual(work.after, expected)
        self.assert_metadata_preserved(work.undo_stack[-1])
        self.assert_metadata_preserved(work.after)
        self.assertEqual([(row['subject'], row['field']) for row in work.compare()['rows']], [('campaign', 'gold')])

        work.undo()
        self.assertEqual(work.after, self.sample)
        work.apply({'gold': 888})
        work.reset()
        self.assertEqual(work.after, self.sample)
        work.undo()
        self.assertEqual(work.after['state']['gold'], 888)
        self.assert_metadata_preserved(work.after)

        output = self.directory / '検証済み_別名保存.json'
        work.export(output)
        self.assert_metadata_preserved(load_json(output)[0])
        reopened = Workspace()
        reopened.open(output)
        self.assertEqual(reopened.after, work.after)
        self.assert_metadata_preserved(reopened.before)
        self.assert_source_unchanged()

    def test_failed_patch_leaves_work_history_and_source_unchanged(self):
        work = Workspace()
        work.open(self.source)
        work.apply({'gold': 777})
        before = copy.deepcopy((work.before, work.after, work.info, work.undo_stack, work.import_warnings))
        for patch in ({'gold': -1}, {'gold': 888, 'characters': {'unknown': {'hp': 1}}}, {'nativePortraits': {}}):
            with self.assertRaises(LabError):
                work.apply(patch)
            self.assertEqual((work.before, work.after, work.info, work.undo_stack, work.import_warnings), before)
            self.assert_source_unchanged()

    def test_invalid_metadata_open_is_atomic(self):
        work = Workspace()
        work.open(self.source)
        work.apply({'gold': 777})
        snapshot = copy.deepcopy(work.__dict__)
        invalid = copy.deepcopy(self.sample)
        invalid['nativePortraits']['version'] = 999
        bad_path = self.directory / '不正な人工メタデータ.json'
        save_new(bad_path, invalid)
        bad_bytes = bad_path.read_bytes()
        with self.assertRaises(LabError):
            work.open(bad_path)
        self.assertEqual(work.__dict__, snapshot)
        self.assertEqual(bad_path.read_bytes(), bad_bytes)
        self.assert_source_unchanged()

    def test_invalid_metadata_cannot_be_exported(self):
        work = Workspace()
        work.open(self.source)
        entry = work.after['nativePortraits']['characters'][work.after['state']['selected'][0]]
        entry['sha256'] = '0' * 64
        output = self.directory / '拒否された出力.json'
        with self.assertRaises(LabError):
            work.export(output)
        self.assertFalse(output.exists())
        self.assert_source_unchanged()

    def test_readonly_road_keeps_metadata_through_export_and_reopen(self):
        # This checked-in fixture is generated by the official engine, not a user save.
        road, _ = load_json(ROOT / 'vendor/generated-fixtures/road-readonly.json')
        road = with_metadata(road)
        road_source = self.directory / '人工サンプル_移動中.json'
        save_new(road_source, road)
        original = road_source.read_bytes()
        work = Workspace()
        work.open(road_source)
        self.assertFalse(work.info['summary']['editable'])
        self.assertEqual(work.after, road)
        with self.assertRaises(LabError):
            work.apply({'gold': 777})
        self.assertEqual(work.after, road)
        self.assertEqual(work.undo_stack, [])
        output = self.directory / '移動中_閲覧専用コピー.json'
        work.export(output)
        reopened = Workspace()
        reopened.open(output)
        self.assertEqual(reopened.after, road)
        self.assertFalse(reopened.info['summary']['editable'])
        self.assertEqual(road_source.read_bytes(), original)
        self.assert_source_unchanged()

    def test_cli_unicode_edit_validate_and_compare_preserve_metadata(self):
        patch_path = self.directory / '所持金変更.json'
        save_new(patch_path, {'gold': 850})
        output = self.directory / 'CLI出力_顔画像あり.json'

        def cli(*args):
            result = subprocess.run([sys.executable, str(ROOT / 'save_lab.py'), *map(str, args)],
                                    capture_output=True, text=True, encoding='utf-8')
            self.assertEqual(result.returncode, 0, result.stderr)
            return json.loads(result.stdout)

        cli('edit', self.source, '--patch', patch_path, '--out', output)
        edited, _ = load_json(output)
        expected = copy.deepcopy(self.sample)
        expected['state']['gold'] = 850
        self.assertEqual(edited, expected)
        self.assert_metadata_preserved(edited)
        self.assertTrue(cli('validate', output)['valid'])
        rows = cli('compare', self.source, output)['rows']
        self.assertEqual([(row['subject'], row['field']) for row in rows], [('campaign', 'gold')])
        self.assert_source_unchanged()


if __name__ == '__main__':
    unittest.main()
