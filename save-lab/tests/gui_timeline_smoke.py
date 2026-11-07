"""Real Tk callback tests. Synthetic data only; exits automatically after tests."""
import copy
import json
from pathlib import Path
import sys
import tempfile
import tkinter as tk
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from ui import App
from save_lab import save_new
from test_metadata_files import with_metadata

root = tk.Tk(); app = App(root); checks = []
output = Path(sys.argv[1]) if len(sys.argv)>1 else Path('notes/gui-timeline-results.json')

def check(label, condition):
    if not condition: raise AssertionError(label)
    checks.append({'check':label,'passed':True})

def run():
    success = False
    try:
        app.sample(); root.update(); panel=app.timeline
        app.tabs.select(panel.frame); root.update()
        check('independent third tab exists',app.tabs.tab(panel.frame,'text').startswith('③'))
        a=copy.deepcopy(app.work.before); b=copy.deepcopy(app.work.after)
        panel.capture();root.update()
        check('copy made without touching A or B',panel.frozen==b and panel.frozen is not app.work.after and app.work.before==a and app.work.after==b)
        label=next(k for k,v in panel.quest_ids.items() if v=='standalone-kiln')
        panel.quest.set(label); panel.destination.set('イース'); panel.run();root.update()
        check('existing quest routes calculate',len(panel.report['forecasts'])==2 and panel.report['forecasts'][0]['delivery']['result']['gold']==150)
        check('results preserve A B and undo stack',app.work.before==a and app.work.after==b and not app.work.undo_stack)
        panel.advance.set('18');root.update()
        check('input change invalidates old result and export',panel.report is None and panel.export_button.instate(['disabled']) and not panel.tree.get_children())
        panel.run();root.update()
        check('late single quest reports official failure',panel.report['forecasts'][0]['delivery']['result']['outcome']=='failed')
        report=copy.deepcopy(panel.report);panel.run();root.update()
        check('repeat run does not advance twice',panel.report==report)
        panel.advance.set('-1')
        with patch('timeline_ui.messagebox.showerror') as error: panel.run();check('invalid input error shown',error.called)
        check('failed run leaves baseline and B intact',panel.report is None and panel.frozen==b and app.work.after==b)
        panel.advance.set('0');panel.run();root.update()
        with tempfile.TemporaryDirectory() as directory:
            target=Path(directory)/'quest-report.json'
            with patch('timeline_ui.filedialog.asksaveasfilename',return_value=str(target)):panel.export()
            original=target.read_bytes(); saved=json.loads(original)
            check('report is not an importable save',saved['copyOnly'] and 'characters' not in saved['state'] and 'save' not in saved)
            with patch('timeline_ui.filedialog.asksaveasfilename',return_value=str(target)),patch('timeline_ui.messagebox.showerror') as error:
                panel.export();check('report overwrite refused',error.called and target.read_bytes()==original)
            with patch('timeline_ui.filedialog.asksaveasfilename',return_value=''):panel.export()
            check('cancelled export preserves results',panel.report==saved)
            source=Path(directory)/'synthetic-metadata.json';save_new(source,with_metadata(a)); original_source=source.read_bytes()
            with patch('ui.filedialog.askopenfilename',return_value=str(source)):app.open_file()
            root.update();check('new source invalidates old verification',panel.frozen is None and panel.report is None)
            panel.capture();panel.run();root.update()
            check('portrait-bearing source stays intact',source.read_bytes()==original_source and app.work.after==panel.frozen)
        app.tabs.select(0);app.gold.set('888')
        with patch('timeline_ui.messagebox.showwarning') as warning:panel.capture();check('pending B input prevents ambiguous capture',warning.called)
        app.apply_member();root.update()
        check('changing B invalidates verification',panel.frozen is None and panel.report is None)
        app.tabs.select(panel.frame);panel.capture();root.update()
        for width,height in [(1000,720),(1180,812)]:
            root.geometry(f'{width}x{height}');root.update()
            check(f'export fits {width}x{height}',panel.export_button.winfo_rootx()+panel.export_button.winfo_width()<=root.winfo_rootx()+root.winfo_width() and panel.export_button.winfo_rooty()+panel.export_button.winfo_height()<=root.winfo_rooty()+root.winfo_height())
            panel.canvas.yview_moveto(1);root.update()
            check(f'assumptions section reachable {width}x{height}',panel.canvas.yview()[1]>=0.999)
            panel.details.yview_moveto(1);root.update()
            check(f'assumptions final line reachable with visible scrollbar {width}x{height}',panel.details_scrollbar.winfo_ismapped() and panel.details.yview()[1]>=0.999 and panel.details.bbox('end-2c') is not None)
            check(f'common notice wraps inside window {width}x{height}',app.notice_label.winfo_rootx()+app.notice_label.winfo_width()<=root.winfo_rootx()+root.winfo_width())
        panel.canvas.yview_moveto(0);root.update()
        success=True
    except Exception as exc:
        checks.append({'error':str(exc),'passed':False})
    finally:
        output.parent.mkdir(parents=True,exist_ok=True)
        output.write_text(json.dumps({'passed':success,'checks':checks,'python':sys.version},ensure_ascii=False,indent=2),encoding='utf-8')
        root.destroy()
        if not success: raise SystemExit(1)

root.after(200,run)
root.mainloop()
