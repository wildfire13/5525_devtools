"""Headless adapter bindings only; not Tk rendering or OS-input verification."""
import sys,json
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from timeline_ui import TimelinePanel
from save_lab import engine
from test_npc_ui_binding import panel

def run(fixtures):
    p=panel();count=0
    def load(name):return json.loads((fixtures/f'TEST-ONLY.{name}.json').read_text(encoding='utf-8'))
    for epoch in [0,42]:
        for town in ['astaris','east','west','south','north']:
            for suffix in ['', '-offparty']:
                name=f'decisions-wheel-expired-{town}-37h-epoch{epoch}{suffix}';r=engine('timeline',save=load(name));p.render(r)
                assert p.tree.rows[0][0]=='現在地で期限切れ確認';assert '失敗' in p.tree.rows[0][3];assert '世界時刻' in p.tree.rows[0][3];assert p.tree.rows[0][4]=='0 G / 0 RP / 0 EXP';assert not r['delivery']['available'];count+=1
    for age in [25,36,37]:
        r=engine('timeline',save=load(f'decisions-wheel-missed-south-{age}h-epoch0'));p.render(r);details=p.details.rows[-1][1];assert ('荷車のあと' in details)==(age==37);count+=1
    for age in [22,23]:
        r=engine('timeline',save=load(f'decisions-kiln-completed-east-{age}h-epoch0'));p.render(r);details=p.details.rows[-1][1];assert ('若い陶工が、イースの工房を訪ねてきている。' in details)==(age==23);count+=1
    r=engine('boundaries',save=load('decisions-wheel-missed-south-25h-epoch0'))
    with patch('timeline_ui.engine',return_value=r):TimelinePanel.run_boundaries(p)
    assert any('後日談' in row[-1] for row in p.boundary_tree.rows);count+=1
    print(f'PASS {count} decisions UI binding cases. No real Tk window was created.')
if __name__=='__main__':run(Path(sys.argv[1]))
