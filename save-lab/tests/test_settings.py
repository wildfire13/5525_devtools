import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import save_lab

class Settings(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        self.env=patch.dict(os.environ,{},clear=True);self.env.start();self.addCleanup(self.env.stop)
        self.patch=patch.object(save_lab,'ROOT',self.root);self.patch.start();self.addCleanup(self.patch.stop)
    def config(self,value):
        (self.root/'save-lab.local.json').write_text(json.dumps(value),encoding='utf8')
    def test_optional_file(self):self.assertIsNone(save_lab.configured_save_directory())
    def test_relative_directory(self):
        (self.root/'saves').mkdir();self.config({'python':'','saveDirectory':'saves'})
        self.assertEqual(save_lab.configured_save_directory(),str((self.root/'saves').resolve()))
    def test_invalid_directory(self):
        self.config({'saveDirectory':'missing'})
        with self.assertRaises(save_lab.LabError):save_lab.configured_save_directory()
    def test_invalid_key(self):
        self.config({'runCode':'evil'})
        with self.assertRaises(save_lab.LabError):save_lab.configured_save_directory()
    def test_env_priority(self):
        self.config({'saveDirectory':'missing'});os.environ['SAVE_LAB_SAVE_DIR']=str(self.root)
        self.assertEqual(save_lab.configured_save_directory(),str(self.root.resolve()))
    def test_blank_directory(self):
        self.config({'python':'','saveDirectory':''});self.assertIsNone(save_lab.configured_save_directory())

if __name__=='__main__':unittest.main()
