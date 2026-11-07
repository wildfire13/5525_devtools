import copy
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from save_lab import Workspace, LabError, engine, load_json, save_new, parse_json, ROOT

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
    def test_symlink_refused(self):
        link=self.dir/'link.json'; link.symlink_to(self.source)
        with self.assertRaises(LabError): save_new(link, {})
        self.assertEqual(load_json(self.source)[0],self.sample)
    def test_hardlink_refused(self):
        link=self.dir/'hard.json'; os.link(self.source,link)
        with self.assertRaises(LabError): save_new(link, {})
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
        run=subprocess.run([sys.executable,str(ROOT/'save_lab.py'),'edit',str(self.source),'--patch',str(patch),'--out',str(out)],capture_output=True,text=True)
        self.assertEqual(run.returncode,0,run.stderr);self.assertEqual(load_json(out)[0]['state']['gold'],850)
        run=subprocess.run([sys.executable,str(ROOT/'save_lab.py'),'validate',str(out)],capture_output=True,text=True)
        self.assertEqual(run.returncode,0,run.stderr);self.assertTrue(json.loads(run.stdout)['valid'])
    def test_preserve_unedited_state(self):
        work=Workspace();work.open(self.source);work.apply({'gold':200})
        expected=copy.deepcopy(self.sample);expected['state']['gold']=200
        self.assertEqual(work.after,expected)

if __name__=='__main__':unittest.main()
