# 5525 セーブ管理室 v0.4.0

ローカルのネイティブ画面とCLIで使う、セーブ管理・クエスト検証ツールです。
初回のゲーム参照取得と更新にはインターネット接続が必要です。セーブの読込・編集・比較・保存はPC内で完結します。

## できること

1. **状態を作る**: セーブを読み取り、作業コピーの所持金・HP/MP・EXP・能力配分・8枠の装備を変更
2. **装備・スキルを比べる**: 原本Aと作業Bの能力・装備由来スキル・付与元を比較
3. **クエスト時間・条件を確認**: 独立コピーで現行依頼・NPC予定・納品可否と既存の経路/休息予測を検証
4. 公式セーブ検証と再読込を通し、**必ず別名の新規JSON**へ保存
5. Godot版の立ち絵・キャンペーン識別情報・音楽設定を保持して別名保存
6. **人工QAを作る**: 実セーブを使わず22件の既定ケースを新規フォルダへ生成
7. クラウド担当はGUIなしのCLIから、同じ検証・編集・比較を実行

## ゲームとの同期

GUIの起動時に [5525 の main](https://github.com/wildfire13/5525) を確認し、セーブの読込・生成・検証に必要なルールとマスターDBを取得します。取得したファイルをコミットと照合し、動作検証が通った版をローカルキャッシュに保存します。書き出す形式はその版のゲームが決めます。ゲーム `4fb793e` では新規セーブ・編集後の保存ともにv3です。

画面のSHAはその作業で使用しているゲームのコミットです。作業中の版は固定されます。更新に失敗したときは以前に取得できた版で作業を続けられます。初回でキャッシュがない場合は接続を回復してから再実行してください。

CLIは前回の確認から24時間が経つと次の実行時に自動確認します。画面の「ゲーム更新を確認」から取得した新版は次回起動時に反映します。CLIからすぐに更新するには `python save_lab.py sync` を実行してください。キャッシュはユーザーのホーム下の `.cache/5525-save-lab` にあり、`SAVE_LAB_CACHE_DIR` で変更できます。取得済みの版をオフラインで使う場合は `SAVE_LAB_OFFLINE=1` を設定します。

## ③ クエスト時間・条件（v0.3.1）

「③ クエスト時間・条件」→「作業Bから検証コピーを作る」で開始します。①で未反映の入力がある場合は、先に反映してください。

- 受注中の依頼をそのまま確認できます。未受注なら、現在地の掲示板にある既存依頼と荷物担当をコピー上だけで選択できます。
- 「追加時間」で時間条件を仮定し、「移動先」で出発した場合の見通しを確認します。追加時間は毎回、作成時のコピーを起点とし、繰り返し押しても累積しません。
- 世界時刻、予定開始からの時間、通常依頼の旅の経過時間を区別します。単発依頼は受注時刻からではなく予定開始から判定されます。
- 近道・迂回・休息・引き返しは現行の公式予測を利用。戦闘勝利と荷物維持、その先は近道・追加休息なしを仮定します。SPD/Wtから街道時間は計算しません。戦闘準備/戦闘中の勝敗予測はありません。
- 到着先で公式 `completeQuest` を独立コピーに適用し、G・RP・EXPと失敗復元を区別して表示します。公式 `forecast` が額を返しても、納品先が違う、荷物担当が編成外などの条件では納品可能と表示しません。
- 行商人を待てる状態と到着処理待ちは、それぞれ公式処理後の納品結果も表示します。所持枠超過時は移動予測を出しません。
- 入力を変えると古い結果とJSON保存を無効化します。「条件を検証」で再計算してください。作業Bを変更・別ファイルを開くと検証コピーを作り直します。
- 原本A・作業B・Godot付加情報・実ファイルは書き換えません。このタブの検証コピーはゲーム用セーブへ書き出しません。人工QA生成は④の別機能です。「検証JSONを別名保存」はレポート専用で、既存ファイルを上書きしません。
- 新しい依頼・NPC経路・報酬・条件の企画編集、戦闘勝率、全経路の自動最適化は対象外です。

### 時間追加の意味と固定参照版の差

画面上部・タイトル・JSONに、使用中のゲームのSHAを表示します。v0.3.1では行商人の待機・到着案内と3件の依頼判断に追従しています。詳細な検証範囲は `notes/v0.3.1-verification.md` を参照してください。

追加時間は時間条件を調べるための仮定であり、その時間の移動・回復・戦闘・所持品消費を再現しません。未受注の依頼を選ぶ場合は、現在時点で受注してから時間を追加します。ゲームの操作リプレイとして使用しないでください。

参照コミット `36439cc4c6ab40e8e0a04f5e22b15d5b060e50a4` の行商人は、10h以上18h未満にアスタリス、18h以上36h以下にサウスで受取可能です。24hちょうどは満額220G、36hちょうどは110Gで納品できます。段階表示も24hが `south_full`、36hが `south_late` に一致します。到着前のサウスでは18hまで待機できます。ツールの待機後予測は公式処理を独立コピーで実行します。36h超の受注済み車輪は、担当が編成外でも全5町で期限切れ確認による失敗復元が可能です。成功納品とは区別し、世界時刻は保持します。未受注の荷車のあとはサウス37h以降だけ表示。窯後日談はイース23hのままで若い陶工の訪問説明を含みます。

### 境界前後を一括比較

「境界前後を一括比較」で、入力した条件を基準に単発依頼の境界を独立コピーで比較します。通常依頼は個別検証を使ってください。

- カブ17/18/19h、窯19/20/21/22/23/24h、車輪9/10/11/17/18/19/23/24/25/35/36/37h。単発依頼を選ぶと、その依頼の境界だけを表示。未受注なら全予定を表示します。
- 各行は同じ元コピーから実行します。基準時刻より前は「未実行」で、巻き戻しや地点変更は行いません。
- 「基準との差」は前行ではなく、追加時間と移動先を適用した基準結果との差です。現在地と経路到着時の段階・実納品判定を別行で示します。
- 窯20hのclosed/150G成功は、実際に納品成功を確かめた場合だけ境界差警告を表示します。誤目的地や荷物不在で成功と表示しません。
- 窯21hの焼成、22hの冷却、23hの返送段階を予定表に追加。23hの後日談は「納品完了済み・イース」の条件も必要です。段階表示だけで物語が発生するとは断言しません。
- 検証レポートだけを別名保存します。原本や立ち絵のデータを出力しません。

GUIの④人工QA生成は22件です。拡張検証用の `node tests/decisions_fixture_bundle.cjs` は、71件の人工セーブと条件・参照SHAを含むJSONを標準出力へ返します。ファイルへは保存しません。通常の新規フォルダ生成には④または `qa-fixtures` CLIを使用してください。生成済みセーブは製品パッケージに含めません。

### ④ 人工QA（実セーブとは完全に別）

公式の新規状態から作る22件の既定ケースです。入力セーブ・原本A・作業Bは一切参照しません。受注中の境界18件、未受注3件、窯の納品済み23h後日談1件を用意しています。

- 固定版のcreate/acceptを使用後、時刻と場所を直接設定する人工状態です。通しプレイ、移動・戦闘・回復・消費の再現ではありません。
- 公式validatorと保存再読込一致を検証。受注前rollback、荷物、時刻、受注状態の整合も回帰テストで確認します。
- GUIではケースを選択し、TEST-ONLY-で始まる新規フォルダへ生成。CLIも必ず新規フォルダが必要です。既存フォルダ、既存ファイル、シンボリックリンク先は拒否します。
- TEST-ONLY付きゲーム用JSON、fixture-manifest.json（ケース条件、固定参照SHA、保存ファイルSHA-256、納品実結果、未検証範囲）、注意書きを出力します。
- 生成失敗時はINCOMPLETE-TEST-ONLY.txtが残ります。そのフォルダは使用しないでください。
- 本番のゲームプロフィールへ配置・読込しません。ユーザーが別のテスト用プロフィールで読み込んで確認してください。生成成功はGodot画面の合格ではありません。
- 自由な時刻/場所/報酬入力、実セーブの改変、別エンジンの動的読込、修正前後エンジンの自動差分は今回対象外です。

### クエスト検証CLI

```sh
python save_lab.py timeline path/to/save.json
python save_lab.py timeline path/to/save.json --quest standalone-kiln --destination east --advance-hours 4
python save_lab.py timeline path/to/save.json --out quest-timeline.report.json
python save_lab.py boundaries path/to/save.json --out quest-boundaries.report.json
python save_lab.py qa-catalog
python save_lab.py qa-fixtures --case kiln-accepted-20h --out-dir TEST-ONLY-kiln20
python save_lab.py qa-fixtures --out-dir TEST-ONLY-all
node tests/test_timeline.cjs
node tests/test_boundaries.cjs
node tests/test_qa_fixtures.cjs
python tests/gui_timeline_smoke.py
python tests/gui_qa_smoke.py
```

`--quest` は現在の掲示板にあるIDのみ、受注中なら指定不要です。`--carrier` は編成中のポーターID、`--destination` は現在地から出発可能な地点IDのみを受け付けます。`--advance-hours` は0〜100000の整数です。JSONに参照コミット、予測前提、入力ファイルのSHA-256を含めます。原本の人物/画像データや再読込可能なセーブはレポートに入れません。

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

実行にはPythonとNode.jsが必要です。日本語表示にはWindows標準のYu Gothic UI/Meiryoなどを利用します。

## macOS / Linux

`python3 save_lab.py gui` または `./start-save-lab.sh`。
Tkや画面のない環境では下記CLIを使ってください。

## クラウド担当向けCLI

作業ディレクトリをこのフォルダへ移して実行します。JSON出力、エラー時終了コード2です。

`python3 save_lab.py sync` で初回取得した後に `python3 save_lab.py doctor` を実行すると、Python・SQLite・Node.jsと人工サンプルの公式保存/再読込を一括確認できます。実セーブや画面を開かず診断します。`ok: true` なら終了コード0、失敗時は終了コード2で `checks` の失敗段階・`code`・`next_steps` を返します。未実行の検証は `not_run` です。診断には実行パスが含まれるため、公開しないでください。

GUIの起動確認は別に `node launch.cjs --diagnose`、このツールの版確認は `python3 save_lab.py --version` です。

```sh
python3 save_lab.py doctor
python3 save_lab.py sample --out fresh.json
python3 save_lab.py validate fresh.json
python3 save_lab.py inspect fresh.json
python3 save_lab.py catalog
python3 save_lab.py edit fresh.json --patch examples/gold-and-growth.patch.json --out trial.json
python3 save_lab.py compare fresh.json trial.json --out comparison.json
```

Windowsでは `python3` を診断で確認できたPython実体のパス（例: `"C:/Python313/python.exe"`）に置き換えます。壊れた既定版がある場合は `py -3` を使わないでください。自動処理でUTF-8のJSONとして受け取る場合は、Pythonの直後に `-X utf8` を付けます（例: `python -X utf8 save_lab.py doctor`）。出力先が存在する場合は失敗します。`--force` はありません。

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

## Godot版セーブと立ち絵

Godotが付加する `nativePortraits`、`godotCampaignId`、`godotFrontend` はゲーム本体データと分けて検証し、元の値をそのまま保存します。立ち絵のbase64文字列とSHA-256は再生成せず、画像のバイト列を保持します。画像の編集・表示は行いません。

- 立ち絵の対象ID、SHA-256、PNG構造・CRC・圧縮データ・画像サイズを検証
- 画像は各辺1〜256px、base64は40万文字以下
- ゲームが通常生成するPNGの基本チャンクを扱います。補助・拡張チャンク付きのPNGは、この試作では画像を変換せず読込を停止します
- キャンペーンID・音楽設定は基準ゲームの形式に従って検証
- 本体データは取得した公式validatorで検証
- 未対応の最上位項目や不正な付加情報は、削除して通すのではなく読込を停止
- **このツールは立ち絵を含むファイル全体で1 MiB以下**。Godot本体の12 MiB上限より小さい制限を維持しています
- PNG検証は追加パッケージ不要のローカル構造検証です。ゲーム本体の画像デコード・描画やGodot画面からの実ロードを保証するものではありません

名前を変更したセーブも開けます。画面のファイル一覧は `.json` に絞っているため、この拡張子を残してください。

## 比較の限界

能力と装備由来のスキル/付与元は公式の実装値です。基礎SPDは重量超過や戦闘不能者負担を適用する前の値。画面の「攻撃」は公式stats.atkで、二刀全体の合計ダメージではありません。JSONには左右のattackWeaponsも含みます。

勝率、DPS、ターンシミュレーション、スキルダメージ期待値、最適編成、読み込んだゲーム用セーブのクエスト/時刻/所持品/戦闘中の編集、PCへの自動Pullは未実装です。③の時間追加は独立した検証用の仮定です。仮の勝率等は表示しません。

## テスト

```sh
python3 save_lab.py sync
python3 -m unittest discover -s tests -v
node tests/test_engine.cjs
node tests/test_launcher.cjs
node tests/test_metadata.cjs
node tests/test_timeline.cjs
node tests/test_boundaries.cjs
node tests/test_qa_fixtures.cjs
node tests/test_npc_parity.cjs
node tests/test_decisions_parity.cjs
```

Windowsのsandboxなどでシンボリックリンク/ハードリンクのテスト用ファイルを作れない場合、該当する3項目（ハードリンク1・シンボリックリンク2）だけが理由付きの `SKIP` になります。製品の上書き禁止処理は変えていません。リンク対応環境では実リンクを使う検証が実行され、通常ファイルと原本の上書き拒否・排他的な新規作成の検証はリンク権限に関係なく実行します。`SKIP` は合格扱いではなく、その環境で未検証という意味です。

過去版の実施結果は `notes/verification.md`、v0.3.0の検証範囲と限界は `notes/v0.3.0-verification.md`、v0.3.1は `notes/v0.3.1-verification.md` を参照。`notes/npc-qa-verification.md` と `notes/decisions-qa-verification.md` は隔離候補の検証履歴です。

## 構成・共有元

- `launch.cjs`: Python実体の自動検出、Tk/SQLite起動前検証、診断
- `save-lab.config.example.json`: PC固有設定のひな型
- `save_lab.py`: CLI、原本保護、新規ファイル出力
- `ui.py`: ネイティブTk画面
- `engine.cjs`: 公式エンジンへの限定アダプタ
- `metadata-envelope.cjs`: Godot付加情報の分離検証・保持
- `quest-timeline.cjs`: 独立コピーの時間・納品・経路検証
- `timeline_ui.py`: ③専用の入力・結果・境界比較・予定表・前提表示
- `qa-fixtures.cjs` / `qa_ui.py`: ④専用、入力セーブを受け取らない人工QA生成
- `game_source.py` と `game-source.cjs`：GitHubからの取得、キャッシュと使用中のゲーム版の解決
- `examples/`: 人工サンプル・パッチ
- `tests/`: ローカルファイル保護・エンジンの回帰テスト

専用リポジトリ等にソースを置き、PCとクラウドで同じcommitを使う運用に適しています。実ユーザーのセーブはリポジトリへ入れないでください。同じソースをPCとクラウドで使用できます。Site公開やセーブの外部同期は行いません。

## デザインの参照

デザインは、情報密度・原本/作業コピーの区別・数値差分の読みやすさを優先。Damir Sokolovsky (@heydamir) のUnslopを参照。UnslopはCC BY 4.0、参照版 `1d13095e4bef6ad6c74f1dd828d84c4ba309a4dc`。
https://github.com/heydamir/unslop/tree/1d13095e4bef6ad6c74f1dd828d84c4ba309a4dc/skills/unslop

ゲーム側のソースは公式リポジトリから取得します。このパッケージに第三者への公開ライセンスを追加していません。専用リポジトリへ置く際は所有権と公開範囲を確認してください。

[v0.4.0の同期・セーブ相互運用の検証結果](notes/v0.4.0-verification.md)

## ローカル環境

このフォルダの `.env.example` を `.env` にコピーし、利用する実行ファイルやフォルダを設定します。相対パスはこのフォルダが基準です。プロセス環境の指定を優先します。
# Windows runtime configuration

Both `Start-Save-Lab.cmd` and `Diagnose-Save-Lab.cmd` use `bootstrap.ps1`
to read the ignored `.env` before starting Node. Copy `.env.example` to
`.env` and set `SAVE_LAB_NODE` and `SAVE_LAB_PYTHON` to executable paths
when the runtimes are not available on PATH. Spaces and Unicode are supported;
matching single or double quotes are optional. Relative paths resolve beside
`.env`. Values are never evaluated as shell commands.

Explicit process environment variables take precedence over `.env`.
Without a Node setting, the entry uses `node` from PATH. Python discovery
retains its existing fallback order: environment, local JSON configuration,
PATH, then Windows Python launcher registrations. A missing Node exits with
code 2; missing or unusable Python candidates are reported by diagnosis.
The diagnostic entry preserves the result code after its pause.

Regression checks (no private `.env` is read by these tests):

```text
python -m unittest discover -s save-lab/tests -p test_bootstrap.py
node save-lab/tests/test_launcher.cjs
```
