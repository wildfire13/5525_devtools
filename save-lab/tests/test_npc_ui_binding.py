"""Headless data-binding test only. This does not create or validate a Tk window."""
import sys,json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from timeline_ui import TimelinePanel
from save_lab import engine
class Widget:
    def __init__(self): self.rows=[];self.value=None;self.settings={}
    def set(self,value):self.value=value
    def configure(self,**kwargs):self.settings.update(kwargs)
    def delete(self,*args):self.rows=[]
    def insert(self,*args,**kwargs):self.rows.append(kwargs.get('values',args));return str(len(self.rows))
    def get_children(self):return tuple(range(len(self.rows)))
    def pack(self,**kwargs):pass
    def yview_moveto(self,value):pass

def panel():
    p=SimpleNamespace(**{x:Widget() for x in ['clock','quest_summary','warnings','tree','schedule','details','export_button','boundary_area','schedule_heading','boundary_tree']})
    p.app=SimpleNamespace(status=Widget());p.frozen=True;p.boundary_notes={};p.report=None;p.boundary_report=None
    p.clear_boundaries=lambda: (p.boundary_tree.delete(),p.boundary_notes.clear())
    p.get_options=lambda:{};p.render=lambda r:TimelinePanel.render(p,r)
    p.error=lambda e: (_ for _ in ()).throw(e)
    return p

def run(fixtures):
    p=panel();count=0
    for name,waits in [('npc-wheel-south-15h',1),('npc-wheel-road-south-3h',2),('npc-wheel-road-astaris-3h',1),('npc-wheel-missing-cargo-road-south-3h',2)]:
        save=json.loads((fixtures/f'TEST-ONLY.{name}.json').read_text(encoding='utf-8'));r=engine('timeline',save=save);p.render(r)
        rows=[row for row in p.tree.rows if '待つ' in row[0]];assert len(rows)==waits,(name,rows)
        for row in rows:
            if 'missing-cargo' in name:assert row[-1]=='—'
            else:assert '220 G' in row[-1]
        assert p.export_button.settings['state']=='normal';count+=1
    for name in ['npc-wheel-south-0h','npc-wheel-road-south-3h']:
        save=json.loads((fixtures/f'TEST-ONLY.{name}.json').read_text(encoding='utf-8'));r=engine('boundaries',save=save)
        with patch('timeline_ui.engine',return_value=r):TimelinePanel.run_boundaries(p)
        assert any('到着待ち' in row[1] for row in p.boundary_tree.rows);count+=1
    print(f'PASS {count} headless UI data-binding cases. Real Tk window/rendering not tested.')
if __name__=='__main__':run(Path(sys.argv[1]))
