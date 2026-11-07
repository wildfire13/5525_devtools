"""Artificial QA output is isolated from real input saves and existing folders."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from save_lab import ROOT, LabError, export_qa_bundle
from test_local_files import create_link_or_skip

class QAFiles(unittest.TestCase):
    def cli(self,*args):
        return subprocess.run([sys.executable,'-X','utf8',str(ROOT/'save_lab.py'),*map(str,args)],cwd=ROOT,capture_output=True,text=True,encoding='utf-8',timeout=60)

    def test_manifest_sha_official_validation_and_test_only_filenames(self):
        with tempfile.TemporaryDirectory() as temp:
            target=Path(temp)/'TEST-ONLY-fixture'
            result=self.cli('qa-fixtures','--case','kiln-accepted-20h','--out-dir',target)
            self.assertEqual(result.returncode,0,result.stderr)
            manifest=json.loads((target/'fixture-manifest.json').read_text(encoding='utf-8'))
            self.assertTrue(manifest['complete']);self.assertTrue(manifest['synthetic']);self.assertEqual(len(manifest['cases']),1)
            row=manifest['cases'][0];self.assertTrue(row['filename'].startswith('TEST-ONLY.'));source=target/row['filename']
            self.assertEqual(row['sha256'],hashlib.sha256(source.read_bytes()).hexdigest());self.assertEqual(row['timeline']['delivery']['result']['gold'],150)
            self.assertEqual(row['validation']['gameUi'],'not_run');self.assertFalse((target/'INCOMPLETE-TEST-ONLY.txt').exists())
            validation=self.cli('validate',source);self.assertEqual(validation.returncode,0,validation.stderr)
            original=source.read_bytes();rejected=self.cli('qa-fixtures','--case','kiln-accepted-20h','--out-dir',target)
            self.assertEqual(rejected.returncode,2);self.assertEqual(source.read_bytes(),original)

    def test_invalid_case_never_creates_folder(self):
        with tempfile.TemporaryDirectory() as temp:
            target=Path(temp)/'TEST-ONLY-invalid'
            result=self.cli('qa-fixtures','--case','invalid','--out-dir',target)
            self.assertEqual(result.returncode,2);self.assertFalse(target.exists())

    def test_existing_file_and_folder_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            parent=Path(temp);source=parent/'original.json';source.write_text('untouched',encoding='utf-8');folder=parent/'existing';folder.mkdir()
            for target in (source,folder):
                with self.assertRaises(LabError):export_qa_bundle(target,['kiln-accepted-20h'])
            self.assertEqual(source.read_text(encoding='utf-8'),'untouched');self.assertEqual(list(folder.iterdir()),[])

    def test_existing_symlink_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            parent=Path(temp);folder=parent/'existing';folder.mkdir();link=parent/'link'
            create_link_or_skip(self, 'symlink', lambda: link.symlink_to(folder,target_is_directory=True))
            with self.assertRaises(LabError):export_qa_bundle(link,['kiln-accepted-20h'])
            self.assertEqual(list(folder.iterdir()),[])

    def test_write_failure_marks_bundle_incomplete(self):
        with tempfile.TemporaryDirectory() as temp:
            target=Path(temp)/'TEST-ONLY-failed'
            with patch('save_lab.save_new',side_effect=OSError('simulated disk failure')):
                with self.assertRaises(OSError):export_qa_bundle(target,['kiln-accepted-20h'])
            self.assertTrue((target/'INCOMPLETE-TEST-ONLY.txt').exists());self.assertFalse((target/'fixture-manifest.json').exists())

    def test_boundaries_cli_preserves_source_and_rejects_overwrite(self):
        with tempfile.TemporaryDirectory() as temp:
            target=Path(temp)/'TEST-ONLY-source';export_qa_bundle(target,['kiln-accepted-19h'])
            source=target/'TEST-ONLY.kiln-accepted-19h.json';original=source.read_bytes();report=Path(temp)/'boundary.report.json'
            result=self.cli('boundaries',source,'--out',report);self.assertEqual(result.returncode,0,result.stderr)
            data=json.loads(report.read_text(encoding='utf-8'));self.assertEqual(data['kind'],'boundaryComparison');self.assertEqual(data['source_sha256'],hashlib.sha256(original).hexdigest());self.assertEqual(len(data['rows']),6)
            self.assertNotIn('save',data);self.assertEqual(source.read_bytes(),original)
            self.assertEqual(self.cli('boundaries',source,'--out',source).returncode,2);self.assertEqual(source.read_bytes(),original)

if __name__=='__main__':unittest.main()
