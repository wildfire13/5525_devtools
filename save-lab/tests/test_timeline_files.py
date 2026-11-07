"""Timeline CLI is read-only, including metadata and failure paths."""
import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from save_lab import ROOT, Workspace, engine, save_new
from test_metadata_files import with_metadata


class TimelineFiles(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixture = with_metadata(engine('new'))

    def cli(self, *args):
        return subprocess.run([sys.executable, '-X', 'utf8', str(ROOT / 'save_lab.py'), *map(str,args)], cwd=ROOT, capture_output=True, text=True, encoding='utf-8', timeout=60)

    def test_workspace_before_after_and_metadata_stay_identical(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory)/'original.json'; save_new(source,self.fixture)
            before = source.read_bytes(); work = Workspace(); work.open(source)
            work.apply({'gold':777}); a=copy.deepcopy(work.before); b=copy.deepcopy(work.after); stack=copy.deepcopy(work.undo_stack)
            r=engine('timeline',save=work.after,options={'questId':'standalone-kiln','destination':'east','advanceHours':18})
            self.assertTrue(r['copyOnly']); self.assertEqual(r['forecasts'][0]['delivery']['result']['outcome'],'failed')
            self.assertEqual(work.before,a); self.assertEqual(work.after,b); self.assertEqual(work.undo_stack,stack); self.assertEqual(source.read_bytes(),before)
            self.assertNotIn('nativePortraits',json.dumps(r)); self.assertNotIn('godotFrontend',json.dumps(r))

    def test_cli_report_not_save_and_source_unchanged(self):
        with tempfile.TemporaryDirectory() as directory:
            source=Path(directory)/'source.json'; target=Path(directory)/'report.json';save_new(source,self.fixture)
            original=source.read_bytes();result=self.cli('timeline',source,'--quest','standalone-kiln','--destination','east','--out',target)
            self.assertEqual(result.returncode,0,result.stderr); report=json.loads(result.stdout)
            self.assertEqual(report,json.loads(target.read_text(encoding='utf-8')));self.assertEqual(report['clock']['worldTime'],0)
            self.assertEqual(source.read_bytes(),original);self.assertNotIn('characters',report['state']);self.assertIn('source_sha256',report)

    def test_cli_never_overwrites_existing_output(self):
        with tempfile.TemporaryDirectory() as directory:
            source=Path(directory)/'source.json';save_new(source,self.fixture);original=source.read_bytes()
            result=self.cli('timeline',source,'--out',source)
            self.assertEqual(result.returncode,2);self.assertEqual(source.read_bytes(),original);self.assertIn('上書き',json.loads(result.stderr)['error'])

    def test_invalid_options_do_not_create_output(self):
        with tempfile.TemporaryDirectory() as directory:
            source=Path(directory)/'source.json';target=Path(directory)/'report.json';save_new(source,self.fixture)
            for args in [('--advance-hours','-1'),('--quest','invented'),('--destination','moon'),('--advance-hours','100001')]:
                with self.subTest(args=args):
                    result=self.cli('timeline',source,*args,'--out',target)
                    self.assertEqual(result.returncode,2,result.stdout);self.assertFalse(target.exists());self.assertFalse(json.loads(result.stderr)['ok'])

    def test_repeated_runs_do_not_accumulate_time(self):
        before=copy.deepcopy(self.fixture); options={'advanceHours':10}
        a=engine('timeline',save=self.fixture,options=options);b=engine('timeline',save=self.fixture,options=options)
        self.assertEqual(a,b);self.assertEqual(b['clock']['worldTime'],10);self.assertEqual(self.fixture,before)


if __name__ == '__main__': unittest.main()
