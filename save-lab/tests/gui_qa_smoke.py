"""Real Tk callbacks for boundary comparison and isolated synthetic export."""
import copy
import json
from pathlib import Path
import sys
import tempfile
import tkinter as tk
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from ui import App
from save_lab import engine,save_new
root=tk.Tk();app=App(root);checks=[]
output=Path(sys.argv[1]) if len(sys.argv)>1 else Path('notes/gui-qa-results.json')
def check(name,condition):
    if not condition:raise AssertionError(name)
    checks.append({'check':name,'passed':True})
def check_qa_rows(label):
    qa=app.qa;qa.canvas.yview_moveto(0);qa.tree.yview_moveto(0);root.update()
    rows=qa.tree.get_children()[:2]
    boxes=[qa.tree.bbox(row) for row in rows]
    top=qa.canvas.winfo_rooty();bottom=top+qa.canvas.winfo_height()
    check(label,qa.tree.winfo_height()>=100 and all(box and qa.tree.winfo_rooty()+box[1]>=top and qa.tree.winfo_rooty()+box[1]+box[3]<=bottom for box in boxes))

def run():
    success=False
    try:
        check('fixed version and SHA visible in title','v0.3.1' in root.title() and json.loads((Path(__file__).resolve().parents[1]/'vendor/source-manifest.json').read_text(encoding='utf-8'))['sourceSha'][:8] in root.title())
        check('synthetic QA can open without importing any save',app.work.after is None and len(app.qa.catalog['cases'])==22)
        root.geometry('1000x720');app.tabs.select(app.qa.frame);root.update();check_qa_rows('QA first two rows visible before generation at 1000x720')
        with tempfile.TemporaryDirectory() as directory:
            folder=Path(directory);fixture=engine('qa-fixtures',options={'caseIds':['kiln-accepted-20h']})['cases'][0]['save']
            source=folder/'test-source.json';save_new(source,fixture);original=source.read_bytes()
            with patch('ui.filedialog.askopenfilename',return_value=str(source)):app.open_file()
            root.update();a=copy.deepcopy(app.work.before);b=copy.deepcopy(app.work.after);panel=app.timeline
            app.tabs.select(app.qa.frame);root.update();check_qa_rows('QA first two rows visible with loaded source at 1000x720')
            app.tabs.select(panel.frame);panel.capture();panel.run_boundaries();root.update()
            check('kiln comparison shows six rows',len(panel.boundary_report['rows'])==6)
            check('past age explicitly unrun',panel.boundary_report['rows'][0]['status']=='not_run')
            check('20h mismatch visible',panel.boundary_report['rows'][1]['discrepancies'][0]['code']=='kiln_closed_but_success' and '境界差' in panel.warnings.get())
            check('boundary view and copy preservation',panel.boundary_area.winfo_ismapped() and app.work.before==a and app.work.after==b and source.read_bytes()==original)
            before=copy.deepcopy(panel.boundary_report);panel.run_boundaries();check('repeat comparison identical',panel.boundary_report==before)
            row=panel.boundary_tree.get_children()[1];panel.boundary_tree.selection_set(row);panel.select_boundary();check('full warning available on row selection','境界差' in panel.boundary_detail.get())
            target=folder/'boundary.report.json'
            with patch('timeline_ui.filedialog.asksaveasfilename',return_value=str(target)):panel.export()
            check('comparison exported as report only',json.loads(target.read_text(encoding='utf-8'))['kind']=='boundaryComparison')
            panel.advance.set('1');root.update();check('changed input clears entire boundary result',panel.boundary_report is None and not panel.boundary_area.winfo_ismapped() and panel.export_button.instate(['disabled']))
            panel.run_boundaries();check('past rows increase without rewinding',sum(r['status']=='not_run' for r in panel.boundary_report['rows'])==2)
            panel.advance.set('-1')
            with patch('timeline_ui.messagebox.showerror') as error:panel.run_boundaries();check('invalid comparison reports error',error.called)
            check('error clears old boundary export',panel.boundary_report is None and panel.report is None and panel.export_button.instate(['disabled']))
            app.sample();panel.capture();panel.quest.set(next(k for k,v in panel.quest_ids.items() if v=='standalone-kiln'));panel.destination.set('イース');panel.run_boundaries();root.update()
            forecasts=panel.boundary_report['rows'][0]['forecasts'];check('arrival stage is separate from starting stage',all('scenarioStages' in f for f in forecasts))
            current_before=copy.deepcopy(app.work.before);current_after=copy.deepcopy(app.work.after)
            qa=app.qa;app.tabs.select(qa.frame);root.update();qa.tree.selection_set('kiln-accepted-20h')
            with patch('qa_ui.filedialog.askdirectory',return_value=''):qa.generate()
            check('cancel generates no files',not (folder/'TEST-ONLY-5525-QA').exists())
            qa.folder.set('../invalid')
            with patch('qa_ui.messagebox.showerror') as error,patch('qa_ui.filedialog.askdirectory') as picker:qa.generate();check('unsafe folder name rejected before picker',error.called and not picker.called)
            qa.folder.set('TEST-ONLY-smoke')
            with patch('qa_ui.filedialog.askdirectory',return_value=str(folder)):qa.generate()
            output_folder=folder/'TEST-ONLY-smoke';check('selected synthetic case generated',(output_folder/'TEST-ONLY.kiln-accepted-20h.json').exists())
            saved=(output_folder/'TEST-ONLY.kiln-accepted-20h.json').read_bytes()
            with patch('qa_ui.filedialog.askdirectory',return_value=str(folder)),patch('qa_ui.messagebox.showerror') as error:qa.generate();check('existing output rejected without changes',error.called and (output_folder/'TEST-ONLY.kiln-accepted-20h.json').read_bytes()==saved)
            check('synthetic export never changes A B or original',app.work.before==current_before and app.work.after==current_after and source.read_bytes()==original)
            qa.tree.selection_remove(*qa.tree.selection())
            with patch('qa_ui.messagebox.showerror') as error:qa.generate();check('empty selection rejected',error.called)
            qa.select_all();check('select all restores 22 presets',len(qa.tree.selection())==22)
            for width,height in [(1000,720),(1180,812)]:
                root.geometry(f'{width}x{height}');root.update();app.tabs.select(qa.frame);root.update()
                check_qa_rows(f'QA first two rows visible after generation at {width}x{height}')
                qa.canvas.yview_moveto(1);root.update();check(f'QA detailed limits reachable {width}x{height}',qa.canvas.yview()[1]>=0.999 and qa.scrollbar.winfo_ismapped())
                check(f'QA action visible {width}x{height}',qa.generate_button.winfo_rootx()+qa.generate_button.winfo_width()<=root.winfo_rootx()+root.winfo_width() and qa.generate_button.winfo_rooty()+qa.generate_button.winfo_height()<root.winfo_rooty()+root.winfo_height())
                app.tabs.select(panel.frame);root.update();panel.canvas.yview_moveto(1);root.update()
                check(f'boundary tab bottom remains reachable {width}x{height}',panel.canvas.yview()[1]>=0.999)
                panel.canvas.yview_moveto(0);root.update()
                check(f'boundary action visible {width}x{height}',panel.boundary_button.winfo_rootx()+panel.boundary_button.winfo_width()<=root.winfo_rootx()+root.winfo_width())
        success=True
    except Exception as exc:checks.append({'error':str(exc),'passed':False})
    finally:
        output.parent.mkdir(parents=True,exist_ok=True);output.write_text(json.dumps({'passed':success,'checks':checks,'python':sys.version},ensure_ascii=False,indent=2),encoding='utf-8');root.destroy()
        if not success:raise SystemExit(1)
root.after(200,run);root.mainloop()
