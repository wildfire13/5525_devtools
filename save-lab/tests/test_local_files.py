import copy
import errno
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from save_lab import Workspace, LabError, engine, load_json, save_new, parse_json, ROOT


def create_link_or_skip(test_case, kind, create):
    """Skip only an unavailable real link fixture, never a product assertion."""
    try:
        return create()
    except OSError as exc:
        winerror = getattr(exc, 'winerror', None)
        # Windows access denied, unsupported filesystem, or missing privilege.
        # Prefer the specific Windows code so an unexpected error is not hidden
        # by Python's less specific errno mapping.
        unavailable = (winerror in {5, 50, 1314} if winerror is not None else
                       exc.errno in {errno.EACCES, errno.EPERM, errno.ENOSYS,
                                     errno.ENOTSUP, errno.EOPNOTSUPP})
        if not unavailable:
            raise
        test_case.skipTest(
            f'{kind} fixture unavailable in temporary test directory '
            f'(errno={exc.errno}, winerror={winerror}): {exc}')


class LinkFixtureSelection(unittest.TestCase):
    def test_known_permission_and_capability_errors_are_explicit_skips(self):
        errors = [OSError(code, 'fixture capability unavailable') for code in
                  {errno.EACCES, errno.EPERM, errno.ENOSYS, errno.ENOTSUP, errno.EOPNOTSUPP}]
        for code in (5, 50, 1314):
            error = OSError(errno.EACCES, 'Windows fixture capability unavailable')
            error.winerror = code
            errors.append(error)
        for error in errors:
            with self.subTest(errno=error.errno, winerror=getattr(error, 'winerror', None)):
                create = mock.Mock(side_effect=error)
                with self.assertRaisesRegex(unittest.SkipTest, 'symlink fixture unavailable in temporary test directory'):
                    create_link_or_skip(self, 'symlink', create)
                create.assert_called_once_with()

    def test_unexpected_fixture_errors_are_not_skipped(self):
        errors = [OSError(code, 'unexpected fixture failure') for code in
                  (errno.EEXIST, errno.ENOENT, errno.EINVAL, errno.EIO)]
        unexpected_windows_error = OSError(errno.EACCES, 'unexpected Windows error')
        unexpected_windows_error.winerror = 87  # ERROR_INVALID_PARAMETER
        errors.extend([unexpected_windows_error, RuntimeError('unexpected failure')])
        for error in errors:
            with self.subTest(error=repr(error), winerror=getattr(error, 'winerror', None)):
                with self.assertRaises(type(error)) as caught:
                    create_link_or_skip(self, 'hardlink', mock.Mock(side_effect=error))
                self.assertIs(caught.exception, error)

    def test_supported_fixture_is_created_once(self):
        create = mock.Mock(return_value=mock.sentinel.created)
        self.assertIs(create_link_or_skip(self, 'hardlink', create), mock.sentinel.created)
        create.assert_called_once_with()


