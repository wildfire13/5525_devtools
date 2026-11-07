"""Synthetic fixtures have no connection to imported saves or the edit workspace."""
from __future__ import annotations
import re
import tkinter as tk
from tkinter import ttk, filedialog, messagebox
from pathlib import Path
from save_lab import engine, export_qa_bundle, LabError


class QAPanel:
    def __init__(self, notebook, app):
        self.app = app
        self.catalog = engine('qa-catalog')
        self.frame = ttk.Frame(notebook, padding=16)
        ttk.Label(self.frame, text='人工QAセーブ / TEST ONLY', style='Sub.TLabel').pack(anchor='w')
        self.notice = ttk.Label(self.frame, text='原本A・作業Bは使いません。時刻と場所の合成データです。本番へ自動配置しません', wraplength=900)
        self.notice.pack(anchor='w', pady=(8, 8))
        footer = ttk.Frame(self.frame); footer.pack(side='bottom', fill='x', pady=(8, 0))
        row = ttk.Frame(footer); row.pack(fill='x')
        ttk.Label(row, text='新規フォルダ名').pack(side='left')
        self.folder = tk.StringVar(value='TEST-ONLY-5525-QA')
        self.entry = ttk.Entry(row, textvariable=self.folder, width=30); self.entry.pack(side='left', padx=12)
        self.generate_button = ttk.Button(row, text='保存場所を選んで生成', command=self.generate, style='Accent.TButton'); self.generate_button.pack(side='right')
        area = ttk.Frame(self.frame); area.pack(fill='both', expand=True)
        self.canvas = tk.Canvas(area, bg='#f4f4f5', highlightthickness=0)
        self.scrollbar = ttk.Scrollbar(area, orient='vertical', command=self.canvas.yview)
        self.canvas.configure(yscrollcommand=self.scrollbar.set)
        self.canvas.pack(side='left', fill='both', expand=True); self.scrollbar.pack(side='right', fill='y')
        self.body = ttk.Frame(self.canvas)
        inner = self.canvas.create_window((0, 0), window=self.body, anchor='nw')
        self.body.bind('<Configure>', lambda _: self.canvas.configure(scrollregion=self.canvas.bbox('all')))
        self.canvas.bind('<Configure>', lambda event: self.canvas.itemconfigure(inner, width=event.width))
        self.reference = ttk.Label(self.body, text=f'固定参照 {self.catalog["sourceSha"]}  /  別SHAのゲームは未検証', style='Muted.TLabel', wraplength=900)
        bar = ttk.Frame(self.body); bar.pack(fill='x', pady=(0, 4))
        ttk.Label(bar, text='生成するケースを選択 / Ctrl・Shiftで複数選択', style='Muted.TLabel').pack(side='left')
        ttk.Button(bar, text='全件を選択', command=self.select_all).pack(side='right')
        self.tree = app.tree(self.body, [('case','ケース',340), ('age','予定から',80), ('place','開始地点',100), ('mode','状態',110)], height=10)
        self.tree.configure(selectmode='extended')
        for key in ('case','place','mode'): self.tree.column(key, anchor='w')
        names={'north':'ノース','astaris':'アスタリス','east':'イース','south':'サウス'}
        for item in self.catalog['cases']:
            self.tree.insert('', 'end', iid=item['id'], values=(item['label'],f'{item["age"]}h',names[item['location']],{'accepted':'受注中','offered':'未受注','completed':'納品済み'}[item['mode']]))
        self.select_all()
        self.reference.pack(anchor='w', pady=(12, 4))
        self.result = tk.StringVar(value='既存フォルダには書き込みません。ゲームのセーブ先へ自動配置しません')
        self.result_label = ttk.Label(self.body, textvariable=self.result, wraplength=900); self.result_label.pack(anchor='w', pady=(12, 8))
        self.limit_label = ttk.Label(self.body, text='出力: TEST-ONLY付きセーブ、参照SHA・各ファイルSHA-256・納品結果の一覧、注意書き\n公式validator・保存再読込を確認します。通しプレイ・実画面は未検証です。\n実ゲームでは本番と分けたテスト用プロフィールで確認してください', style='Muted.TLabel', wraplength=900)
        self.limit_label.pack(anchor='w')
        self.frame.bind('<Configure>', lambda event: self.notice.configure(wraplength=max(240,event.width-32)))
        self.body.bind('<Configure>', lambda event: [label.configure(wraplength=max(240,event.width)) for label in (self.reference,self.result_label,self.limit_label)], add='+')

    def select_all(self):
        self.tree.selection_set(self.tree.get_children())

    def generate(self):
        ids = list(self.tree.selection())
        name = self.folder.get().strip()
        try:
            if not ids: raise LabError('生成するケースを1つ以上選択してください')
            if not re.fullmatch(r'TEST-ONLY-[A-Za-z0-9][A-Za-z0-9_.-]{0,79}', name) or name.endswith('.'):
                raise LabError('フォルダ名はTEST-ONLY-に続けて英数字・ハイフン・_・.を指定してください')
            parent = filedialog.askdirectory(title='人工QA専用の新規フォルダを作る場所', parent=self.app.root, mustexist=True)
            if not parent: return
            result = export_qa_bundle(Path(parent)/name, ids)
            self.result.set(f'{result["case_count"]}ケースを新規生成しました\n{result["saved_directory"]}\n実ゲームでの読込・表示: 未検証')
            self.app.status.set('人工QAのみを新規保存しました。原本A・作業B・ゲームのプロフィールは未変更')
        except (LabError, OSError, ValueError) as exc:
            self.result.set('生成できませんでした。既存ファイルは上書きしていません')
            messagebox.showerror('人工QAを生成できません', str(exc), parent=self.app.root)
