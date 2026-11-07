"""Quest verification tab. All probes use a frozen copy, never Workspace edits."""
from __future__ import annotations
import copy
import json
import tkinter as tk
from tkinter import ttk, filedialog, messagebox
from save_lab import engine, save_new, LabError


def reward_text(delivery):
    result = delivery.get('result')
    if not result:
        return '—'
    return f'{result.get("gold", 0):,} G / {result.get("rp", 0):,} RP / {result.get("xp", 0):,} EXP'


class TimelinePanel:
    def __init__(self, notebook, app):
        self.app = app
        self.frozen = None
        self.report = None
        self.boundary_report = None
        self.quest_ids = {'受注中の依頼 / 未受注のまま': None}
        self.destination_ids = {'現在地で確認': None}
        self.carrier_ids = {'自動選択': None}
        self.frame = ttk.Frame(notebook, padding=16)
        toolbar = ttk.Frame(self.frame); toolbar.pack(fill='x', pady=(0, 12))
        ttk.Button(toolbar, text='作業Bから検証コピーを作る', command=self.capture, style='Accent.TButton').pack(side='left')
        self.export_button = ttk.Button(toolbar, text='検証JSONを別名保存', command=self.export, state='disabled'); self.export_button.pack(side='right')
        self.source = tk.StringVar(value='セーブを読み込み、検証コピーを作成してください')
        ttk.Label(self.frame, textvariable=self.source, style='Muted.TLabel', wraplength=900).pack(anchor='w', pady=(0, 8))
        area = ttk.Frame(self.frame); area.pack(fill='both', expand=True)
        self.canvas = tk.Canvas(area, bg='#f4f4f5', highlightthickness=0)
        scrollbar = ttk.Scrollbar(area, orient='vertical', command=self.canvas.yview)
        self.canvas.configure(yscrollcommand=scrollbar.set)
        self.canvas.pack(side='left', fill='both', expand=True); scrollbar.pack(side='right', fill='y')
        self.body = ttk.Frame(self.canvas)
        inner = self.canvas.create_window((0, 0), window=self.body, anchor='nw')
        self.body.bind('<Configure>', lambda _: self.canvas.configure(scrollregion=self.canvas.bbox('all')))
        self.canvas.bind('<Configure>', lambda event: self.canvas.itemconfigure(inner, width=event.width))
        form = ttk.Frame(self.body); form.pack(fill='x', pady=(0, 12))
        form.columnconfigure(1, weight=1); form.columnconfigure(3, weight=1)
        self.quest = tk.StringVar(value=next(iter(self.quest_ids)))
        self.destination = tk.StringVar(value=next(iter(self.destination_ids)))
        self.carrier = tk.StringVar(value=next(iter(self.carrier_ids)))
        self.advance = tk.StringVar(value='0')
        ttk.Label(form, text='検証する依頼').grid(row=0, column=0, sticky='w', padx=(0, 8), pady=4)
        self.quest_box = ttk.Combobox(form, textvariable=self.quest, state='disabled', width=32)
        self.quest_box.grid(row=0, column=1, columnspan=3, sticky='ew', pady=4)
        ttk.Label(form, text='荷物担当').grid(row=1, column=0, sticky='w', padx=(0, 8), pady=4)
        self.carrier_box = ttk.Combobox(form, textvariable=self.carrier, state='disabled', width=22)
        self.carrier_box.grid(row=1, column=1, sticky='ew', padx=(0, 16), pady=4)
        ttk.Label(form, text='移動先').grid(row=1, column=2, sticky='w', padx=(0, 8), pady=4)
        self.destination_box = ttk.Combobox(form, textvariable=self.destination, state='disabled', width=22)
        self.destination_box.grid(row=1, column=3, sticky='ew', pady=4)
        ttk.Label(form, text='追加時間').grid(row=2, column=0, sticky='w', padx=(0, 8), pady=4)
        time_row = ttk.Frame(form); time_row.grid(row=2, column=1, columnspan=3, sticky='ew', pady=4)
        self.advance_entry = ttk.Entry(time_row, textvariable=self.advance, width=9, state='disabled'); self.advance_entry.pack(side='left')
        ttk.Label(time_row, text='時間  /  コピーの現在時刻に加算', style='Muted.TLabel').pack(side='left', padx=8)
        self.run_button = ttk.Button(time_row, text='条件を検証', command=self.run, state='disabled'); self.run_button.pack(side='right')
        boundary_actions = ttk.Frame(self.body); boundary_actions.pack(fill='x', pady=(0, 12))
        self.boundary_button = ttk.Button(boundary_actions, text='境界前後を一括比較', command=self.run_boundaries, state='disabled'); self.boundary_button.pack(side='left')
        ttk.Label(boundary_actions, text='同じ入力を起点に比較 / 過去へは巻き戻しません', style='Muted.TLabel').pack(side='left', padx=12)
        self.clock = tk.StringVar(value='世界時刻・予定開始・依頼の経過を分けて表示します')
        ttk.Label(self.body, textvariable=self.clock, style='Sub.TLabel', wraplength=900).pack(anchor='w', pady=(0, 8))
        self.quest_summary = tk.StringVar(value='原本Aと作業Bは変更しません。検証結果はセーブとして保存できません')
        ttk.Label(self.body, textvariable=self.quest_summary, wraplength=900).pack(anchor='w', pady=(0, 8))
        self.warnings = tk.StringVar()
        ttk.Label(self.body, textvariable=self.warnings, style='Muted.TLabel', wraplength=900).pack(anchor='w', pady=(0, 8))
        ttk.Label(self.body, text='納品と経路の見通し', style='Sub.TLabel').pack(anchor='w', pady=(4, 8))
        self.tree = app.tree(self.body, [('action','確認条件',160), ('time','世界時刻',85), ('place','到着地点',100), ('status','納品判定',225), ('reward','G / RP / EXP',230)], height=5)
        for key in ('action','place','status','reward'): self.tree.column(key, anchor='w')
        self.tree.tag_configure('available', foreground='#12685d')
        self.tree.tag_configure('blocked', foreground='#55575c')
        ttk.Label(self.body, text='戦闘勝利・荷物維持、その先は近道・休息なしを仮定。戦利品と戦闘EXPは含みません', style='Muted.TLabel', wraplength=900).pack(anchor='w', pady=(8, 16))
        self.boundary_area = ttk.Frame(self.body)
        ttk.Label(self.boundary_area, text='時間境界の比較', style='Sub.TLabel').pack(anchor='w', pady=(0, 8))
        self.boundary_tree = app.tree(self.boundary_area, [('age','予定から',85),('action','条件',145),('place','地点',95),('stage','段階表示',100),('status','実納品判定',225),('reward','G / RP / EXP',215),('change','基準との差',180)], height=7)
        for key in ('action','place','stage','status','reward','change'): self.boundary_tree.column(key, anchor='w')
        self.boundary_tree.tag_configure('warning', foreground='#8a4b08')
        self.boundary_tree.tag_configure('not_run', foreground='#55575c')
        self.boundary_notes = {}
        self.boundary_detail = tk.StringVar(value='行を選択すると境界差や基準との差を表示します')
        ttk.Label(self.boundary_area, textvariable=self.boundary_detail, wraplength=900).pack(anchor='w', pady=(8, 16))
        self.boundary_tree.bind('<<TreeviewSelect>>', self.select_boundary)
        self.schedule_heading = ttk.Label(self.body, text='NPC予定と希望条件', style='Sub.TLabel'); self.schedule_heading.pack(anchor='w', pady=(0, 8))
        self.schedule = app.tree(self.body, [('at','予定開始から',100), ('event','出来事',260), ('detail','境界の扱い',480)], height=5)
        self.schedule.column('event', anchor='w'); self.schedule.column('detail', anchor='w')
        ttk.Label(self.body, text='予測の前提と参照版', style='Sub.TLabel').pack(anchor='w', pady=(16, 8))
        detail_frame = ttk.Frame(self.body); detail_frame.pack(fill='x', pady=(0, 8))
        self.details = tk.Text(detail_frame, wrap='word', height=13, bg='white', fg='#202124', relief='flat', padx=12, pady=12, state='disabled')
        self.details_scrollbar = ttk.Scrollbar(detail_frame, orient='vertical', command=self.details.yview)
        self.details.configure(yscrollcommand=self.details_scrollbar.set)
        self.details.pack(side='left', fill='x', expand=True); self.details_scrollbar.pack(side='right', fill='y')
        for var in (self.quest, self.destination, self.carrier, self.advance):
            var.trace_add('write', self.mark_stale)
        self.invalidate()

    def mark_stale(self, *_):
        if self.report is not None:
            self.report = None
            self.clear_boundaries()
            self.export_button.configure(state='disabled')
            self.tree.delete(*self.tree.get_children())
            self.clock.set('入力を変更しました。「条件を検証」で再計算してください')
            self.quest_summary.set('前回の納品判定を消去しました。原本A・作業Bは未変更')
            self.warnings.set('')

    def invalidate(self):
        self.frozen = None; self.report = None
        self.clear_boundaries()
        self.source.set('作業Bから独立した検証コピーを作成してください。①の未反映入力は先に反映してください')
        for widget in (self.quest_box, self.destination_box, self.carrier_box, self.advance_entry, self.run_button, self.boundary_button, self.export_button): widget.configure(state='disabled')
        for tree in (self.tree, self.schedule): tree.delete(*tree.get_children())
        self.clock.set('検証コピー未作成')
        self.quest_summary.set('原本Aと作業Bは変更しません。検証コピーからセーブは出力しません')
        self.warnings.set('')
        self.details.configure(state='normal'); self.details.delete('1.0', 'end'); self.details.configure(state='disabled')

    def capture(self):
        if self.app.work.after is None:
            messagebox.showinfo('セーブ未読込', '先にセーブを開くか、公式サンプルを作成してください', parent=self.app.root); return
        if self.app.form_dirty:
            messagebox.showwarning('未反映の入力', '①の入力を反映するか、元に戻してからコピーしてください', parent=self.app.root); return
        try:
            candidate = copy.deepcopy(self.app.work.after)
            report = engine('timeline', save=candidate)
            self.frozen = candidate
            self.quest_ids = {'受注中の依頼 / 未受注のまま': None, **{q['name']:q['id'] for q in report['availableQuests']}}
            self.destination_ids = {'現在地で確認': None, **{p['name']:p['id'] for p in report['destinations']}}
            self.carrier_ids = {'自動選択': None, **{p['name']:p['id'] for p in report['carriers']}}
            for box, var, mapping in ((self.quest_box,self.quest,self.quest_ids),(self.destination_box,self.destination,self.destination_ids),(self.carrier_box,self.carrier,self.carrier_ids)):
                box.configure(values=list(mapping), state='readonly'); var.set(next(iter(mapping)))
            self.advance.set('0'); self.advance_entry.configure(state='normal'); self.run_button.configure(state='normal'); self.boundary_button.configure(state='normal')
            self.source.set('検証コピー作成済み / 変更はこのタブの検証だけに使用 / 原本A・作業Bは未変更')
            self.render(report)
        except (LabError, OSError, ValueError) as exc: self.error(exc)

    def get_options(self):
        text = self.advance.get().strip()
        if not text.isascii() or not text.isdigit(): raise LabError('追加時間は0以上の整数にしてください')
        options = {'advanceHours':int(text)}
        for key, value in (('questId',self.quest_ids.get(self.quest.get())),('destination',self.destination_ids.get(self.destination.get()))):
            if value: options[key] = value
        if options.get('questId') and self.carrier_ids.get(self.carrier.get()): options['carrierId'] = self.carrier_ids[self.carrier.get()]
        return options

    def run(self):
        if self.frozen is None: return
        try:
            self.render(engine('timeline', save=self.frozen, options=self.get_options()))
        except (LabError, OSError, ValueError) as exc: self.error(exc)

    def clear_boundaries(self):
        self.boundary_report = None
        self.boundary_tree.delete(*self.boundary_tree.get_children())
        self.boundary_area.pack_forget()
        self.boundary_notes = {}
        self.boundary_detail.set('行を選択すると境界差や基準との差を表示します')
        self.export_button.configure(text='検証JSONを別名保存')

    def select_boundary(self, *_):
        selection = self.boundary_tree.selection()
        if selection: self.boundary_detail.set(self.boundary_notes.get(selection[0], ''))

    def run_boundaries(self):
        if self.frozen is None: return
        try:
            report = engine('boundaries', save=self.frozen, options=self.get_options())
            self.render(report['baseline'])
            self.boundary_report = report
            self.boundary_area.pack(fill='x', before=self.schedule_heading, pady=(0, 8))
            names = {'turnip':'カブ','kiln':'窯','wheel':'車輪'}
            for row in report['rows']:
                if row['status'] == 'not_run':
                    item = self.boundary_tree.insert('', 'end', values=(f'{row["age"]}h',names[row['eventId']], '—','—','未実行 / 基準より前','—','—'), tags=('not_run',))
                    self.boundary_notes[item] = row.get('reason','基準時刻より前なので実行しません。時刻は巻き戻しません')
                    continue
                changes = row.get('changes',[])
                labels = {'stage':'段階','delivery':'納品','forecasts':'経路','warnings':'警告','discrepancies':'境界差'}
                diff = ' / '.join(labels.get(c['field'],c['field']) for c in changes) or '変化なし'
                detail = '\n'.join(row.get('warnings',[]))
                for change in changes:
                    key, before, after = change['field'], change['before'], change['after']
                    if key == 'stage': detail += f'\n段階: {before} → {after}'
                    elif key == 'delivery': detail += f'\n納品: {before["reason"]} ({reward_text(before)}) → {after["reason"]} ({reward_text(after)})'
                    elif key == 'forecasts': detail += '\n経路の到着時刻・納品判定を再計算しました。全差分は比較JSONに保存できます'
                    else: detail += f'\n{labels.get(key,key)}: {len(before)}件 → {len(after)}件'
                current = row['delivery']
                item = self.boundary_tree.insert('', 'end', values=(f'{row["age"]}h',names[row['eventId']]+' / 現在地',row['state']['locationName'],row['stage'],current['reason'],reward_text(current),diff), tags=('warning',) if row.get('discrepancies') else ())
                self.boundary_notes[item] = detail.strip() or '基準と同じ判定です。各行は入力コピーから独立して実行しています'
                for forecast in row['forecasts']:
                    delivery = forecast['delivery']
                    item = self.boundary_tree.insert('', 'end', values=(f'{forecast["calendarAge"]}h',f'{row["age"]}h + {forecast["label"]}',forecast['destinationName'],forecast.get('scenarioStages',{}).get(row['eventId'],'—'),delivery['reason'],reward_text(delivery),'到着時点の判定'), tags=('warning',) if forecast.get('discrepancies') else ())
                    self.boundary_notes[item] = '\n'.join(forecast.get('warnings',[])) or '戦闘勝利・荷物維持を仮定した到着時点。現在地の段階表示とは別です'
            self.export_button.configure(text='境界比較JSONを別名保存')
            self.app.status.set('境界前後を独立コピーで比較しました。未実行の時刻と実行結果を区別しています')
        except (LabError, OSError, ValueError) as exc: self.error(exc)

    def error(self, exc):
        # Do not leave a previous result looking like the rejected input's result.
        self.report = None; self.clear_boundaries(); self.export_button.configure(state='disabled')
        self.tree.delete(*self.tree.get_children())
        self.clock.set('検証できません。入力を修正して再実行してください')
        self.quest_summary.set(str(exc)); self.warnings.set('原本A・作業B・検証元コピーは未変更')
        messagebox.showerror('条件を検証できません', str(exc), parent=self.app.root)

    def render(self, report):
        self.clear_boundaries()
        self.report = report
        clock, state, quest = report['clock'], report['state'], report['activeQuest']
        self.clock.set(f'世界時刻 {clock["worldTime"]}h  /  予定開始から {clock["calendarAge"]}h  /  経過時間 {clock["elapsedHours"]}h')
        if quest:
            basis = '予定開始から' if quest['timeBasis'] == 'calendar' else '依頼の旅の経過'
            self.quest_summary.set(f'{quest["name"]}\n{quest["fromName"]} → {quest["toName"]}  /  {basis} {quest["conditionClock"]}h、希望条件 {quest["conditionHours"]}h以内')
        else: self.quest_summary.set('未受注 / 検証する既存の依頼を選択できます。新しいシナリオの作成・編集は行いません')
        self.warnings.set('\n'.join(report['warnings']))
        self.tree.delete(*self.tree.get_children())
        rows = [('現在地で納品', clock['worldTime'], state['locationName'], report['delivery'])]
        if report['afterArrival']: rows.append(('到着処理後',clock['worldTime'],report['afterArrival']['locationName'],report['afterArrival']['delivery']))
        if report['waitForMerchant']:
            wait = report['waitForMerchant']; rows.append((f'行商人を待つ (+{wait["hours"]}h)',wait['worldTime'],state['locationName'],wait['delivery']))
        for row in report['forecasts']: rows.append((f'{row["label"]} (+{row["additionalHours"]}h)',row['worldTime'],row['destinationName'],row['delivery']))
        for label, time, location, delivery in rows:
            self.tree.insert('', 'end', values=(label,f'{time}h',location,delivery['reason'],reward_text(delivery)), tags=('available' if delivery['available'] else 'blocked',))
        self.schedule.delete(*self.schedule.get_children())
        for event in report['calendar']['schedule']:
            self.schedule.insert('', 'end', values=(f'{event["at"]}h',event['label'],event['detail']))
        details = f'参照版: {report["sourceSha"]}\n{report["sourceUrl"]}\n\n' + '\n\n'.join(report['assumptions'])
        self.details.configure(state='normal'); self.details.delete('1.0', 'end'); self.details.insert('1.0', details); self.details.configure(state='disabled'); self.details.yview_moveto(0)
        self.export_button.configure(state='normal')

    def export(self):
        if self.report is None: return
        path = filedialog.asksaveasfilename(title='クエスト検証レポートを別名保存', initialfile='quest-boundaries.report.json' if self.boundary_report else 'quest-timeline.report.json', defaultextension='.json', filetypes=[('JSON','*.json')], parent=self.app.root)
        if not path: return
        try:
            save_new(path, self.boundary_report or self.report)
            self.app.status.set('クエスト検証JSONを別名保存しました。セーブデータではありません')
        except (LabError, OSError, ValueError) as exc:
            messagebox.showerror('レポートを保存できません', str(exc), parent=self.app.root)
