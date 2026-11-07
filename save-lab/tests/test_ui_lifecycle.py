"""Headless lifecycle regressions; actual window rendering remains separate QA."""
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import sys
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from timeline_ui import TimelinePanel

class Widget:
    def __init__(self): self.content='previous aftermath'; self.settings={}; self.rows=['old']; self.mapped=True
    def set(self, text): self.content=text
    def configure(self, **kwargs): self.settings.update(kwargs)
    def delete(self, *args): self.content=''; self.rows=[]
    def get_children(self): return self.rows[:]
    def pack_forget(self): self.mapped=False

def panel():
    p=TimelinePanel.__new__(TimelinePanel)
    for key in ['source','quest_box','destination_box','carrier_box','advance_entry','run_button','boundary_button','export_button','tree','schedule','clock','quest_summary','warnings','details','boundary_tree','boundary_area','boundary_detail']:
        setattr(p,key,Widget())
    p.app=SimpleNamespace(root=object())
    p.frozen={'test':'unchanged'};p.report={'aftermath':['previous']};p.boundary_report={'old':True};p.boundary_notes={'old':'old'}
    return p

class TimelineLifecycle(unittest.TestCase):
    def test_invalidate_needs_no_report_and_clears_all_results(self):
        p=panel();p.invalidate()
        self.assertIsNone(p.frozen);self.assertIsNone(p.report);self.assertIsNone(p.boundary_report)
        self.assertEqual(p.details.content,'');self.assertEqual(p.details.settings['state'],'disabled')
        self.assertEqual(p.export_button.settings['state'],'disabled');self.assertFalse(p.boundary_area.mapped)

    def test_changed_input_clears_dynamic_aftermath_and_export(self):
        p=panel();original=p.frozen;p.mark_stale()
        self.assertIs(p.frozen,original);self.assertIsNone(p.report);self.assertIsNone(p.boundary_report)
        self.assertEqual(p.details.content,'');self.assertEqual(p.export_button.settings['state'],'disabled')

    def test_rejected_run_clears_dynamic_aftermath_and_preserves_input(self):
        p=panel();original=p.frozen
        with patch('timeline_ui.messagebox.showerror') as error:p.error(ValueError('invalid condition'))
        error.assert_called_once();self.assertIs(p.frozen,original);self.assertIsNone(p.report)
        self.assertEqual(p.details.content,'');self.assertEqual(p.export_button.settings['state'],'disabled')

if __name__=='__main__': unittest.main()
