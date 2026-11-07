# 5525 セーブ管理室

ローカルのネイティブ画面とCLIで使う、セーブ管理ツールの初版です。
ブラウザ、Webサーバー、アカウント、ネット接続は不要。セーブを外部へ送信しません。

## できること

1. **状態を作る**: セーブを読み取り、作業コピーの所持金・HP/MP・EXP・能力配分・8枠の装備を変更
2. **装備・スキルを比べる**: 原本Aと作業Bの能力・装備由来スキル・付与元を比較
3. 公式セーブ検証と再読込を通し、**必ず別名の新規JSON**へ保存
4. クラウド担当はGUIなしのCLIから、同じ検証・編集・比較を実行

現行 `wildfire13/5525` の `22e0b190ec0bb88d9438ef19487e587cd7e82b95` を基準に公式コードを同梱。手書きの類似計算ではありません。ゲーム本体は起動せず、保存/読込・能力計算コードを直接使います。

## Windowsで起動

必要: Python 3.10以上（Tk付き）、Node.js 18以上。追加のpip/npmパッケージは不要です。

1. ZIPを任意のフォルダへすべて展開
2. `Start-Save-Lab.cmd` をダブルクリック
3. 最初は「公式サンプルを作成」で試す
4. 「入力を反映」→ 比較タブで差分を確認 →「Bを別名保存」

既存のPythonを探し、Python 3.10以上・SQLite・Tkの実起動を確認してから開きます。PATH上の実体を `py` の既定版より先に試すため、壊れた別バージョンの登録に引っ張られにくくしています。候補の起動前検証に失敗したときだけ次を試し、アプリ起動後のエラーでは二重起動しません。

### 場所を設定するファイル

`save-lab.config.example.json` を同じフォルダで `save-lab.local.json` にコピーします。空欄は自動検出です。

```json
{
  "python": "C:/Python313/python.exe",
  "saveDirectory": "C:/Games/5525"
}
```

上記は書式例です。`python` は実際に起動できるPython実体、`saveDirectory` は「セーブを開く」の初期フォルダへ置き換えてください。Windowsでも `/` 区切りで指定すると、バックスラッシュのエスケープが不要です。セーブファイルは自動選択・読込しません。

`save-lab.local.json` はPC固有設定としてGitの対象外です。配布ZIPや公開リポジトリに自分の設定ファイルを追加しないでください。既存PythonやWindows環境設定を変更する必要はありません。

既存の `SAVE_LAB_PYTHON` 環境変数も利用でき、設定ファイルより優先します。明示指定が起動前検証に失敗した場合は、警告を表示して他の既存Pythonを試します。実際に選んだパスは `[Using Python]` に表示されます。

Node.jsがPATH上にない場合は、同じcmdで `set "SAVE_LAB_NODE=C:\実際の場所\node.exe"` を指定してから起動できます。Nodeの自動インストールはしません。

### 起動しない場合の診断

`Diagnose-Save-Lab.cmd` をダブルクリックすると、試したPython・失敗理由・実際に使えるPython/Tkの結果を表示します。アプリやセーブは開かず、ソフト導入・登録変更は行いません。診断の出力にはローカルのパスが含まれるため、公開しないでください。

Pythonが未導入の場合だけ、python.orgのWindows版（Tcl/Tk付き）とnodejs.orgのLTS版を用意してください。このツールはインストールやPC設定変更を自動実行しません。

ソース同梱版です。単体EXEではなくPython/Node.jsが必要です。日本語表示にはWindows標準のYu Gothic UI/Meiryoなどを利用します。

## macOS / Linux

`python3 save_lab.py gui` または `./start-save-lab.sh`。
Tkや画面のない環境では下記CLIを使ってください。

## クラウド担当向けCLI

作業ディレクトリをこのフォルダへ移して実行します。JSON出力、エラー時終了コード2です。

```sh
python3 save_lab.py sample --out fresh.json
python3 save_lab.py validate fresh.json
python3 save_lab.py inspect fresh.json
python3 save_lab.py catalog
python3 save_lab.py edit fresh.json --patch examples/gold-and-growth.patch.json --out trial.json
python3 save_lab.py compare fresh.json trial.json --out comparison.json
```

