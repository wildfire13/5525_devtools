"""Native Tk interface. No browser, web server, or third-party UI dependencies."""
from __future__ import annotations
import json
import tkinter as tk
from tkinter import ttk, filedialog, messagebox, font
from pathlib import Path
from save_lab import Workspace, LabError, engine, save_new

BG = '#f4f4f5'
INK = '#202124'
MUTED = '#55575c'
ACCENT = '#12685d'
PHASES = {'town': '街', 'road': '街道', 'deployment': '戦闘準備', 'battle': '戦闘中', 'camp': '野営', 'arrival': '到着', 'result': '結果'}
STAT_LABELS = {'max': '最大HP', 'maxMp': '最大MP', 'atk': '攻撃', 'reach': '射程', 'speed': '基礎SPD', 'str': '筋力', 'int': '知力', 'agi': '敏捷'}
SLOT_LABELS = {'rightHand': '右手', 'leftHand': '左手', 'head': '頭', 'upperBody': '上半身', 'lowerBody': '下半身', 'feet': '足', 'accessory1': '装飾1', 'accessory2': '装飾2'}

class App:
    def __init__(self, root):
        self.root = root
        self.work = Workspace()
        self.member_id = None
        self.catalog = engine('catalog')
        self.gear = {x['id']: x for x in self.catalog['gear']}
        self.refreshing = False
        self.form_dirty = False
        self.root.title('5525 セーブ管理室 | ローカル試作')
        self.root.geometry('1320x900')
        self.root.minsize(1000, 720)
        self.root.configure(bg=BG)
        self.style()
        self.build()
        self.root.protocol('WM_DELETE_WINDOW', self.close)
        self.root.bind('<Control-o>', lambda _: self.open_file())
        self.root.bind('<Control-Shift-S>', lambda _: self.export())
        self.root.bind('<Control-z>', lambda _: self.undo())
        self.status.set('セーブを開くか、サンプルを作成してください。実セーブ原本には書き込みません')

    def style(self):
        families = font.families(self.root)
        family = next((x for x in ['Yu Gothic UI', 'Meiryo', 'Noto Sans CJK JP', 'Noto Sans JP', 'DejaVu Sans'] if x in families), 'TkDefaultFont')
        self.root.option_add('*Font', (family, 11))
        s = ttk.Style(self.root)
        s.theme_use('clam')
        s.configure('.', font=(family, 11), background=BG, foreground=INK)
        s.configure('TFrame', background=BG)
        s.configure('TLabel', background=BG, foreground=INK)
        s.configure('Muted.TLabel', foreground=MUTED)
        s.configure('Title.TLabel', font=(family, 22))
        s.configure('Sub.TLabel', font=(family, 13))
        s.configure('TButton', padding=(12, 8))
        s.configure('Accent.TButton', background=ACCENT, foreground='white', borderwidth=0)
        s.map('Accent.TButton', background=[('disabled', '#dddddf'), ('active', '#175b54')], foreground=[('disabled', '#626268'), ('!disabled', 'white')])
        s.configure('Treeview', rowheight=32, background='white', fieldbackground='white', borderwidth=0, font=(family, 11))
        s.configure('Treeview.Heading', padding=(8, 8), background='#e9e9eb')
        s.map('Treeview', background=[('selected', ACCENT)], foreground=[('selected', 'white')])
        s.configure('TNotebook.Tab', padding=(16, 8))
        s.configure('TLabelframe', borderwidth=1, relief='solid')
        s.configure('TLabelframe.Label', foreground=MUTED)
        s.configure('TEntry', padding=6)
        s.configure('TCombobox', padding=4)

    def build(self):
        outer = ttk.Frame(self.root, padding=16); outer.pack(fill='both', expand=True)
        top = ttk.Frame(outer); top.pack(fill='x')
        ttk.Label(top, text='5525 セーブ管理室', style='Title.TLabel').pack(side='left')
        ttk.Label(top, text='ローカル専用  /  原本保護', style='Muted.TLabel').pack(side='left', padx=24)
        self.export_button = ttk.Button(top, text='Bを別名保存', style='Accent.TButton', command=self.export, state='disabled'); self.export_button.pack(side='right')
        tools = ttk.Frame(outer); tools.pack(fill='x', pady=(16, 12))
        ttk.Button(tools, text='セーブを開く', command=self.open_file).pack(side='left')
        ttk.Button(tools, text='公式サンプルを作成', command=self.sample).pack(side='left', padx=8)
        self.undo_button = ttk.Button(tools, text='ひとつ戻す', command=self.undo, state='disabled'); self.undo_button.pack(side='left', padx=(16, 8))
        self.reset_button = ttk.Button(tools, text='Aからやり直す', command=self.reset, state='disabled'); self.reset_button.pack(side='left')
        self.source = tk.StringVar(value='原本A  未読込')
        ttk.Label(outer, textvariable=self.source, style='Muted.TLabel', wraplength=1180).pack(anchor='w')
        self.summary = tk.StringVar(value='セーブの状態・メンバー・装備を読み込み後に表示します')
        ttk.Label(outer, textvariable=self.summary, style='Sub.TLabel').pack(anchor='w', pady=(12, 12))
        self.notice = tk.StringVar(value='編集できるのは街・未受注の状態です。移動中・戦闘中は確認と比較のみ')
        ttk.Label(outer, textvariable=self.notice, style='Muted.TLabel', wraplength=1180).pack(anchor='w', pady=(0, 16))
        self.status = tk.StringVar()
        ttk.Label(outer, textvariable=self.status, style='Muted.TLabel', wraplength=1100).pack(side='bottom', anchor='w', pady=(12, 0))
        self.tabs = ttk.Notebook(outer); self.tabs.pack(fill='both', expand=True)
        edit = ttk.Frame(self.tabs, padding=16)
        compare = ttk.Frame(self.tabs, padding=16)
        raw = ttk.Frame(self.tabs, padding=16)
        self.tabs.add(edit, text='① 状態を作る'); self.tabs.add(compare, text='② 装備・スキルを比べる'); self.tabs.add(raw, text='変更内容')
        edit.columnconfigure(0, weight=1); edit.columnconfigure(1, weight=1); edit.rowconfigure(1, weight=1)
        global_bar = ttk.Frame(edit); global_bar.grid(row=0, column=0, columnspan=2, sticky='ew', pady=(0, 12))
        ttk.Label(global_bar, text='作業Bの所持金').pack(side='left')
        self.gold = tk.StringVar(); self.gold.trace_add('write', self.mark_dirty); self.gold_entry = ttk.Entry(global_bar, textvariable=self.gold, width=12); self.gold_entry.pack(side='left', padx=12)
        self.gold_button = ttk.Button(global_bar, text='入力を反映', command=self.apply_member, state='disabled'); self.gold_button.pack(side='left')
        left = ttk.Frame(edit); left.grid(row=1, column=0, sticky='nsew', padx=(0, 16))
        ttk.Label(left, text='メンバー', style='Sub.TLabel').pack(anchor='w', pady=(0, 8))
        self.members = self.tree(left, [('name', '名前', 130), ('level', 'Lv', 50), ('hp', 'HP', 90), ('atk', '攻撃', 60), ('reach', '射程', 60)], height=9)
        self.members.bind('<<TreeviewSelect>>', self.select_member)
        ttk.Label(left, text='数値は現行ゲームの公式計算\n自由なスキル付与や戦闘勝率の予測は行いません', style='Muted.TLabel', wraplength=380).pack(anchor='w', pady=16)
        right = ttk.Frame(edit); right.grid(row=1, column=1, sticky='nsew')
        self.member_title = tk.StringVar(value='メンバーを選択')
        ttk.Label(right, textvariable=self.member_title, style='Sub.TLabel').pack(anchor='w', pady=(0, 8))
        scroll_area = ttk.Frame(right); scroll_area.pack(fill='both', expand=True)
        canvas = tk.Canvas(scroll_area, bg=BG, highlightthickness=0, width=420, height=280)
        bar = ttk.Scrollbar(scroll_area, orient='vertical', command=canvas.yview)
        canvas.configure(yscrollcommand=bar.set)
        canvas.pack(side='left', fill='both', expand=True); bar.pack(side='right', fill='y')
        scroll_body = ttk.Frame(canvas)
        inner = canvas.create_window((0, 0), window=scroll_body, anchor='nw')
        scroll_body.bind('<Configure>', lambda event: canvas.configure(scrollregion=canvas.bbox('all')))
        canvas.bind('<Configure>', lambda event: canvas.itemconfigure(inner, width=event.width))
        self.edit_canvas = canvas
        form = ttk.Frame(scroll_body); form.pack(fill='x')
        self.fields = {}; self.member_controls = []
        for row, (key, label) in enumerate([('xp', 'EXP'), ('hp', '現在HP'), ('mp', '現在MP'), ('str', '筋力配分'), ('int', '知力配分'), ('agi', '敏捷配分')]):
            col = (row % 2) * 2; r = row // 2
            ttk.Label(form, text=label).grid(row=r, column=col, sticky='w', padx=(0, 8), pady=4)
            var = tk.StringVar(); ent = ttk.Entry(form, textvariable=var, width=9)
            ent.grid(row=r, column=col+1, sticky='ew', padx=(0, 16), pady=4)
            self.fields[key] = var; self.member_controls.append(ent)
            var.trace_add('write', self.mark_dirty)
        self.equipment = {}; self.equip_labels = {}
        slotframe = ttk.Frame(scroll_body); slotframe.pack(fill='both', expand=True, pady=(12, 0))
        slotframe.columnconfigure(1, weight=1)
        slots = list(self.catalog.get('slots', SLOT_LABELS))
        for row, slot in enumerate(slots):
            ttk.Label(slotframe, text=SLOT_LABELS.get(slot, slot)).grid(row=row, column=0, sticky='w', padx=(0, 12), pady=4)
            var = tk.StringVar(); box = ttk.Combobox(slotframe, textvariable=var, state='readonly', width=28)
            box.grid(row=row, column=1, sticky='ew', pady=4)
            self.equipment[slot] = (var, box)
            self.member_controls.append(box); var.trace_add('write', self.mark_dirty)
        footer = ttk.Frame(right); footer.pack(fill='x', pady=(12, 0))
        self.apply_button = ttk.Button(footer, text='入力を反映', command=self.apply_member, style='Accent.TButton', state='disabled'); self.apply_button.pack(side='right')
        ttk.Label(footer, text='EXPからLvを調整', style='Muted.TLabel').pack(side='left')
        compare_top = ttk.Frame(compare); compare_top.pack(fill='x', pady=(0, 12))
        self.compare_title = tk.StringVar(value='原本A → 作業B')
        ttk.Label(compare_top, textvariable=self.compare_title, style='Sub.TLabel').pack(side='left')
        ttk.Button(compare_top, text='比較JSONを別名保存', command=self.export_report).pack(side='right')
        self.compare_tree = self.tree(compare, [('subject', '対象', 150), ('field', '項目', 160), ('before', '原本A', 260), ('after', '作業B', 260), ('delta', '差分', 80)], height=14)
        self.compare_tree.tag_configure('changed', foreground=ACCENT)
        ttk.Label(compare, text='装備由来スキル・能力値の比較です。戦闘の勝率・最適編成・スキル期待値は未計算', style='Muted.TLabel').pack(anchor='w', pady=(12, 0))
        self.details = tk.Text(raw, wrap='word', bg='white', fg=INK, relief='flat', padx=16, pady=16, state='disabled')
        self.details.pack(fill='both', expand=True)
        self.set_editable(False)

    def tree(self, parent, cols, height):
        box = ttk.Frame(parent); box.pack(fill='both', expand=True)
        tree = ttk.Treeview(box, columns=[x[0] for x in cols], show='headings', selectmode='browse', height=height)
        for key, name, width in cols:
            tree.heading(key, text=name); tree.column(key, width=width, minwidth=40, anchor='w' if key in ('name', 'subject', 'field', 'before', 'after') else 'e')
        vertical = ttk.Scrollbar(box, orient='vertical', command=tree.yview)
        horizontal = ttk.Scrollbar(box, orient='horizontal', command=tree.xview)
        tree.configure(yscrollcommand=vertical.set, xscrollcommand=horizontal.set)
        tree.grid(row=0, column=0, sticky='nsew'); vertical.grid(row=0, column=1, sticky='ns'); horizontal.grid(row=1, column=0, sticky='ew')
        box.columnconfigure(0, weight=1); box.rowconfigure(0, weight=1)
        return tree

    def mark_dirty(self, *_):
        if not self.refreshing: self.form_dirty = True

    def fail(self, exc):
        messagebox.showerror('変更を反映できません', str(exc), parent=self.root)
        self.status.set('変更は反映していません。入力を修正してください')

    def guard(self, action):
        try: return action()
        except (LabError, OSError, ValueError, KeyError) as exc: self.fail(exc)

    def discard_ok(self):
        if self.work.undo_stack or self.form_dirty:
            return messagebox.askyesno('作業Bを閉じますか', '未保存の作業を破棄して続けますか。原本Aは変更しません', parent=self.root)
        return True

    def open_file(self):
        path = filedialog.askopenfilename(title='5525セーブJSONを選択', filetypes=[('JSON', '*.json')], parent=self.root)
        if path and self.discard_ok():
            def action():
                self.work.open(path); self.member_id = None; self.refresh(); self.status.set('原本Aを読み込み、作業Bをメモリ内に複製しました')
            self.guard(action)

    def sample(self):
        if self.discard_ok():
            def action():
                self.work.sample(); self.member_id = None; self.refresh(); self.status.set('公式の新規ゲームからサンプルを生成しました。実セーブは使っていません')
            self.guard(action)

    def set_editable(self, editable):
        state = 'normal' if editable else 'disabled'
        self.gold_entry.configure(state=state); self.gold_button.configure(state=state)
        self.apply_button.configure(state=state)
        for control in self.member_controls:
            control.configure(state=('readonly' if isinstance(control, ttk.Combobox) else 'normal') if editable else 'disabled')

    def refresh(self):
        self.refreshing = True
        info = self.work.info; s = info['summary']
        self.source.set('原本A  ' + (str(self.work.source_path) if self.work.source_path else '公式サンプル / 実セーブ未使用'))
        location = s.get('locationName', s.get('location', ''))
        self.summary.set(f'作業B   {PHASES.get(s["phase"], s["phase"])} / {location}     所持金 {s["gold"]:,} G     経過 {s.get("hours", 0)} 時間     隊Lv {s.get("level", 1)}')
        self.notice.set(('編集可能: 街・未受注。装備の直接交換はデバッグ用で、所持品の売買・返却は行いません' if s.get('editable') else '読取専用: 街・未受注以外は、進行スナップショットを壊さないよう編集を制限しています') + ('  /  ' + ' / '.join(info.get('warnings', [])) if info.get('warnings') else ''))
        self.gold.set(str(s['gold']))
        for child in self.members.get_children(): self.members.delete(child)
        for m in info['members']:
            self.members.insert('', 'end', iid=m['id'], values=(m['name'], m['level'], f'{m["hp"]}/{m["stats"]["max"]}', m['stats']['atk'], m['stats']['reach']))
        if self.member_id not in {m['id'] for m in info['members']}: self.member_id = info['members'][0]['id'] if info['members'] else None
        if self.member_id: self.members.selection_set(self.member_id); self.load_member()
        self.set_editable(bool(s.get('editable')))
        self.export_button.configure(state='normal')
        self.undo_button.configure(state='normal' if self.work.undo_stack else 'disabled')
        self.reset_button.configure(state='normal' if self.work.undo_stack else 'disabled')
        self.refresh_compare()
        self.form_dirty = False; self.refreshing = False

    def select_member(self, _=None):
        selection = self.members.selection()
        if self.refreshing or not selection or selection[0] == self.member_id: return
        if self.form_dirty and not messagebox.askyesno('未反映の入力', '入力中の値を破棄し、別のメンバーを表示しますか', parent=self.root):
            self.members.selection_set(self.member_id); return
        self.member_id = selection[0]; self.refreshing = True; self.gold.set(str(self.work.info['summary']['gold'])); self.load_member(); self.form_dirty = False; self.refreshing = False; self.refresh_compare()

    def load_member(self):
        m = next(x for x in self.work.info['members'] if x['id'] == self.member_id)
        raw = self.work.after['state']['characters'][self.member_id]
        self.member_title.set(f'{m["name"]}  /  {m.get("role", m.get("job", ""))}  /  作業B')
        for key, var in self.fields.items(): var.set(str(raw.get('allocations', {}).get(key, 0) if key in ('str', 'int', 'agi') else m[key]))
        for slot, (var, box) in self.equipment.items():
            choices = []
            for g in self.catalog['gear']:
                allowed = g.get('allowedSlots') or g.get('slots') or [g.get('slot')]
                aliases = {'rightHand': 'weapon', 'upperBody': 'armor'}
                if slot in allowed or aliases.get(slot) in allowed or (slot.startswith('accessory') and 'accessory' in allowed):
                    choices.append(f'{g["id"]} | {g["name"]}')
            current = m.get('equipment', {}).get(slot, '')
            if current:
                label = f'{current} | {self.gear.get(current, {}).get("name", current)}'
                if label not in choices: choices.append(label)
                var.set(label)
            else: var.set('')
            box.configure(values=choices)

    def apply_gold(self):
        def action():
            self.work.apply({'gold': int(self.gold.get())}); self.refresh(); self.status.set('作業Bの所持金を反映しました。公式再読込検証に合格')
        self.guard(action)

    def apply_member(self):
        def action():
            values = {key: int(var.get()) for key, var in self.fields.items()}
            patch = {key: values[key] for key in ('xp', 'hp', 'mp')}
            patch['allocations'] = {key: values[key] for key in ('str', 'int', 'agi')}
            patch['equipment'] = {slot: var.get().split(' | ')[0] for slot, (var, _) in self.equipment.items() if var.get()}
            self.work.apply({'gold': int(self.gold.get()), 'characters': {self.member_id: patch}}); self.refresh(); self.status.set('作業Bに反映しました。装備条件・成長整合性・公式再読込検証に合格')
        self.guard(action)

    def refresh_compare(self):
        report = self.work.compare()
        for child in self.compare_tree.get_children(): self.compare_tree.delete(child)
        def show(value):
            return str(value) if value is not None else '—'
        bm = {m['id']: m for m in report['before']['members']}
        a_gold, b_gold = report['before']['summary']['gold'], report['after']['summary']['gold']
        self.compare_tree.insert('', 'end', values=('隊', '所持金', a_gold, b_gold, f'{b_gold-a_gold:+g}'), tags=('changed',) if a_gold != b_gold else ())
        for m in report['after']['members']:
            if m['id'] != self.member_id: continue
            self.compare_title.set(f'{m["name"]}  /  原本A → 作業B')
            old = bm.get(m['id'], {})
            for key, label in STAT_LABELS.items():
                a, b = old.get('stats', {}).get(key), m['stats'].get(key)
                delta = f'{b-a:+g}' if isinstance(a, (int, float)) and isinstance(b, (int, float)) and a != b else '—'
                self.compare_tree.insert('', 'end', values=(m['name'], label, show(a), show(b), delta), tags=('changed',) if a != b else ())
            for slot in self.equipment:
                a, b = old.get('equipment', {}).get(slot), m.get('equipment', {}).get(slot)
                an = self.gear.get(a, {}).get('name', a); bn = self.gear.get(b, {}).get('name', b)
                self.compare_tree.insert('', 'end', values=(m['name'], SLOT_LABELS.get(slot, slot), show(an), show(bn), '変更' if a != b else '—'), tags=('changed',) if a != b else ())
            def grant_map(value):
                return {(x.get('slot', ''), x.get('grantSlot', 0)):x for x in value}
            ag, bg = grant_map(old.get('skills', [])), grant_map(m.get('skills', []))
            for slot, grant in sorted(set(ag) | set(bg)):
                def grant_name(x):
                    if not x: return 'なし'
                    return str(x.get('name', x['id'])) + (' Lv'+str(x['level']) if x.get('level') else '')
                a, b = grant_name(ag.get((slot, grant))), grant_name(bg.get((slot, grant)))
                label = f"{SLOT_LABELS.get(slot, slot)} 技能{grant}"
                self.compare_tree.insert('', 'end', values=(m['name'], label, a, b, '変更' if a != b else '—'), tags=('changed',) if a != b else ())
        changed = [x for x in report['rows'] if x.get('before') != x.get('after')]
        text = f'変更 {len(changed)} 項目\n公式エンジン: {self.catalog.get("sourceSha", "pinned main")}\n原本SHA-256: {self.work.source_hash or "生成サンプル"}\n\n'
        text += '\n'.join(f'{r.get("subject", "")} / {r.get("field", "")}: {r.get("before", "")} → {r.get("after", "")}' for r in changed) or '原本Aと作業Bは同じ内容です'
        text += '\n\n出力は別名のJSONです。ゲーム側の読込操作は自動実行しません。\n装備変更は管理者用の直接交換です。費用は発生せず、外した装備の所持品追加も行いません。\nこの版では状態編集、装備能力と付与スキルの比較に対応。戦闘シミュレーション・スキルダメージ期待値は未実装です。'
        self.details.configure(state='normal'); self.details.delete('1.0', 'end'); self.details.insert('1.0', text); self.details.configure(state='disabled')

    def undo(self):
        if self.form_dirty and not messagebox.askyesno('未反映の入力', '入力中の値を破棄して、ひとつ戻しますか', parent=self.root): return
        if self.work.undo_stack:
            self.guard(lambda: (self.work.undo(), self.refresh(), self.status.set('ひとつ前の作業Bに戻しました')))

    def reset(self):
        if self.work.before is not None and messagebox.askyesno('Aからやり直す', '作業Bを原本Aの内容に戻しますか。「ひとつ戻す」で取り消せます', parent=self.root):
            self.guard(lambda: (self.work.reset(), self.refresh(), self.status.set('原本Aから作業Bを作り直しました')))

    def export(self):
        if self.work.after is None: return
        if self.form_dirty:
            messagebox.showwarning('未反映の入力', '入力中の値があります。「入力を反映」またはメンバーの切替で破棄してから保存してください', parent=self.root); return
        name = (self.work.source_path.stem if self.work.source_path else '5525-sample') + '-test.json'
        path = filedialog.asksaveasfilename(title='作業Bを新しい名前で保存', initialfile=name, defaultextension='.json', filetypes=[('JSON', '*.json')], confirmoverwrite=False, parent=self.root)
        if path:
            def action():
                saved = self.work.export(path); self.status.set(f'別名保存済み: {saved}  /  原本は変更していません')
            self.guard(action)

    def export_report(self):
        if self.work.after is None: return
        if self.form_dirty:
            messagebox.showwarning('未反映の入力', '先に「入力を反映」するか、入力を破棄してください', parent=self.root); return
        path = filedialog.asksaveasfilename(title='比較結果を新しい名前で保存', initialfile='5525-comparison.json', defaultextension='.json', filetypes=[('JSON', '*.json')], confirmoverwrite=False, parent=self.root)
        if path: self.guard(lambda: (save_new(path, self.work.compare()), self.status.set('比較結果を別名保存しました')))

    def close(self):
        if self.discard_ok(): self.root.destroy()

def run_gui():
    try:
        root = tk.Tk()
    except tk.TclError as exc:
        raise LabError('画面を開けません。GUIのないクラウド担当はCLIを使用してください') from exc
    try: App(root)
    except Exception:
        root.destroy(); raise
    root.mainloop()

if __name__ == '__main__': run_gui()
