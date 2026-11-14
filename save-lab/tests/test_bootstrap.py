"""Exercise the Windows entry without reading private configuration or opening GUI."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


@unittest.skipUnless(os.name == 'nt', 'Windows entry')
class BootstrapTests(unittest.TestCase):
    def test_runtime_paths_and_precedence(self):
        with tempfile.TemporaryDirectory(prefix='save lab 日本語 ') as tmp:
            root = Path(tmp)
            shutil.copy(ROOT / 'bootstrap.ps1', root)
            shutil.copy(shutil.which('node'), root / 'node 日本語.exe')
            (root / 'launch.cjs').write_text(
                'console.log(JSON.stringify({args:process.argv.slice(2),'
                'python:process.env.SAVE_LAB_PYTHON}));', encoding='utf-8')
            (root / '.env').write_text(
                'SAVE_LAB_NODE="node 日本語.exe"\nSAVE_LAB_PYTHON="python 日本語.exe"\n',
                encoding='utf-8')
            env = {k: v for k, v in os.environ.items() if not k.startswith('SAVE_LAB_')}
            def run(*args):
                return subprocess.run(['powershell.exe', '-NoProfile', '-ExecutionPolicy',
                    'Bypass', '-File', str(root / 'bootstrap.ps1'), *args],
                    env=env, capture_output=True, encoding='utf-8', errors='replace')
            result = run()
            self.assertEqual(result.returncode, 0, result.stderr)
            data = json.loads(result.stdout)
            self.assertEqual(data['args'], ['--gui'])
            self.assertTrue(data['python'].endswith('python 日本語.exe'))
            env['SAVE_LAB_PYTHON'] = 'explicit-python'
            result = run('-LaunchArgs', '--diagnose')
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(result.stdout), {'args':['--diagnose'], 'python':'explicit-python'})
            env['SAVE_LAB_NODE'] = str(root / 'missing.exe')
            self.assertEqual(run().returncode, 2)
            env['SAVE_LAB_NODE'] = shutil.which('node')
            (root / '.env').write_text('SAVE_LAB_NODE=missing.exe\n', encoding='utf-8')
            self.assertEqual(run().returncode, 0)


if __name__ == '__main__':
    unittest.main()