Windowsでは `python3` を診断で確認できたPython実体のパス（例: `"C:/Python313/python.exe"`）に置き換えます。壊れた既定版がある場合は `py -3` を使わないでください。出力先が存在する場合は失敗します。`--force` はありません。

パッチは許可された項目だけを受け付けます。EXPに合わせてLv・スキルポイント・未配分能力ポイントを整合。未配分が負になる変更、HP/MP上限超過、装備条件違反、未知のキーを拒否します。

```json
{
  "gold": 1500,
  "characters": {
    "recruit-porter-human-male": {
      "xp": 200,
      "hp": 110,
      "mp": 6,
      "allocations": {"str": 2, "int": 0, "agi": 0},
      "equipment": {"head": "empty-head"}
    }
  }
}
```

キャラIDと装備IDは `inspect` / `catalog` の実際の出力を参照してください。古いセーブではキャラ構成が異なります。スキルは装備から導かれるため、自由なskills配列は受け付けません。

## 原本と実セーブの扱い

- 元ファイルを読むだけ。別名保存でも同名ファイル、シンボリックリンク、ハードリンクの上書きを拒否
- 読込後に元ファイルが別のアプリで変わったら保存を止める
- 1 MiB超過、JSON重複キー、NaN/Infinity、不正状態を拒否
- **街・未受注だけ編集可能**。移動・戦闘・野営等は読取・比較専用
- 公式移行が必要な旧セーブは移行済みコピーを作り、警告を表示。比較の原本Aは公式移行後の状態。元のバイト列は変えない
- 新しい出力を実ゲームで読み込む操作はユーザーが行う。本番セーブとは別に保管して試す
- この版より新しいゲームのセーブ互換は未保証。検証に失敗したら編集を止め、ゲーム側のバージョンに追従が必要
- 装備の変更は管理者用の直接交換。購入費用は引かず、所持品を消費せず、外した装備をバッグへ戻さない

## 比較の限界

能力と装備由来のスキル/付与元は公式の実装値です。基礎SPDは重量超過や戦闘不能者負担を適用する前の値。画面の「攻撃」は公式stats.atkで、二刀全体の合計ダメージではありません。JSONには左右のattackWeaponsも含みます。

勝率、DPS、ターンシミュレーション、スキルダメージ期待値、最適編成、クエスト/時刻/所持品/戦闘中の編集、PCへの自動Pullは未実装です。仮の勝率等は表示しません。

## テスト

```sh
python3 -m unittest discover -s tests -v
node tests/test_engine.cjs
node tests/test_launcher.cjs
```

同梱公式テストは `vendor/5525/native` で実行可能。実施結果・GUI検証範囲は `notes/verification.md` を参照。

## 構成・共有元

- `launch.cjs`: Python実体の自動検出、Tk/SQLite起動前検証、診断
- `save-lab.config.example.json`: PC固有設定のひな型
- `save_lab.py`: CLI、原本保護、新規ファイル出力
- `ui.py`: ネイティブTk画面
- `engine.cjs`: 公式エンジンへの限定アダプタ
- `vendor/`: 固定版の公式コード、マスターDB、出典ハッシュ、生成サンプル
- `examples/`: 人工サンプル・パッチ
- `tests/`: ローカルファイル保護・エンジンの回帰テスト

専用リポジトリ等にソースを置き、PCとクラウドで同じcommitを使う運用に適しています。実ユーザーのセーブはリポジトリへ入れないでください。同じソースをPCとクラウドで使用できます。Site公開やセーブの外部同期は行いません。

## デザインの参照

デザインは、情報密度・原本/作業コピーの区別・数値差分の読みやすさを優先。Damir Sokolovsky (@heydamir) のUnslopを参照。UnslopはCC BY 4.0、参照版 `1d13095e4bef6ad6c74f1dd828d84c4ba309a4dc`。
https://github.com/heydamir/unslop/tree/1d13095e4bef6ad6c74f1dd828d84c4ba309a4dc/skills/unslop

5525同梱ソースはユーザー所有リポジトリ由来です。このパッケージに第三者への公開ライセンスを追加していません。専用リポジトリへ置く際は所有権と公開範囲を確認してください。
