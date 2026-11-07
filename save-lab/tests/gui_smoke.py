"""Run in a graphical session; exercises real Tk widgets and app callbacks."""
import json
from pathlib import Path
import sys
import tempfile
import tkinter as tk
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from ui import App
from save_lab import load_json, save_new
from test_metadata_files import with_metadata, metadata
Path('notes').mkdir(exist_ok=True)
root=tk.Tk();app=App(root)
results=[]
def check(label, condition):
    if not condition: raise AssertionError(label)
    results.append({'check':label,'passed':True})
def run():
    try:
        app.sample();root.update()
        check('official sample populates member list',len(app.members.get_children())==24)
        app.gold.set('1500');app.apply_member();root.update()
        check('gold form applies with official validation',app.work.after['state']['gold']==1500)
        app.fields['xp'].set('200');app.fields['str'].set('2');app.apply_member();root.update()
        c=app.work.after['state']['characters'][app.member_id]
        check('growth form keeps points consistent',c['level']==3 and c['statPoints']==2)
        app.gold.set('-1')
        with patch('ui.messagebox.showerror') as err:app.apply_member();check('invalid form shows error',err.called)
        check('invalid form leaves previous work intact',app.work.after['state']['gold']==1500)
        app.gold.set('7777');other=app.members.get_children()[1]
        with patch('ui.messagebox.askyesno',return_value=True):
            app.members.selection_set(other);app.select_member();root.update()
        check('discard on member switch resets pending gold',app.gold.get()=='1500' and not app.form_dirty)
        app.fields['xp'].set('100')
        with patch('ui.messagebox.showwarning') as warning:app.export_report();check('report refuses pending input',warning.called)
        with patch('ui.messagebox.askyesno',return_value=False):app.undo()
        check('undo cancellation keeps pending input',app.fields['xp'].get()=='100')
        app.refresh();root.update()
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'scenario.json'
            with patch('ui.filedialog.asksaveasfilename',return_value=str(path)):app.export()
            check('GUI export creates valid new save',load_json(path)[0]['state']['gold']==1500)
            original=path.read_bytes()
            with patch('ui.filedialog.asksaveasfilename',return_value=str(path)),patch('ui.messagebox.showerror') as err:app.export();check('GUI refuses existing destination',err.called)
            check('GUI overwrite refusal preserves bytes',path.read_bytes()==original)
        app.tabs.select(1);root.update()
        check('comparison tab populated',len(app.compare_tree.get_children())>=16)
        root.update_idletasks()
        check('primary action fits in window',app.export_button.winfo_rooty()+app.export_button.winfo_height()<=root.winfo_rooty()+root.winfo_height())
        app.tabs.select(0);root.update()
        check('apply action fits in window',app.apply_button.winfo_rooty()+app.apply_button.winfo_height()<=root.winfo_rooty()+root.winfo_height())
        check('equipment panel scrolls',app.edit_canvas.yview()[1]<1)
        with tempfile.TemporaryDirectory() as directory:
            source=Path(directory)/'synthetic-portraits.json'
            fixture=with_metadata(app.work.before);save_new(source,fixture)
            with patch('ui.filedialog.askopenfilename',return_value=str(source)),patch('ui.messagebox.askyesno',return_value=True):app.open_file()
            root.geometry('1180x812');root.update()
            check('portrait-bearing file opens in GUI',metadata(app.work.after)==metadata(fixture))
            check('GUI identifies preserved portraits',app.work.info['metadata']['portraits']==1)
            panel=app.apply_button.master.master
            check('apply footer fits inside panel with metadata notice',app.apply_button.winfo_rooty()+app.apply_button.winfo_height()<=panel.winfo_rooty()+panel.winfo_height())
            out=Path(directory)/'synthetic-copy.json'
            with patch('ui.filedialog.asksaveasfilename',return_value=str(out)):app.export()
            check('GUI export preserves all metadata',metadata(load_json(out)[0])==metadata(fixture))
            check('GUI import export leaves source intact',load_json(source)[0]==fixture)
        app.status.set('GUI検証完了: サンプル・編集・比較・別名保存・上書き拒否')
        Path('notes/gui-results.json').write_text(json.dumps({'passed':True,'checks':results,'python':sys.version},ensure_ascii=False,indent=2),encoding='utf8')
    except Exception as exc:
        Path('notes/gui-results.json').write_text(json.dumps({'passed':False,'checks':results,'error':str(exc)},ensure_ascii=False,indent=2),encoding='utf8')
        raise
root.after(500,run)
root.mainloop()