class LocalFiles(unittest.TestCase):
    @classmethod
    def setUpClass(cls): cls.sample = engine('new')
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.dir = Path(self.temp.name); self.source = self.dir/'source.json'; save_new(self.source, self.sample)
    def test_export_does_not_touch_original(self):
        before = self.source.read_bytes(); work = Workspace(); work.open(self.source); work.apply({'gold':999})
        out=self.dir/'copy.json'; work.export(out)
        self.assertEqual(self.source.read_bytes(), before); self.assertEqual(load_json(out)[0]['state']['gold'], 999)
    def test_existing_output_refused(self):
        work=Workspace(); work.open(self.source)
        with self.assertRaises(LabError): work.export(self.source)
        out=self.dir/'existing.json'; out.write_text('KEEP')
        with self.assertRaises(LabError): work.export(out)
        self.assertEqual(out.read_text(),'KEEP')
    def test_save_new_refuses_existing_plain_file(self):
        before = self.source.read_bytes()
        with self.assertRaises(LabError): save_new(self.source, {})
        self.assertEqual(self.source.read_bytes(), before)
    def test_save_new_uses_exclusive_create_and_preserves_existing_file(self):
        before = self.source.read_bytes()
        # Runs even when this environment cannot create real links. This checks
        # the exclusive-create mode and collision handling, not OS link support.
        with mock.patch.object(Path, 'open', side_effect=FileExistsError(errno.EEXIST, 'already exists')) as open_file:
            with self.assertRaises(LabError): save_new(self.source, {})
        open_file.assert_called_once_with('x', encoding='utf-8', newline='\n')
        self.assertEqual(self.source.read_bytes(), before)
    def test_symlink_refused(self):
        link=self.dir/'link.json'
        create_link_or_skip(self, 'symlink', lambda: link.symlink_to(self.source))
        before = self.source.read_bytes()
        with self.assertRaises(LabError): save_new(link, {})
        self.assertEqual(self.source.read_bytes(), before)
        self.assertEqual(load_json(self.source)[0],self.sample)
    def test_hardlink_refused(self):
        link=self.dir/'hard.json'
        create_link_or_skip(self, 'hardlink', lambda: os.link(self.source,link))
        before = self.source.read_bytes()
        with self.assertRaises(LabError): save_new(link, {})
        self.assertEqual(self.source.read_bytes(), before)
        self.assertEqual(load_json(self.source)[0],self.sample)
    def test_original_change_detected(self):
        work=Workspace(); work.open(self.source); self.source.write_text('{}')
        with self.assertRaises(LabError): work.export(self.dir/'copy.json')
        self.assertFalse((self.dir/'copy.json').exists())
    def test_failed_patch_preserves_work(self):
        work=Workspace(); work.open(self.source); before=copy.deepcopy(work.after)
        with self.assertRaises(LabError): work.apply({'gold':-1})
        self.assertEqual(work.after,before); self.assertEqual(work.undo_stack,[])
    def test_undo_reset(self):
        work=Workspace(); work.open(self.source); work.apply({'gold':777}); work.undo()
        self.assertEqual(work.after,self.sample)
        work.apply({'gold':888}); work.reset(); self.assertEqual(work.after,self.sample);work.undo();self.assertEqual(work.after['state']['gold'],888)
    def test_invalid_json(self):
        for value in ['{"a":1,"a":2}', '{"a":NaN}', '{"a":Infinity}', 'null junk']:
            with self.assertRaises(LabError): parse_json(value)
    def test_size_limit(self):
        large=self.dir/'large.json';large.write_bytes(b' '*(1024*1024+1))
        with self.assertRaises(LabError): load_json(large)
    def test_readonly_road(self):
        work=Workspace();work.open(ROOT/'vendor/generated-fixtures/road-readonly.json')
        self.assertFalse(work.info['summary']['editable'])
        with self.assertRaises(LabError):work.apply({'gold':99})
    def test_cli_edit_and_revalidate(self):
        patch=self.dir/'patch.json';save_new(patch,{'gold':850})
        out=self.dir/'out.json'
        run=subprocess.run([sys.executable,'-X','utf8',str(ROOT/'save_lab.py'),'edit',str(self.source),'--patch',str(patch),'--out',str(out)],capture_output=True,text=True,encoding='utf-8')
        self.assertEqual(run.returncode,0,run.stderr);self.assertEqual(load_json(out)[0]['state']['gold'],850)
        run=subprocess.run([sys.executable,'-X','utf8',str(ROOT/'save_lab.py'),'validate',str(out)],capture_output=True,text=True,encoding='utf-8')
        self.assertEqual(run.returncode,0,run.stderr);self.assertTrue(json.loads(run.stdout)['valid'])
    def test_preserve_unedited_state(self):
        work=Workspace();work.open(self.source);work.apply({'gold':200})
        expected=copy.deepcopy(self.sample);expected['state']['gold']=200
        self.assertEqual(work.after,expected)

if __name__=='__main__':unittest.main()
