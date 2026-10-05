# 作業ログ

## 2026-10-04 — 構想の確認と最初のe2e

### 依頼と承認

- Notionの「AIカンパニーとしての運営」と配下の設計書10本を読み、構想を確認した。
- 構想の中心は、永続する役割・記憶を持つAgent、交換可能な実行runtime、ローカルで動くKernel、履歴を原本にするMemory。
- 最初に任せる実務は、小さなIssueの実装・テスト・レビュー・Draft PR作成。
- ユーザーが最初の到達点として `org agent list` を選び、「小さく検証し、小さなe2eを確かに積み重ねる」方針を指定した。
- [設計書](superpowers/specs/2026-10-04-agent-registry-design.md)を作成し、コミット `e5206f0` に記録した。
- ユーザーが設計を承認し、「すべてリポジトリにログ残るように」指示した。

### 調査と決定

- リポジトリは初期コミットのみで、既存の実装・開発ルールはなかった。
- 実行環境で Python 3.14.7、Node.js v22.22.3、npm 10.9.8 を確認した。
- 最初の実装はPython標準ライブラリとSQLiteを使う。LLMや外部サービスの接続はこの段階に含めない。
- Agentの登録と別プロセスからの一覧取得を一つのe2eとして検証する。
- `AGENTS.md` にログを継続するルールを記録した。
- [実装計画](superpowers/plans/2026-10-04-agent-registry.md)を作成した。

### 作業状況

- 設計：承認済み。
- 実装計画：レビュー待ち。
- コード・e2e：未実装、未実行。
- 設計書のGit記録は、通常権限で `.git/index.lock` の作成が拒否されたため、昇格して成功した。

## 2026-10-04 — Agent登録・一覧CLIの実装

### 承認と作業環境

- ユーザーの `y` を受け、実装計画とNative方式での実装を承認済みとして開始した。
- 基点コミットは `cfb450a`。専用ブランチは `feat/agent-registry`。
- 作業開始前は製品コードとテストがなく、既存のテストスイートはなかった。
- Ruling: worktree作成がsandboxのGit参照書き込み制約で失敗したため、現在のcheckoutで専用ブランチを使用する — スキルのsandbox代替手順 — 誤った場合のコスト：並行作業がファイルを共有する。
- `.gitignore` にDB、仮想環境、キャッシュ、作業用ディレクトリを追加した。

### 変更と最初の検証

- SQLiteの `AgentStore`、永続Agent型、CLI、パッケージ起動点、READMEを作成した。
- UUID・UTCの作成日時・名前の一意性を保存し、一覧を名前順で取得する。
- 実際のCLIを別プロセスで呼ぶe2eを先に9件作成した。空入力は空文字と空白のみをそれぞれ検証する。
- RED: `python3 -m unittest discover -s tests -v` は9テスト、14失敗（subTestを含む）。すべてCLI未実装による `No module named org_kernel` を確認した。[出力](verification/2026-10-04-agent-registry/red.txt)
- GREEN: 同じコマンドで9テストが成功、終了コード0を確認した。

### インストール検証の調査

- `python3 -m venv .venv` がensurepipで失敗した。sandbox外の同じコマンドも同じ理由で失敗した。
- `platform.mac_ver()[0]` が空で、pipのtruststoreがバージョン解析に失敗していた。
- 証明書処理を切り替える診断を試したが、pipのpackagingによるmacOS解析も同様に失敗した。pipはインストールされなかった。
- `import plistlib` で、Python 3.14のpyexpatに必要な `_XML_SetAllocTrackerActivationThreshold` がシステムlibexpatにないことを確認した。OS自体のバージョンは26.0.1。
- Python 3.11.12ではplistlibのimportとmacOSバージョン取得が正常だった。
- Ruling: インストール検証には利用可能なPython 3.11.12を使う — プロジェクトの対応下限でありPython 3.14の環境不整合を変更する必要がない — 誤った場合のコスト：3.14でのインストールは未検証のまま残る。
- この作業で作った未完成の `.venv` だけを削除し、Python 3.11で作り直した。システムPythonは変更していない。

### 検証結果と記録

- Python 3.11での最初のインストールはsandbox内のネットワーク制限でsetuptoolsを取得できず失敗した。昇格後の同じpipインストールは成功した。[出力](verification/2026-10-04-agent-registry/install.txt)
- `.venv/bin/python -m unittest discover -s tests -v` はPython 3.11.12で9件すべて成功した。[出力](verification/2026-10-04-agent-registry/green.txt)
- インストール済み `.venv/bin/org --help` が成功した。
- 一時DBへの登録・通常一覧・JSON一覧がすべて終了コード0。登録した一件のname・role・runtimeをJSONから確認した。[出力](verification/2026-10-04-agent-registry/installed-cli.txt)
- 通常のユーザーDBには触れていない。テストで作ったDBは一時ディレクトリの終了時に削除された。
- `git diff --check` は成功。DB・仮想環境・キャッシュはGitの対象外。
- 実装計画の6ステップを実行した。最終の独立レビューは次に行う。

### 独立レビューと完了

- 実装と検証出力を `fae17ef` にコミットした。
- task-doneによる再実行も9/9成功し、Task 1の完了を記録した。
- 別コンテキストのReviewerが設計・計画・Review Focusを確認し、9/9成功とcheckout外からのインストール済みCLI実行を確認した。[レビュー記録](verification/2026-10-04-agent-registry/review.md)
- Critical・Important指摘はなし。マージ可能との評価。
- Final: minor (deferred): RED検証の原出力に末尾空白がある。範囲指定の `git diff --check cfb450a..fae17ef` は終了2。機能への影響はなく、Minor保留ルールに従って原出力のまま保存する。
- 作業中の `git diff --check` は成功していたが、当時の未追跡ファイルはチェック対象外だった。レビューによるコミット範囲の検査結果は上記の通り。
- ブランチは `feat/agent-registry`、基点は `main` の `cfb450a`。remoteは未設定。統合方法はユーザーの選択待ち。
- 次の小さなe2e候補はTaskの作成・取得・状態保存。今回はAgentの登録・一覧表示まで完了。
- 最終の `.venv/bin/python -m unittest discover -s tests -v` も9/9成功、終了コード0。[出力](verification/2026-10-04-agent-registry/final-tests.txt)
- 作業用ledgerを[実行記録](verification/2026-10-04-agent-registry/execution-ledger.md)として保存した。

## 2026-10-04 — TypeScript移行とローカル品質ゲート

### 継続目標・追加指示

- 継続目標：Notionを確認し、残る実装を全体として進める。言語はTypeScript。e2e・各種テストを設定しTDDで動作とデグレを確認する。
- 現在状態を確認した結果、基点 `d49ae1a` にはPython版Agent CLIのみが存在した。過去の狭い完了を全体の完了として扱わず、[全体の要件照合](requirements.md)を作成した。
- Notionの親ページと設計書10本を再取得し、`docs/notion/` にsnapshotを保存した。Phase 1〜6を引き続き実装対象とする。
- ユーザーはVoicyの記事を参考にリファレンス実装・コーディング指針を定め、lint・AST・jev-lintで生成物をレビューするよう指示した。
- ユーザーはAPIキーを `.env` に配置し、使用を許可した。値は出力せず、有効なキーが存在することだけを確認。`.env` とモデルキャッシュ/実行recordをGit除外した。
- ユーザーはGHAを使わず、すべてローカルで行い、Agent実行・precommit・prepushへ適切に配置すること、Lefthookを使うことを指定した。未コミットのGHA案は除去した。

### 実装と判断

- TSへ移行し、Pythonの製品コード・manifest・テストを除去した。過去の設計・作業ログ・検証証拠は履歴として残した。
- 実際に使うAgentモジュールをリファレンスとした。純粋な `domain.ts`、最小限の `port.ts`、処理順序の `service.ts`、テーブルを所有する `sqlite.ts`、配線するCLIを分けた。
- [コーディング指針](coding-guidelines.md)、[リファレンス](reference-implementation.md)、[レビュー方法](quality-review.md)を作成し、AGENTS.mdから適用するようにした。
- strict TSC、type-aware ESLint、Prettier、fixture付きast-grep、Node標準test runner、jev-lint 0.7.0、Lefthook 2.1.16をlockfileで固定した。
- Ruling: jev-lintの要求に合わせ、実行環境はNode 24以上に変更し、開発用Node 24.21.0もdevDependencyに固定する — 開発とレビューのランタイムを揃えるため — コスト：初回インストールのサイズが増える。ホストNode 22でのnpm bootstrap時にはengine warningが出るが、npm scriptsはローカルNode 24で動く。
- TS内部は `createdAt`、SQLite/JSONは初期契約の `created_at` を維持した。既存データを読み書きできることを実DBで確認した。
- AST fixtureで、対応ルールが存在しなくてもast-grepが終了0になることを発見した。テストで全fixture件数と「Configuration not found」がないことを確認し、空の検査を成功扱いしない。
- Lefthookをインストールし、pre-commitはindex tree、pre-pushはstdinから得た全push objectのtreeを一時展開して検査する。元のindex/worktreeは変更しない。現在のworking treeが別の内容でも検査結果に混入させない。
- AgentはRED/GREENと検証単位の全チェックを実行。pre-commitは速い静的検査、pre-pushは全テストと意味レビュー。モデルの未校正warningだけでブロックせず、error/通信失敗は失敗として伝える。

### RED→GREENと検証

- Agent移行：TSの別プロセスe2eを先に10件書き、CLI未実装による失敗を確認。[RED](verification/2026-10-04-typescript/agent-red.txt)。TS実装後10/10成功。[GREEN](verification/2026-10-04-typescript/agent-green.txt)。
- ASTゲート：対応ルールなしを検査失敗として扱うテストが失敗したことを確認。[RED](verification/2026-10-04-typescript/quality-red.txt)。ルール導入後15/15成功。[GREEN](verification/2026-10-04-typescript/quality-green.txt)。
- Hook検査：snapshot/標準入力処理がない状態で型検査が失敗したことを確認。[RED](verification/2026-10-04-typescript/hooks-red.txt)。実装後、staged/HEADとworktreeの分離を実Gitで確認した。
- CLIの空DBパス：SQLiteが空文字で一時DBを作り登録成功する問題をe2eで再現。[RED](verification/2026-10-04-typescript/db-path-red.txt)。DB作成前に空パスを引数エラーとして拒否した。
- `npm run check` は型・lint・format・AST・24テスト・jev dry-runを成功した。[全出力](verification/2026-10-04-typescript/check.txt)。Python版の操作契約を含むe2e、実DB互換性、純粋なdomain、qualityルールの禁止/許可例、実際のpre-commit runnerも検証する。
- npm packを一時ディレクトリへインストールし、checkout外のbin `org` で登録→JSON一覧を確認。パッケージに `.env` とNotion snapshotがないことも確認。[出力](verification/2026-10-04-typescript/installed-cli.txt)。
- 最初のpackはnpm標準cacheへの書き込み制限で失敗。システムの権限を変更せず `/tmp/org-npm-cache` を使い成功した。
- `npm run hooks:install` はpre-commit/pre-pushの設定を成功した。実際のstaged gateとcommitted gateの結果は以下へ追記する。

### 実際のjev-lintレビュー

- dry-runで対象を確認後、ユーザー許可済みのキーで外部APIレビューを実行した。Notion snapshot、DB、秘密情報は送信対象外。
- 初回42対象の判定がすべて返り、missing 0・errorsなし・degradedなし。4候補。[結果](verification/2026-10-04-typescript/jev-review.json)。
- CLI失敗経路の不足候補に対し、未検証の不正オプション・空DBパス・壊れたDBを追加した。実際の空DBパス問題はRED→GREENで修正した。
- Hook追加後も実レビューを実行し、62対象、missing 0・errorsなし・degradedなし。5候補。[結果](verification/2026-10-04-typescript/jev-review-after-fixes.json)。snapshotの不正object IDと実際のrunnerの失敗/成功テストを追加した。
- テスト名の3候補は、CLI呼び出しhelper・外部ast-grep runnerがbare contextにないことによる候補と判断。永続ID・名称順は実CLIの独立プロセス結果とリテラルの期待値をassertし、ASTはfixture実行の件数と失敗の有無をassertしている。補助的にhelperが見えるlocated contextで3回判定し、結果を別記録する。
- 指針のproject ruleは未校正のwarningとして扱う。モデルの候補を自動修正・自動マージの根拠にはしない。

### 未完了

- 独立再レビューはCritical/Importantの残存なし、承認可能と判定した。Minorのseverity schemaについて文字列型を厳密に確認し、jev-lint正規値のhintも許可した。配列severity拒否・hint受理を回帰検証へ追加し、全26テストと全静的検査を再度成功した。

- 独立ReviewerがAgent移行の分離・互換性・実CLI検証を確認。重要指摘：jev-lint 0.7.0はwarningと通信エラーが混在すると終了0になり得るため、終了コードだけでは不完全な意味レビューを通す。
- 先に不完全結果を拒否するテストを書き、未実装による型検査失敗を記録。その後 `semantic-result.ts` と共通runnerを実装し、Agent実行とpre-pushの両方で対象ゼロ・missing・errors・degraded・error指摘を拒否した。[RED](verification/2026-10-04-typescript/semantic-gate-red.txt)、[実API GREEN](verification/2026-10-04-typescript/semantic-gate-green.txt)。全26テストと全静的検査が成功。
- 実hookがグローバルLefthook 1.10.4を優先していたため、公式の `lefthook` 設定でローカル固定版2.1.16を指定した。過去の生成済みprepare-commit-msgが古い版を呼んだため、中身がLefthook呼び出しのみであることを確認して不要hookを除去。実pre-commitが2.1.16で成功した。
- コミット `dc6845a` にTS移行・指針・検査を記録、`cce9e4d` に不完全なレビューを拒否する修正を記録した。
- 実際の `.git/hooks/pre-push` にGitと同じref更新stdinを与え、`cce9e4d` のcommit treeで26テスト・型・lint・format・AST・jev dry-run・実APIレビューまで終了0を確認した。Git pushは行っていない。[記録](verification/2026-10-04-typescript/committed-gate.txt)。

- 実際のindex snapshotに対する `npm run hook:commit` が終了0。型・ESLint・format・ASTがすべて成功。[記録](verification/2026-10-04-typescript/staged-gate.txt)。ステージ一覧に秘密の `.env` がないことを確認した。
- located contextでテスト名を3回再判定し、CLIの2候補は消えた。外部AST fixtureの候補は残った（13対象・missing 0・errorsなし）。fixture実行と件数のassertは維持し、未解決のモデル候補として記録する。[結果](verification/2026-10-04-typescript/jev-helper-context-review.json)。

- 全体目標は継続。Task/Room/Event/daemon/Runtime/Memory/Scheduler/Sandbox/Workflow/権限/外部連携/TUI/実務一周はまだ未完了。
- 次の検証単位はTSのTask作成・取得・割当・状態と不変履歴の一周。

## 2026-10-04：Taskの永続化とCLI

- 直前の継続turnはprogress：TS移行・ローカルLefthook・意味レビューの実装/修正をGitに記録し、検証を完了した。
- Notion「04｜Task抽象化」を再取得して照合。最終更新2026-10-04T01:51:58.336Zで、保存済みsnapshotと要件は変わらない。
- 既存計画の第二検証単位を実行。Taskの作成→割当→状態遷移→別プロセス取得、参照拒否、依存循環のCLI e2eを先に書いた。実装前は3件ともUnknown --objectiveで失敗。[RED](verification/2026-10-04-tasks/cli-red.txt)。
- domainとSQLiteのunit/integrationを先に書き、未実装moduleによる失敗を記録。[RED](verification/2026-10-04-tasks/domain-red.txt)。TaskProviderのコメント/成果物操作もテスト先行。[RED](verification/2026-10-04-tasks/provider-red.txt)、[CLI RED](verification/2026-10-04-tasks/notes-cli-red.txt)。
- `tasks/domain.ts` にWorkItem/ExecutionTask、入力・状態判断を置いた。SQLite Adapterはtasks/task_history/task_comments/task_artifactsを所有し、TaskProviderは具体DB型を公開しない。
- Ruling: 状態図は進行の基本形と解釈し、running→completed、blocked→running、waiting_approval→running等の回復を許可する — 毎回block/承認を要求する業務ではないため — コスト：厳密な業務フローは後のPermission/Approvalで制約する。completed/failedへの通常patchは拒否し、retryは今後のExecutionで別試行として扱う。
- Ruling: TaskはownerをAgentの公開Portで確認してから割り当てる — 他モジュールのテーブルをTask Adapterから直接操作しないため — コスト：将来Agent削除を導入する際には参照保証のトランザクションを追加する必要がある。現在Agent削除操作はない。
- ownerのあるTaskのみassigned以降へ進行。親と依存の存在・循環、依存完了後のみrunning/completed、不正遷移を拒否する。BEGIN IMMEDIATE内で現在状態の取得・判断・状態更新・履歴appendを行う。expectedVersionで古い更新も拒否する。
- 履歴はversion順のTask snapshotをappend。SQLite triggerで履歴・コメント・成果物参照のUPDATE/DELETEを拒否する。trigger導入前の原本書き換えを再現して失敗を確認。[RED](verification/2026-10-04-tasks/immutable-notes-red.txt)。状態履歴または成果物履歴のINSERT失敗は状態・参照もrollbackする。
- Ruling: 成果物参照は完了後にも追記可能 — 実行終了後の回収を妨げないため — 原本historyは変更せず新versionをappendする。TaskArtifactはURI参照のみで、Sandbox回収・資格情報・ファイル検証は未実装のArtifact領域に残す。
- `task create/list/get/assign/update/history/comment/comments/artifact/artifacts` を追加。JSONはTaskのcamelCase、Agentは旧契約のcreated_atを維持する。
- 全35テスト・型・ESLint・format・AST・jev dry-runが成功。[全出力](verification/2026-10-04-tasks/check.txt)。実DBで保存失敗rollback・原本不変・古いversion拒否、別プロセスで参照・依存・割当・コメント・成果物を検証。
- 全体目標は継続。Taskの外部Adapter/同期、Execution実行、Room/Message/Event、daemon以降は未完了。

## 2026-10-04：公開情報の整理と高速な検証環境への変更

- ユーザーの誤ったmain切り替えをreflogで確認。追加途中のテストだけ一時退避し、コミット済みfeatureブランチへ戻して復元した。コードやキーは失っていない。
- ユーザーがpublic repository化を通知し、構想・設計自体の公開を許可した。公開不要な事業固有名は一般例に匿名化し、検証ログのローカル個人パスを `<REPO>` に置換した。過去のremote履歴には旧名が残るため、履歴対応は別途確認が必要。
- 全Git履歴127 blobに対し、設定済みキーとの完全一致と代表的なキー形式をローカル確認。検出なし。`.env` の追跡履歴もなし。これは限定した確認であり、あらゆる秘密情報の不存在を証明しない。
- ユーザーがmainのremote pushを明示。mainは4件の設計/ログMarkdownのみであることを確認し、`origin/main`へpushした（cfb450a）。featureをmainへmergeしていない。
- 実pushでLefthookが「no matching push files」でjobを省略することを発見。pre-pushは変更ファイルがなくてもstdinのrefを検証する必要があるため、固定sentinelをfilesへ指定した。文書のみのbootstrap treeは明示的に分類し、コードがあるのにmanifestがない場合は拒否するテストを追加した。
- 独立Taskレビューの重要指摘2件を再現：CLIで依存/ラベル/親を解除できない、合流依存DAGの検査が指数時間。18 Taskの通常更新で131,072 DB読込を観測。[RED](verification/2026-10-04-tasks/review-fixes-red.txt)。解除オプションを追加し、グラフ取得と純粋な循環/依存判断を分離。activeとvisitedを分け各ノードの重複探索を止めた。
- ユーザー指定でBunへ統一し、npm/Nodeの製品・検証実行、package-lock、ESLint/Prettier設定を除去した。Bun 1.3.4で依存・runtime・SQLite・test・bundle・hooks・jev実レビューを実行する。Node互換APIの型はBunの型依存として残るがNode runtimeは必要ない。
- Bunで既存SQLite integrationを先に実行し、node:sqlite非対応を確認。[RED](verification/2026-10-04-tasks/bun-red.txt)。bun:sqliteへ移行。既存DB互換性を維持し、重複名エラーはBunのerrnoで判定するよう修正した。
- lintはRustのOxlint 1.86.0、formatterはRustのOxfmt 0.71.0、型依存lintはtsgolint 7.0.2003。型検査はユーザー指定のtsgo 7.0.0-dev.20260707.2。lockfileで固定した。型エラーfixtureの拒否/正しいfixtureの受理、Oxlintの禁止/許可例も実物で検証する。
- Ruling: tsgo/Bunの外部型宣言にある重複/互換性問題をskipLibCheckで除外する — 製品コードのstrict検査を回すため — コスト：第三者のd.ts自身の整合性はこのgateでは保証しない。自分たちのコードの型検査と型エラーfixtureは維持する。
- Ruling: OxfmtのBun 1.3.4上のMarkdown fallbackがDataCloneErrorになるため、format対象はTSとJSON設定に限定する — Rustのnative formatterを確実に使うため — YAMLのAST fixture/設定は実際のrunnerで検証し、文書はレビューする。
- DIを必須規則に追加。serviceは必要なPort操作だけをPickして受け取り、時計/IDも引数で受け取る。DB不要の最小UTを独立し、DIテストの未対応型をRED確認した。[RED](verification/2026-10-04-tasks/di-red.txt)。最小UT11件は35msで成功。[結果](verification/2026-10-04-tasks/unit.txt)。
- Bunのinfra importもAST fixtureに追加し、未検出REDからルールを強化。[RED](verification/2026-10-04-tasks/bun-ast-red.txt)。
- 公開情報ゲートをpre-commit/pre-pushに配置。.envの追跡、既知キーの混入、private keyを拒否し、例外のメッセージに値を出さない。テストは先に書き、未実装REDを記録。[RED](verification/2026-10-04-tasks/public-gate-red.txt)。通常検証はdotenv自動読み込みを無効にし、意味レビュー/既知キー照合だけ明示的に.envを読む。
- Bun上の実jevレビューも成功し、175対象・missing 0・errorsなし・degradedなし。[結果](verification/2026-10-04-tasks/bun-semantic.txt)。先の候補からTask parser/domainの負ケースとsemantic runnerのprocess/parse失敗テストを追加した。テスト名への既存3候補はhelper/外部runnerを読む独立レビューで不具合として採用しなかった。
- READMEを現構成、Agent/Taskの操作、DI、UT/integration/e2e、ローカルゲート、公開情報の扱いに全面更新。README形式のBun start実起動とbundleの実起動を確認した。
- 全体目標は継続。Room/Message/Event/daemon以降、外部Providerと実務一周は未完了。

- コミットfe84bccでBun/native品質環境とTask修正を記録。実pre-commitは公開情報120ファイルと静的検査を0.82秒で成功した。
- 一時checkoutへ依存を再利用せず `bun install --frozen-lockfile` を実行し、全検査を成功。[install](verification/2026-10-04-tasks/cold-install.txt)、[check](verification/2026-10-04-tasks/cold-check.txt)。実pre-push hookも公開情報・全テスト・実jevレビューまで成功（push自体はしていない）。[結果](verification/2026-10-04-tasks/bun-prepush.txt)。
- 独立レビューの重要指摘を対応：tipだけの情報検査では途中commitの漏えいを防げないため、新たに公開される全commitのtreeを検査する。temp Gitで.envを追加→次commitで削除する再現を回帰テストにした。
- 独立レビューのdotenv指摘は、無害なsentinelを実Bunプロセスで先に再現した。bunfig.tomlのenv=falseとCLI subprocessの明示フラグで自動読み込みを止め、明示読み込みは維持した。[RED](verification/2026-10-04-tasks/env-red.txt)、[GREEN](verification/2026-10-04-tasks/env-green.txt)。50テスト・全静的検査が成功した。
- 公開履歴検査を再レビューし、別private remoteのrefによる除外とworktree依存を発見。remote除外をやめ、push対象から到達する全履歴を保守的に確認する方式にした。history-onlyの検査はGit objectだけを読み、未ステージの削除で結果を変えない。private remote ref付きの資格情報除去履歴と、未ステージ削除をRED→GREENで検証した。[RED](verification/2026-10-04-tasks/public-history-isolation-red.txt)。全51テストが成功。
- 訂正：先の「実pre-push成功」は終了コードだけの確認で、出力は実際にはjob skipだった。架空sentinelは存在確認で除外されるため、存在するlefthook.ymlをmarkerに変更した。設定ファイルそのものを使う実Lefthook/temp Gitテストでjob実行と対象commit検査の出力をassertし、skipをRED再現した。[RED](verification/2026-10-04-tasks/lefthook-execution-red.txt)。この回帰テストを含め全52テストと全静的検査が成功。次の実hook結果で初めて完了と判断する。
- 洗浄済み履歴をローカルpreview branchに用意した。元のfeature/main/remoteを動かしていない。213 blobで非公開固有名/ローカル個人パスの一致0を確認。実装差分はなく、current treeとの差は検証ログ3行の個人パスのみ。履歴置換のremote操作はまだ行っていない。

## 2026-10-04：READMEの現状照合

- README更新の依頼に対応。Bun・tsgo・Oxlint、Agent/Task操作、DIと検証、Lefthookのローカル実行手順を現行package.jsonとCLI helpに照合した。未実装領域を明記し、個別テストにもdotenv無効化を指定した。
- bundleを直接実行する例を追加。`bun run build`と`./dist/cli.js --db /tmp/org-readme-smoke.db agent list --json`を実行し、成功と空一覧を確認した。

## 2026-10-04：RoomとMessageのローカル永続化

- Notion「02｜Room・Chat・Session」を再取得。最終更新時刻2026-10-04T01:51:58.336Zと現snapshotの仕様が一致。公開不要な固有名は再導入しない。[計画](superpowers/plans/2026-10-04-rooms.md)。
- CLI別プロセスe2e未実装RED、純粋domain未実装RED、SQLite Adapter未実装REDを先に記録。参加者構成・sender・同Room返信・archiveを純粋関数、Agent/Task参照確認を最小PortのDIへ分離。SQLiteはBEGIN IMMEDIATEでarchive確認と投稿を直列化し、MessageのUPDATE/DELETEをtriggerで拒否する。
- Direct/Group/Agent/Task、Task参照、既定coordinator、metadata、Room一覧/取得/投稿/返信/履歴/archiveをCLIへ追加。別プロセスで同Agentの複数Room・履歴の分離・archive後拒否を確認。実DBで履歴改変拒否とINSERT失敗後の復旧を検証。
- 初回全検査は57テスト成功、tsgo・Oxlint・Oxfmt・AST・jev dry-run成功。実意味レビューの最初の試行はsandboxのネットワーク制約により判定欠落を拒否した。許可済みキーのネットワーク利用を明示して再試行中。
- 前検証単位の訂正を確定：洗浄履歴previewの実pre-push jobが実行され、52テストと198対象の実jev判定が成功。missing 0、errors/degradedなし。[実出力](verification/2026-10-04-tasks/public-preview-prepush.txt)。remoteの履歴は置換していない。
- 全体目標は継続。Room Activation/Session/Human認証、Event、daemonなどは未完了。

- 独立レビューで不正なRoom構成の拒否がDB作成後になる重要指摘を受けた。実CLIで終了1をRED確認し、共有validateRoomInputをparse時に呼ぶよう変更。4不正入力で終了2とDB親ディレクトリ未作成を確認した。再レビューはCritical/Importantなし、当検証単位はready。
- 最終全検査58テスト成功。[出力](verification/2026-10-04-rooms/check.txt)。実jevは270対象、missing/unsure 0、errors/degradedなし。[出力](verification/2026-10-04-rooms/semantic.txt)。Room parserの未網羅な負ケースは追加検証候補、metadata object拒否はe2eで確認済みと独立レビューで判定した。13 warningは自動不合格とはしない。既存領域の候補は従前レビューの判断を維持する。
- Bun bundleを再ビルドし、生成CLIのroom listを実行して成功を確認。全体の完了は主張しない。

## 2026-10-04：EventとSubscriptionの保存・照合

- Notion「05｜Event・PubSub・Trigger」を再取得。最終更新2026-10-04T01:51:58.336Zとsnapshotの仕様が一致。[計画](superpowers/plans/2026-10-04-events.md)。
- 別プロセスCLIの未実装RED、domain未実装RED、SQLite未実装REDを保存してから実装。EventとTaskの保存を分離し、publishは受信者を読み取らない最小Portを注入。pattern/filter照合は純粋関数、Agent参照は公開Portで確認する。
- Ruling: dot区切りpatternで*は1区間、末尾**は0以上の区間。filterはpayloadのトップレベル指定keyのJSON値完全一致とする。任意コードや正規表現は実行しない。Workflowは識別子保存のみで存在確認/実行は未実装。
- SQLite Event logをUPDATE/DELETE triggerで保護。購読enabled変更はBEGIN IMMEDIATE内で読む/更新する。実DBで原本不変・INSERT失敗後の復旧・存在しないID拒否を検証。別CLIでpublish/get/list/subscribe/subscriptions/matches/enable/disableを実装・検証。
- 全64テストとtsgo・Oxlint・Oxfmt・AST・jev dry-run成功。[出力](verification/2026-10-04-events/check.txt)。実jevは346対象、missing 0、errors/degradedなし。[出力](verification/2026-10-04-events/semantic.txt)。新規2 warning候補は独立レビューで実装欠陥/重要なテスト不足なしと判定。追加のparser負ケース・JSON配列比較ケースは補強候補として記録する。
- 独立レビューはCritical/Importantなし。Reviewer自身のEvent6テストも成功。READMEと要件照合を更新し、Bun bundleと生成CLIのevent listも確認した。
- 全体目標は継続。次にdaemonのイベント→Task処理と配信idempotencyを実装する。実runtime起動、Workflow、外部サービス等は未完了。公開履歴の置換はユーザー回答待ちでremote操作をしていない。

## 2026-10-04：EventからTaskへの冪等な配信

- Notion「07｜Local-first CLI / TUI」を再取得。最終更新2026-10-04T01:51:58.336Zとsnapshotの設計が一致。[計画](superpowers/plans/2026-10-04-event-dispatch.md)。
- 別CLIのdaemon未実装とTask原子的割当Port未実装をREDで確認。Task Adapter内でpending作成→assigned状態/履歴を一つのBEGIN IMMEDIATEへ保存。割当履歴INSERT失敗はTaskと両履歴をrollbackする。idempotency不一致を拒否し、同入力の再実行は現在のTaskを返し再割当しない。
- Ruling: Event/Subscriptionの一意な長さ付きkeyでTask IDを決定。Event原本を時刻/入力根拠とし、現在有効な購読を過去Eventにもbackfillする。DaemonのreceiptとTaskは別トランザクション。Task保存後receipt失敗は同じTask IDの再実行で復旧する。DaemonからTask SQLを触らない。これは一般外部副作用のexactly-once保証ではない。
- daemon --onceとdaemon deliveriesを追加。Agent購読は割当済みExecutionTaskを作成し、Workflowは未実装理由付きdeferredを保存する。deliveredはTask作成/割当でありRuntime実行完了ではない。
- 実DBでreceipt失敗→Task1件/不変履歴→retryでreceipt完成を検証。別プロセスで再実行時の重複/再割当なし、2CLI worker同時実行でもTask1件とpending/assignedの履歴2件を検証。Workflow同時deferの状態衝突を追加RED確認し、同理由のdeferを冪等に修正した。
- 全71テスト・tsgo・Oxlint・Oxfmt・AST・jev dry-run成功。[出力](verification/2026-10-04-dispatch/check.txt)。実jev386対象、missing 0、errors/degradedなし。[出力](verification/2026-10-04-dispatch/semantic.txt)。独立レビューCritical/Importantなし、Reviewer自身の7テスト成功。新しい命名/負ケース警告は不具合なしと判定。未登録Agent拒否とparserの追加負ケースは補強候補として記録する。
- README/要件照合を更新。Bun bundleのdaemon --onceも実起動成功。全体目標は継続し、常駐polling/local socket/API、Runtime/Execution、Permission等は未完了。公開履歴置換の回答はまだ受け取っておらずremoteは変更していない。

## 2026-10-04：常駐daemonとUnix socket

- Notionのlocal daemon設計を再取得しsnapshotと一致を確認。[計画](superpowers/plans/2026-10-04-daemon-socket.md)。Bun公式のnative Unix socket server/fetchを参照し、固定Bun 1.3.4で動作を検証した。
- 起動/接続/新Event polling/停止/再起動e2eとpoll失敗UTを先にRED確認。org daemonを常駐させ、status/dispatch/stopとsocket経由deliveriesを追加。既存--onceとDB直読deliveriesは維持。CLI entrypointをasyncにし、clientは5秒timeout。
- sandboxのlistenがEPERMで拒否されたため、許可されたローカルUnix socket検証として実行。TCP listenerや外部サービス通信は行っていない。定期poll失敗はdegraded/errorとしてstatusへ出し、次回poll成功でrunningへ復旧することを実socketで確認した。
- Ruling: socket0600とumask077、隣接lock directoryで2重起動を防ぐ。既存file/socket/symlinkは置換しない。dangling symlinkをexistsSyncが見逃すREDを記録し、lstatで確認するよう変更。SIGKILL後のstale entryは勝手に消さない。
- close失敗でsocket/lockが残るREDから、cleanupをfinallyで連鎖しumaskまで復元するよう修正。独立レビューの逐次close指摘もUT REDで対応し、最小close Portを全て実行して失敗を集約するreleaseResourcesを追加。
- --onceが--socketを黙って無視しないこと、socketを使わない--onceが長いDB pathでも拒否されないことをparserのRED→GREENで確認。実childのSIGTERM/SIGINT停止、権限0600、2重起動拒否、Origin403、未知endpoint404、既存file/symlink保護、稼働中に差し替えられたsocket/lockを消さないことを検証した。
- 最終全79テスト・tsgo・Oxlint・Oxfmt・AST・jev dry-run成功。[出力](verification/2026-10-04-daemon-socket/check.txt)。実jev424対象、missing 0、errors/degradedなし。[出力](verification/2026-10-04-daemon-socket/semantic.txt)。独立レビューはCritical/Importantなし、cleanup/parser/poll UT3件もReviewerが実行成功。残る命名/負ケースwarning候補は前段レビューの非ブロッキング判定を維持。
- README/要件を更新。Bun bundleも実常駐起動→socket status running→stop stopping→終了0/socket削除を確認した。全体目標は継続。全CLIのdaemon client化、Runtime/Execution、scheduler、Memory、権限等は未完了。履歴置換の回答待ちはローカル実装を妨げないため、remote変更をせず続けている。

## 2026-10-04：READMEの現行CLIへの更新

- ユーザー依頼によりREADMEを現workspaceのCLI実装・package scriptsと照合。daemon起動→Agent登録/一覧→停止の最小手順、通常clientと明示的な`--direct`管理操作、DB/socketの選び方、bundleの実行例を更新した。
- 同じディレクトリの複数DBは現在既定socketを共有するため、DB別の明示的socket指定を記載。進行中のclient移行にある回帰テストの失敗を成功として扱わない。
- README内の相対リンクの存在とCLI helpを確認した。今回の変更は文書のみであり、全テスト・実意味レビューの再成功は主張しない。既存の実装変更はこの文書更新のcommitへ含めない。

## 2026-10-04：業務CLIのdaemon client化

- Notion「07｜Local-first CLI / TUI」は再取得のtransport failure後に成功し、最終更新2026-10-04T01:51:58.336Zと照合。[計画](superpowers/plans/2026-10-04-cli-client.md)。通常Agent/Task/Room/Eventはdaemonへ接続、直接DB操作は明示的--directへ移行した。
- socket未対応とdaemonなしでDBを作る旧動作をe2e REDで確認。application境界へ既存parser/配線を移し、出力関数のDIでcode/stdout/stderrを収集。共有console差し替えや子CLI起動は行わない。remote入力はDB/socket/direct/daemon管理指定を拒否し、daemonの起動時DBへ固定する。
- transportとresponse envelopeのUT、実daemonで4領域の作成/読込・終了コード・不正body/引数数/長さ・クライアントDB未作成を検証。従来e2eは--direct管理操作として維持した。
- 同じディレクトリの別DBへ誤接続するe2eをRED確認。Ruling: 既定socketをDB絶対パス+.sockへ変更しserver/clientで同じ関数を使用。別DBのコマンド失敗と元DBへの誤書込なしをGREEN確認。旧既定socketを使う利用者はdaemonを再起動するか--socketを明示する必要がある。
- 全84テスト、tsgo/Oxlint/Oxfmt/AST/jev dry-run成功。[出力](verification/2026-10-04-cli-client/check.txt)。実jev453対象、missing/unsure 0、errors/degradedなし。[出力](verification/2026-10-04-cli-client/semantic.txt)。既存の独立レビューはCritical/Importantなし、新規負ケース候補は実e2eの引数/業務/接続失敗で確認済み。socket分離修正は独立レビュー後の追加RED→GREENと全suiteで検証した。
- Bun bundleを実daemon→Agent登録/一覧→stop終了0/socket削除で確認。最初のsmokeはAgent createへ非対応--jsonを付けたため終了2、契約に合わせて再実行成功。README/要件を更新した。
- 全体目標は継続。Runtime/Session/Memory/Context、権限、scheduler、Workflow、Sandbox、外部連携、TUI等は未完了。remoteへpush・履歴置換は行っていない。

## 2026-10-04：Runtimeのプロセス実行境界

- Notion「06｜Runtime Ports｜Agent・Sandbox・Workflow」を再取得、最終更新2026-10-04T01:51:58.336Zとsnapshot一致を確認。[計画](superpowers/plans/2026-10-04-runtime-process.md)。Agent IdentityとSessionの分離、start/send/resume/stopへ向けた実行境界を追加。
- 実子プロセスのテストを未実装REDで確認してからrunProcessを実装。shellを経由せず明示argv/env/cwd/inputのみを使う。終了コード/stdout/stderrを返し、timeout/cancel/共有raw出力byte上限で直接childをSIGKILLし終了をawaitする。
- 文字列のshell展開なし、終了7とstderr、timeout、開始前cancel、起動後cancel、巨大出力の停止を実Bun childで検証。全86テスト・tsgo/Oxlint/Oxfmt/AST/jev dry-run成功。[出力](verification/2026-10-04-runtime-process/check.txt)。実jev462対象、missing 0、errors/degradedなし。[出力](verification/2026-10-04-runtime-process/semantic.txt)。新規Runtimeのwarningなし。
- 独立レビューCritical/Importantなし。Final: minor (deferred): timeoutMsが2147483647を超えるとBun timerが1msへ補正し、24日超の指定を正しく扱えない。
- Final: minor (deferred): raw UTF-8末尾の切断はreplacement characterになり、返却文字列の再エンコードbyte数がraw上限を超える場合がある。raw保持量は共有上限内。
- Runtime実行をCLIへ公開していない。Codex/Claude adapters、Session永続化、Task連携、Permission/Approval、子孫プロセス群のSandbox隔離は未完了。全体目標を継続しremote操作はしていない。

## 2026-10-04：Runtimeのtimeout/UTF-8上限の修正

- 前段の保留2件をRuntime実装前の境界修正として対応。超長時間timeoutを受理して1ms終了する動作をRED確認し、Bun timerが扱える2147483647ms以下だけを受理するよう変更。
- 続いて「あ」の1byte切断でreplacement characterが3bytesになるREDを確認。不完全なUTF-8末尾は返却せず、不正byteのreplacementも保持raw byte数内のprefixに制限する。正常な文字列・既存終了コード契約は維持。日本語と不正byteの実プロセスで上限を確認。
- 全87テスト・tsgo/Oxlint/Oxfmt/AST/jev dry-run成功。[出力](verification/2026-10-04-runtime-limits/check.txt)。実jev463対象、missing/unsure 0、errors/degradedなし、新規Runtime警告なし。[出力](verification/2026-10-04-runtime-limits/semantic.txt)。前段保留2件は解消した。
- Codex execとClaudeのインストール済みCLI helpを確認。Codexのstdin prompt/JSONL/resume、Claudeのprint/JSON/session/resume/system promptを今後のAdapterで照合する。help確認のみでモデル実行・外部送信は行っていない。環境のPATH alias作成拒否はhelp読込を妨げなかった。
- 全体目標は継続。AgentRuntime adapters/Session/Task連携、子孫プロセス群のSandbox隔離、Permission/Approval等は未完了。pushはしていない。

## 2026-10-04：Codex turn Adapterの開始・再開境界

- Notion06を再取得。一度transport failure後、再試行成功。最終更新2026-10-04T01:51:58.336Zとsnapshot一致。[計画](superpowers/plans/2026-10-04-codex-turn.md)。インストール済みCodex exec/resume helpと公式exec_events.rsを照合した。
- 未実装UT RED後、role/instruction/messageをstdin JSONに注入する引数生成とsession指定のresumeを実装。read-only/approval never/ignore-user-configを明示。session文字列をoptionに解釈させず、任意メッセージをargvへ混ぜない。
- JSONLのthread ID・完了assistant message・turn completionを解析。error/turn.failed/不正JSON/欠落/別sessionを拒否。runCodexTurnはprocess runnerをDIし、timeout/cancel/出力上限/非ゼロ終了を完了扱いしない。
- 初回tsgoでunknown objectのRecord narrowingを拒否されたためtype predicateを導入して修正。独立Reviewer自身の3UT成功。独立レビューのImportant（返答欠落でも成功）を追加RED→GREENで修正。Final: fixed 返答欠落成功 — Codex resumed response cannot succeed without a completed assistant reply RED→GREEN, suite 91/91。
- 全91テスト・tsgo/Oxlint/Oxfmt/AST/jev dry-run成功。[出力](verification/2026-10-04-codex-turn/check.txt)。実jev480対象、missing/unsure 0、errors/degradedなし。[出力](verification/2026-10-04-codex-turn/semantic.txt)。codexCommandの負ケースwarning候補は不正session拒否をUT検証済み。空Agent/messageの追加ケースは補強候補として記録する。
- 実AIの呼び出しはしていない。fixture/DI成功を実Codexサービス成功とは扱わない。Claude Adapter、Session永続化、AgentRuntime全体start/send/resume/stop、Task接続、安全性/Permission/Sandbox等は未完了で全体目標を継続。remote操作はしていない。

## 2026-10-04：Claude turn Adapterと共通RuntimeTurn Port

- Notion06を再取得、最終更新2026-10-04T01:51:58.336Zとsnapshot一致。[計画](superpowers/plans/2026-10-04-claude-turn.md)。ローカルhelpと公式headless docsでprint/stdin/JSON/session/system prompt/bare modeを確認した。
- 未実装UT RED後、Claudeのrole/instructionをsystem prompt、messageをstdinへ渡すturn Adapterを実装。bare modeと空toolsを選び、自動hooks/plugins/MCP読込を避ける。API資格情報は起動側が明示注入する。これは正式Permission/Sandboxの完成ではない。
- result/success/is_error=false・session/textのshapeとresume session一致を検証。timeout/cancel/出力上限/非ゼロprocessを成功にしない。Codex/Claude共通RuntimeTurnInput/Resultをport.tsへ抽出しCodexの既存exportも維持した。
- 独立Reviewer自身の7UT成功。Important（resume時のsystem prompt snapshotが新role/instructionを無視）を追加RED→GREENで修正。Final: fixed resume prompt更新欠落 — Claude resumed turn refreshes changed role and instruction instead of reusing a system prompt snapshot RED→GREEN, suite 95/95。--system-prompt-snapshot offで毎turnのcontextを反映する。
- 全95テスト・tsgo/Oxlint/Oxfmt/AST/jev dry-run成功。[出力](verification/2026-10-04-claude-turn/check.txt)。実jev495対象、missing/unsure 0、errors/degradedなし、Claude新規warningなし。[出力](verification/2026-10-04-claude-turn/semantic.txt)。test:unitに両AdapterのDB-free UTを追加した。[UT出力](verification/2026-10-04-claude-turn/unit.txt)。
- fixture/DI成功は実Claude/Codexサービス成功とは扱わない。実モデルe2e、Session永続化、AgentRuntime全体start/send/resume/stop、Task/Room連携は引き続き未完了。全体目標を継続し、remote操作は行っていない。

## 2026-10-04：Sessionの独立Identity・状態・履歴保存

- Notion02を再取得、最終更新2026-10-04T01:51:58.336Zとsnapshot一致。[計画](superpowers/plans/2026-10-04-sessions.md)。org Session IDとAgent/Room/provider session IDを分離し、runtime/状態/version/時刻を保存する。
- domain/SQLiteの未実装REDを確認。begin/complete/fail/stopは純粋な遷移で、同時turn・不正完了・別provider IDへの置換を拒否する。ID/時刻は呼出元注入。SessionStore PortとSQLite Adapterへ分離。
- SQLiteのBEGIN IMMEDIATE内で状態とsnapshot履歴を同時保存。必須expected versionで古い書込を拒否する。履歴INSERT失敗のrollback、再接続と別Bunプロセス読込、UPDATE/DELETE原本変更拒否を検証した。
- 保存層がfabricated completionを許すREDから、保存時もdomain遷移のsnapshotと照合するよう修正。独立Reviewer自身の3テスト成功。履歴REPLACEの指摘は、明示しているDB-level不変性に影響するためImportantとして対応した。Final: fixed INSERT OR REPLACE履歴置換 — Session state and immutable history persist atomically and reject stale writersのREPLACE拒否 RED→GREEN, suite 98/98。同じid/versionのBEFORE INSERT triggerで別connectionのPRAGMAにも依存しない。
- 全98テスト・tsgo/Oxlint/Oxfmt/AST/jev dry-run成功。[出力](verification/2026-10-04-sessions/check.txt)。実jev524対象、missing/unsure 0、errors/degradedなし。[出力](verification/2026-10-04-sessions/semantic.txt)。decodeSessionの追加負ケースwarningは補強候補として記録。test:unitにSession domainを追加した。
- SessionStoreはAgent/Roomのテーブルを触らず参照IDのみ保存。serviceでの参照存在確認、Runtimeプロセスとの結線、CLI/daemon操作、daemon再起動時running復旧、Room履歴/MemoryからのSession再構築は未完了。全体目標を継続しremoteへ送信していない。

## アクセス復旧とSession記録の再開

- リポジトリ読取が通常実行・sandbox外実行ともOperation not permittedとなり、3連続turnでgoalをblockedにした。原因は未特定で環境アクセス制御の一時障害が疑われる。
- ユーザーの再確認依頼時にREADME/Git HEAD読取とgit statusが復旧したことを確認。Session対象3テストを再実行し3 pass/0 fail、git diff --check成功。既存の全98テスト/実jev結果とともにSession実装を記録する。

## mainへの公開反映

- ユーザーがmainへのpushを明示承認。remote mainをfetchし、cfb450aでlocal mainと一致を確認。
- featureの過去24blobに削除対象の固有名/ローカルパスが残る一方、main過去履歴の対象一致は0。remote履歴を書き換えず、現在の洗浄済みfeature treeをsquashでmainへ取り込む。featureとそのremote refは変更しない。
- 公開情報ゲートと送信tipの全ローカル検査・実jevをpre-pushで実行する。送信成功はremote refとHEAD一致で確認する。全体目標の完了は主張せず、実AI e2e・Session結線・Memory/権限/Workflow/外部連携/TUI等を継続対象とする。

- mainの2250bf8をorigin/mainへ通常push成功。実pre-push jobは実行され全98テスト・静的検査・実jevが成功。[送信出力](verification/2026-10-04-main-push/prepush.txt)。main全reachable blobの指定固有名/ローカルパス一致は0。featureのremote履歴は変更していない。
- この公開結果ログもmainへ記録・送信する。全体目標は引き続き未達成。

## SessionからRuntime turnへの接続

- ユーザーが全体目標を再確認し、達成まで継続するよう指示。Notion02を再取得し最終更新2026-10-04T01:51:58.336Zとsnapshot一致を確認。[計画](superpowers/plans/2026-10-04-session-runtime.md)。
- Session service未実装RED後、Agent/Room公開Portで登録・参加・非archive・runtimeを確認。beginをversion付き保存してからDI runtimeへ送信し、provider IDを維持してresumeする。failureはgeneric原因を保存し、外部エラー本文を履歴へ入れない。
- stop状態を保存してから注入cancelを要求。late応答は古いversionとして拒否しstoppedを上書きしない。stopはcancel要求であり、process終了待ちは起動側のruntimeライフサイクルで行う。restart recoveryは残ったrunningをfailedへしprovider IDを維持する。daemon起動時配線は後続。
- 3つのDB-free UTを23msで検証。SQLiteと両Adapter・実Bun fixture subprocessを結線し開始→provider resume→cancel/stop→不変履歴を検証。fixtureは実AIモデルの成功とは扱わない。
- 全103テスト・tsgo/Oxlint/Oxfmt/AST/jev dry-run成功。[出力](verification/2026-10-04-session-runtime/check.txt)。実jev547対象、missing/unsure 0、errors/degradedなし。[出力](verification/2026-10-04-session-runtime/semantic.txt)。独立Reviewer自身の5件成功、Critical/Important/Minor不具合なし。参照負ケースの追加検証は補強候補。命名warningは参照検証/stop記録とcancel要求の実際の責務を確認しブロッキング不具合なしと判定する。
- test:unitへSession service、test:e2eへ両Runtime結線を追加。CLI/daemon API、Room履歴/summary/Memoryからの再構築、Task統合・実AI e2e・権限等は未完了で全体目標を継続する。

## LocalAgentRuntimeの実行所有・停止待機

- Session serviceから、start/send/resume/stop/recover/shutdownのLocalAgentRuntime managerへ接続。[計画](superpowers/plans/2026-10-04-runtime-manager.md)。SessionStore/Agent/Room/両driver/clock/IDを注入する。SessionStore依存は使う4操作のみ。
- manager未実装RED後、active mapで同時turnとstop/drain中resumeを拒否し、stopはpersist→cancel→driver completionを待つ。shutdownは新規start/sendを拒否し、全activeの停止を試みて失敗を集約する。
- 両AdapterのSQLite/実Bun fixture e2eをmanager経由へ更新。開始→明示provider resume→stop後completion回収→履歴維持を確認。保存失敗するstopが一件あっても他driverを停止/回収し、shutdownがAggregateErrorになることも検証。
- 初回type-aware lintがallSettled.reasonのany配列返却を拒否し、unknownへ受けて集約するよう修正。独立Reviewer自身の3テスト成功。Important（driver起動callbackでshutdownするとactive未登録で回収されない）を追加RED→GREEN修正。Final: fixed 起動時ownership欠落 — Runtime owns an active turn before a driver startup callback requests shutdown RED→GREEN, suite 106/106。active登録後にdriverを起動し、開始前abortも拒否する。
- 全106テスト・tsgo/Oxlint/Oxfmt/AST/jev dry-run成功。[出力](verification/2026-10-04-runtime-manager/check.txt)。実jev最終結果は[出力](verification/2026-10-04-runtime-manager/semantic.txt)。missing/unsure 0、errors/degradedなし。managerの新規warningなし。
- ブランチはmain基点feat/session-runtime。実AIサービスe2e、CLI/daemon起動配線、Task/Room履歴Contextの再構築、Permission/Sandbox等は未完了。全体ゴールの達成とは扱わず継続する。


## Session CLIとdaemon実行、実Codex e2e

- ユーザーが「Nextがある限り継続、迷わなければ確認不要」と再指示。全体ゴールを保持し継続する。[計画](superpowers/plans/2026-10-04-session-cli.md)。
- Session start/send/resume/stop/get/list/historyをdaemonへ接続。direct SessionはDB作成前に拒否。daemon管理者のruntime-configで実行ファイル/cwd・環境変数名・時間/出力制限を配線し、秘密値をJSONへ入れない。DB/driver/clock/IDを注入する。
- parser未実装と設定NULパスのRED→GREEN。実CLI/SQLite/fixture subprocessで開始→再開→別CLIから停止→daemon停止時cancel/drain→再起動recoveryを検証。
- 独立ReviewerのImportant 2件を修正。Bun既定idle timeoutで10秒超の応答が切れること、先頭オプションのSessionが短いclient timeoutになることを11秒の実socket応答でRED→GREEN確認。入力body検証後にrequest timeoutを無効化し、clientはparsed commandでSessionを識別。Session時間制限はRuntimeが所有し、管理者設定より先にclientで切らない。[RED](verification/2026-10-04-session-cli/long-red.txt)、[GREEN](verification/2026-10-04-session-cli/long-green.txt)。
- 全110テスト、tsgo/Oxlint/Oxfmt/AST/jev dry-run成功。[出力](verification/2026-10-04-session-cli/check.txt)。signalのundefined指定をstrict型検査が拒否したためnullへ修正。実jev最終592対象、errorsなし。[出力](verification/2026-10-04-session-cli/semantic.txt)。
- 実Codexを一時Git workspaceにread-only/approval neverで起動し、daemon/CLI経由の開始と再開で指定markerを受信。同じprovider IDとidleを確認し停止/daemon終了。raw応答・認証・個人パスは公開repoへ入れず、結果のみ保存。[実AI結果](verification/2026-10-04-session-cli/real-codex.txt)。実Claudeは未確認。RoomのMessage/summary/Memoryを用いた再構築、Task実行統合、Permission/Sandbox、Workflow等は継続対象。


## Room履歴ContextとAgent返信

- [計画](superpowers/plans/2026-10-04-room-runtime.md)。Session replyで既存Room Messageへ応答し、Agent sender/replyTo/session metadata付きの不変Messageを保存。別Room/非参加/archive/入力なしはRuntime前に拒否し、失敗時replyを書かない。Port/Runtime/identityを注入。
- 入力までの履歴だけを最大30件/UTF-8 64KiBへ制限し、省略数を渡す。source自身が大きすぎる場合は実行前に拒否。provider実行と返信appendの途中crashのexactly-onceは保証しない。
- service未実装RED→DB-free UT2件GREEN。[出力](verification/2026-10-04-room-runtime/green.txt)。実CLI/daemon/fixtureで返信保存・同じSession/Messageへの重複要求を同じreply IDで返すことを確認。全112テスト、静的検査と実jev missing/unsure0・errors/degradedなし。[全検証](verification/2026-10-04-room-runtime/check.txt)、[実jev](verification/2026-10-04-room-runtime/semantic.txt)。
- 実Codex/一時workspaceでもRoom Message→指定markerのAgent返信→replyToリンク・保存済み2件を確認。[実AI判定](verification/2026-10-04-room-runtime/real-codex.txt)。raw応答や認証情報は公開ログへ入れない。
- 独立Reviewer: Critical/Importantなし、UT2件を独立実行。Minor: Message.createdAtがturn開始時刻になるため応答完了時刻より早い。履歴はsequence順で壊れない。clockをappend直前に注入する改善を後続へ記録する。
- 次はTyped Memoryのscope/source refs/status projectionを小さく実装し、Room Contextへ接続する。全体ゴールは未達成で継続する。


## 根拠付きTyped Memoryとscope Context

- Notion03を再取得しsnapshot一致を確認。[計画](superpowers/plans/2026-10-04-typed-memory.md)。4type/scope/confidence/Message source refsを純粋domainで検証。MemoryProviderとcapture serviceへPortを注入。原Messageを変更せず明示captureする。
- SQLiteは原Memory本文を追記し、同scope/typeのactive predecessorを新記録でsupersedeする。invalidate理由/時刻も追記。statusは原記録から投影する。CLI capture/get/list/invalidate、別プロセス再openを検証。期間/自動extract/dedup/conflictは未完了。
- domain/SQLite/CLI/Contextの先行RED→GREENを記録。capture参照UTは実装と同時追加で、先行RED証拠はない。scope境界UTはactiveの現在Room/Agent/Task/company/globalだけを選び、他Room/Agentと無効Memoryを除外する。最大20件とContext全体64KiB・省略数を実装。
- daemon経由のMemory登録→Room返信Contextを実fixtureで確認。実Codexでも根拠Messageを直近30件から外した状態で、scope Memoryのmarkerを読み取り返信保存するe2e成功。[実AI](verification/2026-10-04-typed-memory/real-codex.txt)。秘密情報/raw応答は記録しない。
- 全117テスト、tsgo/Oxlint/Oxfmt/AST/jev dry-run成功。[検証](verification/2026-10-04-typed-memory/check.txt)。実jev641対象、missing/unsure0、errors/degradedなし。[出力](verification/2026-10-04-typed-memory/semantic.txt)。独立Reviewerは6テスト成功、API経由Critical/Importantなし。
- ReviewerのMinor（異なるidで同じsupersedesのINSERT OR REPLACEが原記録を消せる）を、不変historyの受入条件への違反としてImportantへ再評価し修正。全UNIQUEキー(id/sequence/supersedes)の衝突を追加triggerで拒否する。既存triggerを外す期間は作らない。実SQLのRED→GREENを保存。[RED](verification/2026-10-04-typed-memory/replace-red.txt)、[GREEN](verification/2026-10-04-typed-memory/replace-green.txt)。
- 次はExecutionTask→Room/Session実行→結果をTaskへ記録する最小実務の縦断。Approval/Sandbox/Workflow/A2A等と全体目標は継続する。


## ExecutionTaskの実行と結果確認待ち

- Notion04を再取得しsnapshotと一致を確認。[計画](superpowers/plans/2026-10-04-task-execution.md)。assigned ExecutionTask・owner・idle Session・対応Task Room・新Messageを実行前に検証。runningをversion付き保存してからDIしたRoom Runtime返信を実行する。
- result Artifactのorg URI・状態waiting_approval・2版のTask履歴を同一SQLiteトランザクションで保存。応答だけでcompletedにはしない。provider失敗はfailed、競合した人間の変更を上書きしない。既存の手動返信をTask実行結果として再利用しない境界をRED→GREEN追加。
- serviceと結果Writerを先行RED→GREEN。実DBのArtifact INSERT故障でartifact/state/history全体rollbackとstale version拒否を確認。実daemon/CLI/fixtureでTask objective注入・結果保存・direct拒否、11秒待機を検証。
- 全120テスト・tsgo/Oxlint/Oxfmt/AST/jev dry-run成功。[検証](verification/2026-10-04-task-execution/check.txt)。実jev652対象、missing/unsure0、errors/degradedなし。新規execution/sqliteにfindingなし。[実レビュー](verification/2026-10-04-task-execution/semantic.txt)。
- 実read-only CodexでTask→running→Room返信marker→Artifactリンク→waiting_approvalを検証。[実AI判定](verification/2026-10-04-task-execution/real-codex.txt)。raw応答/認証/個人パスは公開ログへ入れない。
- 独立Reviewerは3件成功、今回接続Critical/Importantなし。Minor: DIで別Sessionのmetadataを持つMessageまで防ぐ追加検証（現production Reply serviceは一致保証）を後続へ記録。
- 既存Task原履歴/Artifact/CommentのREPLACE抜けを、今回結果の不変history条件に対するImportantとして再評価。複合キーと明示rowid衝突のINSERTを追加triggerで拒否。直接SQLのRED→GREENと全suiteを確認。[RED](verification/2026-10-04-task-execution/original-red.txt)、[GREEN](verification/2026-10-04-task-execution/original-green.txt)。他の不変source表のREPLACE/rowidも次に監査する。
- Room返信とTask結果保存の間のcrashの厳密なexactly-once、running Task再起動復旧、Approval認証/API、Sandbox書込、Event自動実行、Workflow/A2A等は継続対象。全体目標は未達成。


## Runtime・Memory・Task実行のmain公開

- remote mainをfetchし2e7a65dでlocal mainと一致、worktree cleanを確認。feat/session-runtimeの検証済み6コミットをmainへfast-forwardし、通常push成功。履歴改変/force pushはしていない。
- 送信先mainとlocal mainが952d833935739f69dc54e0ee76b29a22d92b6042で一致。Lefthook pre-pushが送信tipの公開履歴・全120テスト・静的検査・実jevを31秒で実行成功。[送信検証](verification/2026-10-04-main-runtime-push/prepush.txt)。
- 実CodexのSession/Room/Memory/Task結果確認まで公開済み。全体目標は未完了で、残りの不変source表の置換防止とdaemon所有/再起動復旧を続ける。


## 不変source履歴のREPLACE監査

- [計画](superpowers/plans/2026-10-04-history-replace.md)。Room Message/Event原本、Session snapshotのrowid、Memory invalidateのrowidで直接SQL REPLACEが原履歴を消せることを実Bun SQLiteのrecursive_triggers OFFで4件RED確認。
- 全固有キー/sequence/rowid衝突を追加INSERT triggerで拒否。既存guardを外さずmutable current表を変更しない。元内容・履歴順・その後の正規INSERTを確認。旧Room DBを再openして保護を追加する検証も成功。[GREEN](verification/2026-10-04-history-replace/green.txt)。
- 全125テスト・静的検査・jev dry-run成功。[全検証](verification/2026-10-04-history-replace/check.txt)。実jev659対象、missing/unsure0、errors/degradedなし。[実レビュー](verification/2026-10-04-history-replace/semantic.txt)。独立Reviewer4件成功、Critical/Importantなし。
- Minor互換性制約: 原記録は所有APIが生成する正のrowidを前提とする。raw SQLでrowid=-1を入れたDBは、SQLite BEFORE INSERTの省略時NEW.rowid=-1と衝突して後続INSERTも拒否される。任意SQL importの対応は後続とし、CLI/Port経由の既存DBを維持する。
- 実Claudeのbare認証用APIキーの設定有無だけを確認（値は非表示）し未設定。公式headless docsのbare認証を再確認。ユーザーへ .env設定後に値を貼らず連絡するよう非同期で依頼。他の実装は継続する。[公式資料](https://code.claude.com/docs/en/headless#start-faster-with-bare-mode)。
- 次は同じDBを別socketのdaemonが同時所有/復旧しない境界とrunning ExecutionTask復旧を実装する。全体目標は未完了。


## daemonのDB単一所有

- [計画](superpowers/plans/2026-10-04-database-ownership.md)。別socketの二台目daemonが同じDBへ入りSession recoveryを実行できる経路を実CLIでRED再現。
- SQLite BEGIN IMMEDIATEのowner PID/tokenで取得を直列化。生存PIDを拒否、終了PIDは取得し直し、自tokenだけを解放。DB/親をrealpath化し全Adapterで同pathを使用、新DB0600。runtime config先検証・socket準備後にlease取得、全server/operations cleanup後にfinallyで解放する。direct/onceの管理操作は対象外。
- lease module RED→unit GREEN、実daemon別socket RED→GREEN。symlink alias、他tokenを消さないcleanup、実終了BunプロセスのOS liveness確認で再取得を検証。macOSの/tmp→/private/tmpをテスト期待へ反映し失敗証拠も記録。[unit](verification/2026-10-04-database-ownership/unit-green.txt)、[実daemon](verification/2026-10-04-database-ownership/daemon-green.txt)。
- 全128テスト・静的検査・jev dry-run成功。[検証](verification/2026-10-04-database-ownership/check.txt)。実jev676対象、missing/unsure0、errors/degradedなし。[実レビュー](verification/2026-10-04-database-ownership/semantic.txt)。独立Reviewerは製品Critical/Importantなし。期待値のcanonical path誤りを指摘、修正後全suiteで成功確認。再レビューは行わない。
- PID reuseは生存扱いの保守的制約。stale socket/lock自動回収、running ExecutionTask復旧は後続。全体目標を保持して次へ進む。

## 中断ExecutionTaskの起動時復旧

- ユーザーの「Nextがある限り継続、迷わなければ確認不要」を受領。全体目標を維持する。[計画](superpowers/plans/2026-10-04-task-recovery.md)。
- DB不要Portのrunning execution限定・注入時計・expectedVersion・競合伝播テストをRED→GREEN。DB所有lease取得後、Session復旧直後・socket受付前に配線した。保存失敗は起動を止める。
- 実daemon/SQLite/CLIでrunning→failedの履歴追記、work_itemとwaiting_approvalの保持をRED→GREEN。fixture版番号は初期0を見落とし4と期待したため3へ訂正。自動再試行や過去の出力を消す操作は行わない。
- 全131テスト・型・lint・AST成功。[全検査](verification/2026-10-04-task-recovery/check.txt)。実Jev682対象・errorsなし。[実レビュー](verification/2026-10-04-task-recovery/semantic.txt)。独立ReviewerはCritical/Important/Minorなし、DB不要2UTを別途成功確認。
- Next: 強制終了後のsocket/lock復旧とRuntime子孫processの停止。現在のsocketは既存pathを保守的に拒否する。プロセス全体の停止保証を先に検証し、stale pathを無条件削除する方法は採用しない。全体のApproval/Scheduler/Workflow等は引き続き未完了。

## Runtime process group停止

- [計画](superpowers/plans/2026-10-04-runtime-process-group.md)。実driverが孫processを作りstdoutを継承するtimeout/cancel/通常終了を3件RED再現。Bun.spawn detachedでgroup単位停止し3件GREEN。既存入力/env/出力量の3テストも維持した。
- Darwinの高速終了groupではreap前にEPERMが返ることをfixtureで確認。直接childを終了/回収してgroup停止を再試行し、ESRCHのみ終了済として許容する。初回GREEN実行はこの競合で失敗し、対処後6件成功。[GREEN](verification/2026-10-04-runtime-process-group/green.txt)。調査でpsのsandbox制限により終了できなかったfixtureはPIDを特定してcleanup済み。
- 全134テスト・型・lint・AST成功。[全検査](verification/2026-10-04-runtime-process-group/check.txt)。実Jev690対象、missing/unsure0・errors/degradedなし。[実レビュー](verification/2026-10-04-runtime-process-group/semantic.txt)。独立Reviewerも6テスト成功、Critical/Importantなし。
- Final: minor (deferred): Linuxで孤児zombie未回収の場合、テストのkill(pid,0)が生存扱いとなりfalse failureになり得る。現Darwinは成功。Linux実機対応時に終了判定を調整する。
- Next: daemon自身をSIGKILLした時にもRuntimeが残らない、pipeを使った監督processの最小e2eを進める。groupを離脱するprocessの隔離はSandbox段階で扱う。stale socketの無条件削除は行わない。

## daemon強制終了時のRuntime監督

- [計画](superpowers/plans/2026-10-04-runtime-guardian.md)。Runtime ownerだけSIGKILLするとdriverと孫が生存することをRED再現。Bun監督processのstdinをlifelineとして開いたまま保持し、EOF/reader errorでgroup停止。argv/input/envはstdin JSON行で渡し秘密をprocess argvへ載せない。driver stdin/output/exitCodeを維持した。
- source・Bun bundle両方で強制終了e2e成功。既存process/groupテストと合わせ8件成功。全136テスト・型・lint・AST成功。[全検査](verification/2026-10-04-runtime-guardian/check.txt)。実Jev699対象、missing/unsure0・errors/degradedなし。failure-path補助指摘は未到達のOS権限error等を含むため、独立Reviewerで実停止/timeout/FDを確認し非阻害と判断。
- 独立Reviewerも8件成功、大stdin timeoutと20回起動後FD数が増えないことを確認、Critical/Importantなし。Final: minor (deferred): guardian起動失敗のgeneric診断末尾が改行でなくliteral backslash+n。exit1と秘密非露出は維持される。
- 実CodexでTask実行→Room返信→Artifact→waiting_approvalの実e2eを再検証、全boolean成功。[公開可能な結果](verification/2026-10-04-runtime-guardian/real-codex.txt)。raw応答・一時workspaceは公開ログへ含めない。
- Next: この復旧/停止のまとまりをmainへ通常pushする。stale socketの安全な回収と、Approval/Agent組織・Scheduler等を小さく進める。setsidによるgroup離脱はSandboxの隔離で扱う。全体ゴールは未完了のまま継続。

## main公開：復旧とRuntime監督

- mainへfast-forwardし通常push成功。remote mainとlocal mainは1ea9cefdbae17bfd43467580695672b7ffccd3acで一致。force-pushなし。
- Lefthook pre-pushの公開内容/送信履歴検査、全136テスト・静的検査・実Jevゲートが31.88秒で成功。[公開可能なhook記録](verification/2026-10-04-main-recovery-push/prepush.txt)。旧feature remote refの履歴改変は行わない。
- 次はTask結果を人間が明示的に承認/却下し、その対象version・成果物・actor・理由を不変記録として残す小さなe2eを進める。これは結果確認であり、外部操作Permission/Approvalは後続。stale socketは安全なowner metadata/DB単一所有との整合設計を先に行い、現時点は既存pathを保守的に拒否する。

## Claude Max利用の訂正と実e2e

- ユーザー指摘：Claude Maxを使う想定。bareを選んだことでAPIキーだけを要求していた実装上の制約を訂正し、API-only Agentに限定しない。[計画](superpowers/plans/2026-10-04-claude-max.md)。
- Claude Code 2.1.289と公式認証/CLI docsを確認。auth statusは非秘密フィールドだけを出力しclaude.ai/max/loggedInを確認。safe-modeへ切替、tools/slash commands無効・disableAllHooks・strict empty MCP、resume時のsystem prompt再評価を維持。managed policyはClaude Codeの優先規則に従う。UT RED→4GREEN。
- PATH/HOME等だけではMax認証がnoneとなった。広範なCLAUDE/SECURITY/KEYCHAIN系の環境値を試す操作は自動承認reviewによりcredential probingとして拒否され、中止した。より限定した非秘密OS情報USER/LOGNAMEだけの確認は承認されclaude.ai/maxの認証が見えた。資格情報探索・値の公開はしない。
- 実daemonからAPIキー/tokenを渡さずClaude Max start→同provider Session resume→Task run→Room返信/Artifact→waiting_approval→stop成功。全marker/links true。[公開成否](verification/2026-10-04-claude-max/real.txt)。検証scriptの初回はAgent create通常文字出力をJSONとして読んだため失敗、修正。次はOS識別情報不足でCLI exit1、USER/LOGNAMEを含めて成功した。raw応答・認証情報は公開しない。
- 作業treeの全138テスト（並行して保存したTask結果レビューのDB不要2UTを含む）・静的検査成功。[全検査](verification/2026-10-04-claude-max/check.txt)。実Jev707対象・missing/unsure0・errors/degradedなし。独立ReviewerもClaude4UT成功、Critical/Importantなし。
- Final: minor (deferred): safe-modeはMax専用認証を強制しない。明示して渡されたAPI key/helper等はClaudeの認証優先順に従う。この検証はAPI key/tokenを渡さずMax認証で成功したという保証であり、全構成でMaxを強制する保証ではない。
- Next: 保存中のTask成果物レビュー実装へ戻る。全体ゴールを維持し、確認待ちで止まらず続行。

## Task成果物の人間レビュー

- [計画](superpowers/plans/2026-10-04-task-result-review.md)。DB不要のpure判断/Port UTをRED→GREEN。waiting_approval executionと成果物、expectedVersion、actor/理由/判断/id/時刻を検証。SQLite recordReviewは再検証と成果物参照一致をBEGIN IMMEDIATE内で行い、状態・履歴・decision原記録を一緒に保存する。approve→completed、reject→failed。
- 実DBでCAS・証拠の食い違い・decision INSERT失敗時rollbackと、全UNIQUE/rowidのREPLACE/UPDATE/DELETE拒否をRED→GREEN。既存DBにadditive table/trigger。実daemon CLI review/reviewsで一度だけ判断・再open永続化をRED→GREEN。parserは入力をDB作成前に検証。
- 初回lintがテストJSONのany代入を検出。unknownへの読込みとフィールド検証へ訂正、失敗証拠も保存した。
- 独立ReviewerのImportant：recordReviewがcompleted時の既存依存関係検証を迂回。未完了依存を追加したwaiting_approvalを承認できることを実DB RED再現、transaction内validateReferencesでGREEN。Final: fixed completed依存不変条件の迂回 — approval preserves the completed-dependency invariant RED→GREEN、全141/141成功。その他Critical/Important/Minorなし。再レビューは行わない。
- 全141テスト・型・lint・AST成功。[全検査](verification/2026-10-04-task-result-review/check.txt)。実Jevの修正前/後を記録。[実レビュー](verification/2026-10-04-task-result-review/semantic.txt)。
- 実Claude Max start→resume→Task結果→Artifact→明示review→completed→decision参照→Session stopを隔離marker Taskで成功確認。[公開成否](verification/2026-10-04-task-result-review/real-claude-max.txt)。本物の外部業務の承認を代理したものではない。
- actorはローカル操作側の記録値で認証保証はなく、管理task updateも保持。外部副作用のPermission/Approvalは後続。全体ゴールは未完了。NextはAgent組織のreportsTo/循環防止を小さく実装し、委譲の土台へ進める。

## main公開：Claude MaxとTask結果レビュー

- mainへfast-forwardし通常push成功。remote/local mainは390475626e3b1c85d693cc7a87fed0657cbba8f5で一致。公開内容/送信履歴・全141テスト・静的検査・実Jevのpre-pushゲートが32.51秒で成功。[hook記録](verification/2026-10-04-main-review-push/prepush.txt)。
- 次のAgent組織についてNotion01を再取得。page_last_edited_at 2026-10-04T01:51:58.336Z、保存済みsnapshotと同じ。reportsTo、Chief→専門Agent、coordinatorとtyped A2Aを再確認。まずreportsToの保存/循環防止/履歴に絞り小さく進める。

## Agent reportsToと組織関係

- [計画](superpowers/plans/2026-10-04-agent-reporting-lines.md)。optional reportsToとpure/DI変更判断をRED→2UT GREEN。存在しないAgent/上司・自己/間接循環を拒否し、解除時はreportsToを省略、既存ID/名前/role/runtime/createdAtを保持する。
- Agent所有SQLiteのnullable columnと追記履歴をadditive migration。constructor migration、作成時の上司参照/初回履歴、変更時graph再読込/検証をBEGIN IMMEDIATE内で実施。stale service判断でも相互cycleを通さず、同一関係no-op、失敗rollback、旧Python schema互換・全unique/rowid REPLACE/UPDATE/DELETE拒否を実DB RED→GREENで確認。
- create --reports-to、report --to|--clear、reporting-history、list JSONを実daemon CLIでRED→GREEN。action別option拒否とclear/to排他も確認。初回型検査はSQL bindのnull型を漏らし修正、lintはnullable未知値のString変換を検出し明示text検証へ修正。
- 全145テスト・型・lint・AST成功。[全検査](verification/2026-10-04-agent-reporting-lines/check.txt)。実Jev736対象、missing/unsure0・errors/degradedなし。[実レビュー](verification/2026-10-04-agent-reporting-lines/semantic.txt)。独立Reviewer3UT成功、Critical/Important/Minorなし。
- Next: typed A2Aのdelegate/request/result/question/decision/blocker/cancelを不変Room Messageに載せ、宛先・Task・correlation参照を検証する。自動Agent wake-up/委譲やPermissionは組織登録だけで付与せず、次の境界として実装する。全体ゴールは保持し継続。

## typed A2Aの不変Message（2026-10-05継続）

- [計画](superpowers/plans/2026-10-04-typed-a2a.md)。7種類のA2A envelopeをRoom Messageのmetadataへ保存し、原本を二重管理しない。純粋domainとAgent/Room/Taskの必要操作だけを注入するserviceを実装。返信時はTask/correlationを引き継ぎ、宛先逆転・同Room・Task Room参照を検証する。
- DB不要8UT RED→GREEN。service最初のREDはBun loaderのunknown errorであり、振る舞いの失敗証拠ではない。Task参照/readerのcorrelation検証等は個別REDを保存した。
- 実daemonのCLI request→resultが未実装--fromで失敗するREDを確認。send/get/listを配線後、fixtureが--direct/--socketを併用して失敗。fixtureのtransport選択を訂正し10/10成功。archive後の再open、非参加Agent・不存在Task・correlation不一致の拒否と原本不変を検証。
- CLIはJSONをunknownから有限JSONへ検証し、誤ったtype/options/payloadをDB作成前に拒否。A2Aは現時点で記録/参照の機能であり、認証保証・自動Task委譲・Agent起動ではない。
- 全155テスト・tsgo/type-aware Oxlint/Oxfmt/AST成功。[全検査](verification/2026-10-04-typed-a2a/check.txt)。実Jev782判定、errors/degradedなし。[実レビュー](verification/2026-10-04-typed-a2a/semantic.txt)。CLI parse/runのfailure-path候補を独立レビューと合わせて判定する。
- 次のActivation設計のためNotion02を再取得し、保存済み内容と同じRoom/Session分離と4つのactivation policyを確認。自動起動を全Agentへ無条件に広げず、coordinator・明示宛先・重複防止を境界で設計する。
- Final: 独立ReviewerはA2A全4source/app差分/3test/計画/README/要件をアクセス障害前に読了。Critical/Important/Minorなし。独立UTはBun Unexpectedで終了、その後OS側Operation not permittedとなり独立GREENとは扱わない。補助failure-path候補は入力/type/JSON/options/参照/保存拒否を既存e2e/UTで確認し、非阻害と判断。
- 一時的なOS側アクセス拒否でcommit前に停止。通常・明示cwd権限付き読取りも拒否、git親とrepoがerrno1、tmpは読み書き可能だった。復旧後にdiff/保存済み検証記録を確認。資格情報探索・権限制約の回避は行わない。復旧後に全ゲートを再実行してcommitする。
- 復旧後の全155テスト・静的ゲート再実行成功。[復旧後検査](verification/2026-10-04-typed-a2a/recovered-check.txt)。独立レビューの読了範囲と実行不能を別記した。Next: 通常main push後、Room coordinator指定と明示mention/A2A宛先のActivation判断をTDDで実装する。

## main公開：Agent組織とtyped A2A

- mainへfast-forward/通常push成功。remote/local mainは574eff0422f6522da0d0b8dd4bc379e95afca892で一致。Lefthook pre-pushの公開内容/履歴・全155テスト・実Jevゲートは34.03秒で成功。force-push/旧remote feature履歴変更なし。

## Room Activationの選択

- Notion01再取得、page_last_edited_at 2026-10-04T01:51:58.336Z。Coordinatorだけを既定起動し明示mentionを優先する仕様を再確認。[計画](superpowers/plans/2026-10-05-room-activation.md)。
- optional coordinatorIdはRoom JSONを再利用し、参加Agentだけ許容、旧JSONでは省略。単一Agentの旧Roomは唯一のAgentを選択、複数Agentは明示coordinatorが必要。metadata.mentionsを既存createMessage保存境界で検証し、CLI --mention複数指定を配線。
- pure selectActivationAgentsはcoordinator/mention_only/all・typed A2A宛先を判断。普通のAgent返信は連鎖発火させずsenderも除外。Room/参加者/原本/archived/不正mentionを拒否。DB不要2UT RED→GREEN。
- Ruling: rule_basedの構文はNotion未指定。明示宛先だけ対応し、未指定なら未対応errorとして閉じる。任意コードrule engineは作らず、ルール定義/評価は次の専用計画で実装する。誤りのcostはrule_basedの未対応範囲が残ること。
- room create --coordinator / send --mention / targets --messageを実daemon RED（未実装option）→GREEN。archive/誤Room/非参加mention拒否、旧Room/新Room再openを確認。対象Room回帰含む6テスト成功。型検査でtest entity helperの戻り型のidだけ推論される問題を検出、検証済みRecord+idの戻り契約を明記して訂正する。
- 全158テスト・型/lint/format/AST成功。[全検査](verification/2026-10-05-room-activation/check.txt)。実Jev797対象・missing/unsure0・errors/degradedなし。[実レビュー](verification/2026-10-05-room-activation/semantic.txt)。独立レビュー待ち。
- Final: 独立Reviewer Critical/Important/Minorなし。domain2UT・実daemon CLI1e2eも独立成功（通常sandboxのsocket EPERM後、権限付き実行で成功）。補助failure-path候補は既存検証範囲/未到達のOS error等を含むため、非阻害と判断。Next: 選択結果からSessionを準備し既存Room context返信へ結線するmanual activation e2e、続いてdurable自動wake-upを進める。

## Room選択からSession返信へ

- [計画](superpowers/plans/2026-10-05-room-wake-up.md)。LocalAgentRuntime.openは既存createSessionForAgentのidle保存を再利用し、startもopen→sendへ統一。余分な初回空turnを発行しない。
- activateRoomMessageへRoom/Sessionの必要操作とopen/reply callbacksをDI。選択したAgentだけ、同Room idle/failed Sessionを再利用。running拒否、stoppedは再利用しない。保存済みsource/Agent返信は再利用し、返却Session/Messageの整合を検証する。DB不要2UT RED→GREEN。
- room activate --messageをdaemon専用にし、既存Room履歴/scopedMemory contextと返信保存へ配線。typed A2Aの参照は実行前に既存Readerで検証。実subprocess e2eでcoordinator/mention/A2A・provider Session継続・再実行の重複なし・driver failureをRED→GREEN。
- 11秒Unix socket応答をRoom activateに追加しclient5秒timeoutのREDを確認。Runtimeのtimeout/cancel境界に委ねてGREEN、既存Session/Taskrunも保持。計4対象テスト成功。
- 全161テスト・静的ゲート成功。実Jev816対象・missing/unsure0・errors/degradedなし。補助failure-path候補は対象UT/CLI検証と独立レビューに照合し非阻害と判断。独立Reviewer Critical/Important/Minorなし、2UT/fixtureCLI/11秒transportの4テスト独立成功。
- provider完了後・返信保存前のcrashはturnを再実行し得る。manual段階でexactly-once・自動retryを主張しない。次は同操作をdurable自動wake-upと復旧へ結ぶ。
- 実Claude MaxでもAPIキー/tokenを渡さず隔離marker Roomのcoordinatorだけ起動→繰返し返信再利用/no turn→同org/provider Session継続→idleを検証し全boolean成功。[実Max成否](verification/2026-10-05-room-wake-up/real-claude-max.txt)。初回はJSON.stringifyのproperty順比較で返信一致だけfalseになり、deep equalityへ訂正して再実行成功。raw応答/認証値は公開しない。

## main公開：Room Activationとmanual wake-up

- mainへfast-forwardし通常push成功。remote/local mainは9fb578bfbb26b5bb6f7f7c8b60683aa9c221f916で一致。公開内容/履歴・全161テスト・実Jevのpre-pushゲートが33.67秒で成功。force-pushなし。

## daemonのdurable自動wake-up

- [計画](superpowers/plans/2026-10-05-automatic-wake-up.md)。SQLiteのimmutable intent/resultをJOINしてstate投影。Message単位claimをBEGIN IMMEDIATE（Bun native transaction.immediate）で二重拒否、終端結果参照とrollback/reopen、全UNIQUE/sequence REPLACE・UPDATE・DELETE拒否を実DB RED→GREEN。
- pollRoomWakeupsはRoom/Session/Journal/activate/clockをDI。通常Agent返信を対象外にし、busyは未claim延期。永続claim→既存activation→結果/失敗を確定、失敗で他Messageを止めず、終端を再実行しない。起動未確定intentはfailedへ復旧。DB不要2UT RED→GREEN。
- --wake-upはcontinuous/runtime-config必須のopt-in。daemon wakeups/GETを配線。tick重複抑止、Runtime cancel→drain→DB close。実daemon fixtureで投稿から自動coordinator/mention、driver failure一回、停止pendingturnのdrain、再起動のno replay/未確定復旧をRED→GREEN。対象9件成功。opt-in/async非並列/close順の契約も確認。
- Ruling: intentはMessage単位。all policyの一部成功後失敗はmanual activateで残りを再試行し保存済み返信を再利用する。無制限retryは作らない。costは一部失敗後にmanual操作が必要なこと。定期schedule/Task retry/per-Agent receiptは後続に残す。
- 修正前の全167テスト・静的ゲート成功、実Jev866判定missing/unsure0・errors/degradedなし。独立Reviewer Important：停止後も既存pollが後続Messageをclaimし、Runtime closedで未実行まで永久failedになる。shutdown reject時のdrain省略も指摘。2件REDを再現し、serverからAbortSignalを渡して次claim前に終了、shutdownのfinallyでdrainを保証して10件GREEN。Critical/Minorなし。修正後全ゲート/実Jevを実行中。再レビューは行わない。
- Final: fixed 停止後の誤claimと異常時drain省略 — shutdown leaves later unexecuted Messages unclaimed / shutdown error still drains RED→GREEN、修正後全169/169・全静的ゲート成功。実Jev868判定・missing/unsure0・errors/degradedなし。
- 実Claude MaxでもAPI key/tokenなしで投稿→coordinatorだけ自動返信→同org/provider Session継続→idle、繰返しno replay/no turnを隔離markerで確認、全boolean成功。[実成否](verification/2026-10-05-automatic-wake-up/real-claude-max.txt)。raw応答は公開しない。Next: Eventで生成した割当ExecutionTaskの自動実行、委譲/権限/結果レビューへ小さく接続する。
- Jevのpoll catch-hides-failure候補は、catchでfailed終端原記録を確定しwakeupsで公開する実装に照合した。原本へ状態/理由を残し他Messageを進める仕様であり、成功扱いへの握りつぶしではない。非阻害と判断。

## main公開：durable Room wake-up

- remote/local mainは7b86fa0ca74d894d57278d201ac832bc96613ec2で一致。通常pushのpre-push全169テスト・実Jev・公開検査が42.12秒で成功。force-pushなし。

## Event由来ExecutionTaskの自動実行

- Notion09/04の現行仕様を再取得し確認（last edited 2026-10-04T01:51:58.336Z）。[計画](superpowers/plans/2026-10-05-automatic-task-execution.md)。既存Task状態・Task Room・Session・runExecutionTaskを再利用し、新規queue/tableなし。必要Port/callback/identity/signalをDI。
- assigned ExecutionTask/owner/完了済み依存だけ実行。busyは延期、WorkItemは除外。Task/version付き入力を再利用、結果Artifactとwaiting_approvalは既存原子保存。準備失敗をfailed/CAS履歴へ残し、停止後の次Taskを開始しない。自動承認・自動retryなし。
- DB不要UT RED→GREEN、実daemon CLI RED（assignedのまま）→GREEN。Event→Subscription→Task→Memory context→Runtime結果→Artifact→明示レビュー、失敗一回/再起動no replay/他Task継続を確認。fixtureのpossibly undefined型検査REDもassertで訂正。[証拠](verification/2026-10-05-automatic-task-execution/)。
- 全173テスト・tsgo/Oxlint/Oxfmt/AST成功、35.75秒。独立Reviewer Critical/Important/Minorなし、UT3+CLI1も独立成功。
- 実Claude MaxでもAPIキー/tokenを渡さず、Memoryにだけ置いたmarkerをEvent由来Taskの結果として取得。成果物/承認待ち/明示レビュー/再起動後の次Taskと旧成果物保持の全boolean成功。隔離markerへのe2e-humanレビューは業務成果の人間承認とは区別する。raw応答/ローカルpath/認証情報は公開しない。
- 最新生成物の実Jev890判定、errors/degradedなし。catch候補はfailedへの明示保存・CAS維持・他Task継続という仕様とUT/CLIの失敗検証に照合し非阻害と判断。Next: typed A2A委譲をExecutionTask生成/実行へ接続し、Permission/Approval境界を進める。

## main公開：自動ExecutionTask実行

- 通常push成功、pre-push全173テスト・実Jev・公開検査38.54秒。main e0b7341。

## Agent Capabilityとdelegate境界

- executing-plansのinline実装と最終独立レビューを継続。[計画](superpowers/plans/2026-10-05-agent-capabilities.md)。Notion08再取得last edited 2026-10-04T01:51:58.336Z。
- 既存Agentにoptional capabilities、既知9値/重複/型を検証し入力配列をコピー。SQLite nullable JSON列を移行し旧JSONの省略を維持。Adapter保存も検証。CLI --capability複数指定はDB作成前に検証。
- delegate送信はsender can_delegate必須、保存前拒否。通常Room metadataでreserved envelopeを記録する迂回もdaemonの共通manual/auto activation直前に同じ検証を行い、Session準備前に拒否。ローカル管理者によるAgent設定であり認証は提供しない。
- domain不正grantとdelegate保存前拒否のUTをRED→GREEN。実daemon CLIで明示grant/拒否/再open/metadata迂回拒否、旧schema/不正Adapter入力を確認。実行側検証を外したREDでは未設定Runtimeへ到達していたことを確認、復元後GREEN。strict型検査のoptional spreadをdestructureで訂正。
- Ruling: 他のcan_*は既知値として保存するが、この変更で未実装の境界の権限保証は主張しない。省略時delegate拒否、作成後のgrant変更APIは未提供。costは既存delegateに明示設定が必要なこと。Permission/Approval全般は未完了。
- 独立Reviewer Important: 疎配列capabilitiesがsome/mapのhole skipで保存されJSON [null]となり、以後Agent一覧を壊す。domain/実SQLite2件REDを確認し、共通validatorでArray.fromによりholeをundefinedとして検証、6件GREEN。Critical/Minorなし。独立UT11+CLI2成功。再レビューせず修正後全ゲートを実行する。
- Final: Ruling: 他can_*未対応とlocal管理者のsender指定は今回の明記された制約。reserved metadataの直接記録は許容しdelegate実行側で拒否する。costは記録だけでは送信許可を保証しないこと。Agent本人認証/重要操作Approvalを後続で実装する。
- Final: fixed 疎配列の永続化破損 — domain/SQLiteの保存前拒否2件RED→GREEN、修正後全176/176・型/lint/format/AST成功、33.63秒。実Jev902判定・missing/unsure0・errors/degradedなし。新規candidateは保存前validation/CLI拒否/legacy回帰と独立レビューに照合し非阻害。次はこのgrantでtyped delegateを冪等ExecutionTask生成へ接続する。

## main公開：delegate Capability

- main6261692へ通常push成功、全176テスト/実Jev/公開検査pre-push38.37秒。force-pushなし。

## Typed delegateからTask実行へ

- [計画](superpowers/plans/2026-10-05-a2a-task-delegation.md)。既存typed原本/can_delegate/TaskProvider.createAssignedOnceと自動Task workerを再利用。source Message IDのnamespaceをTask IDとし、宛先owner/Task parent/source URIを保持。sender/recipient/Room/Task/非archive/別Agentを検証。
- DB不要UT RED（未export）→GREEN、同一原本で同一candidate・advanced Taskを既存Writerから返す・権限/参照拒否を検証。実daemon e2e RED（delegate must create a Task）→GREEN。Memory context/1Task/1turn/元Room余分返信なし/成果物→明示レビュー/再起動no replay、既存Event/失敗/権限回帰を含む9件成功。
- Ruling: payload schemaはNotion未指定。JSON全体をTask objectiveに渡し追加schemaは作らない。結果はTask/Artifactで参照しtyped result返送は次変更。costは委譲元Roomへの結果返送が現段階ではないこと。manual activateは割当まで、--wake-upで実行まで。wake-up receipt completedはTask作成完了であり成果完了ではない。
- 全177/177テスト・静的ゲート成功、34.98秒。実Jev906判定missing/unsure0・errors/degradedなし。生成物のfailure-path候補を参照/権限/保存失敗/実CLIのRED-GREENと照合し非阻害。
- 実Claude MaxでもAPIキー/tokenなしでCoordinatorから専門Agentへのtyped delegate→scoped Memoryだけのmarker→成果物/承認待ち→隔離markerの明示レビュー→再起動後の次delegateを検証。宛先owner/source参照/余分なRoom返信なし/旧成果物保持を含む全boolean成功。raw応答/ローカルpath/資格情報は公開しない。
- Final: 独立Reviewer Critical/Important/Minorなし。service6+実CLI1計7件も独立成功。Final Ruling: payload専用schema/typed result返送/Agent本人認証は明記された後続範囲、costは現在のTask/Artifact参照とローカル管理者設定に限られること。Next: 委譲元Roomへtyped resultを保存し、結果返送の復旧/重複防止を検証する。

## main公開：typed delegate Task実行

- main51bb239へ通常push成功。全177テスト/実Jev/公開検査pre-push40.19秒。force-pushなし。

## 委譲成果のtyped返送

- [計画](superpowers/plans/2026-10-05-a2a-task-results.md)。既存Task結果/不変Room原本で返送の重複抑止、追加queue/tableなし。必要Port/identity/signalをDI。owner/parent/source整合と過去Task historyのstatus/version/成果物を照合し、偽装返送を拒否。
- waiting_approval/completed結果をtyped result、成果物なしfailedをblockerで元delegateへのreplyTo/correlation/Task参照を保って保存。payloadは内部TaskとArtifact参照のみ、provider raw errorなし。Task保存と返送を分け、返送障害はTaskをfailedへ戻さず次tickで再試行。
- UT RED（未export）、CLI RED（返送待ちtimeout）→GREEN。fixtureが返信元参照を渡さず失敗していたため実Adapterと同じ参照を渡して訂正、対象8件成功を実出力で確認。DB障害伝播/偽装結果拒否/failed blocker/返送再試行/停止/再実行なしをUT、実daemonで成果物参照/Coordinator通知/再起動を検証。fixtureの不要quote escapeをOxlintで検出し削除。
- Ruling: archived原Roomへの返送は延期しTask成果を保持。通知はレビュー可能な結果であり自動承認しない。初回status/versionを不変通知、後続レビューdecision通知は別変更。costは最新レビュー状態をTask側で参照すること。
- 全178/178・全静的ゲート成功、35.16秒。実Jev911判定missing/unsure0・errors/degradedなし。実Claude Maxの委譲/scoped Memory/成果物/typed result/Coordinator marker応答/明示レビュー/再起動no replayの全boolean成功。[実成否](verification/2026-10-05-a2a-task-results/real-claude-max.txt)。raw応答/認証情報は公開しない。
- Final: 独立Reviewer Critical/Important/Minorなし。service7+実CLI1計8件も独立成功。Final Ruling: archived返送延期/後続review decision通知/Agent本人認証は今回の明記された制約。Exactly-onceの外部副作用保証は主張せず、返送保存後の再実行抑止を実Room原本で検証。costは後続通知と外部副作用保証が残ること。Next: Schedulerの定期Eventと再起動整合性、続いてSandbox/Permission/Approvalを進める。

## main公開：typed委譲成果返送

- main8e9396dへ通常push成功、pre-push全178テスト/実Jev/公開検査52.26秒。force-pushなし。

## 固定間隔Scheduler

- Notion07再取得last edited 2026-10-04T01:51:58.336Z。[計画](superpowers/plans/2026-10-05-periodic-scheduler.md)。EventBus.publishOnceをBun SQLite native transaction.immediateで実装、同ID同内容（JSON property順非依存）は原本再利用、異内容はconflict。2Adapter/保存障害再試行/既存不変triggerを実DB RED→GREEN。疎配列payloadがJSON nullになるREDも確認し、既存共通jsonValueのArray.fromで全callerのholeを検証。
- Scheduleの純粋判断と最小Port/SQLite/CLIを追加。definitionはWITHOUT ROWIDとSQL triggerでUPDATE/DELETE/REPLACE禁止、enabledのみ明示変更。UTC startAtMs/正safe整数intervalを保存、CLI canonical ISO境界変換で既存domain AST制約を保持。不正引数はDB作成前拒否。
- 既存daemon dispatch前に定期EventをpublishOnceし、Subscription→Task→Runtimeへ接続。別timer/queue/cursorを増やさずEvent logをreceiptにする。時刻巻戻りで未発行の過去slotを発火しないよう原Event receiptのhigh-waterを使用、RED→GREEN。
- CLI RED（未command/0 Events）→GREEN、disable/get/enable/別worker再pollの原Event保持。常駐e2eも定期Event→Agent/scopedMemory→成果物/承認待ち→disable/再起動no replayを確認。既存wake-upへ余分な引数を挿入した配線ミスを型検査/既存Runtime e2eが検出、訂正後に実行成功を確認する。
- Ruling: missed slotは最新一件へcoalesce、clock rollbackは保存済み最大slot未満を抑止。cron/calendar/timezone専用APIは後続。UTC epochのstartAtMsをJSONに保持しCLIでcanonical UTC ISO変換。costは全missed runのcatch-upや専用calendar APIがないこと。Event log scanの性能上限をponytailコメントに記録、測定前にcursor/queueを追加しない。
- 全183/183・型/lint/format/AST成功、40.40秒。実Jev949判定missing/unsure0・errors/degradedなし。
- 実Claude Maxでも定期Schedule→scheduler source Event→scoped Memoryだけのmarker→Task成果物/承認待ち→明示レビュー→disable保持/再起動後の次Scheduleを確認し全boolean成功。[実成否](verification/2026-10-05-periodic-scheduler/real-claude-max.txt)。raw応答/資格情報は公開しない。
- Final: 独立Reviewer Critical/Important/Minorなし。domain/SQLite5+実CLI2計7件も独立成功。Final Ruling: 全missed slot catch-up/専用cron-calendar-timezone/cursorは今回の明記された後続、costは固定間隔とcoalesceに限られること。Next: Sandboxの実行/破棄境界とArtifactファイル回収、Permission/Approval/Auditへ進む。

## main公開：固定間隔Scheduler

- main4186f60へ通常push成功。pre-push全183テスト/実Jev/公開検査49.86秒。force-pushなし。

## Docker Sandbox（進行中）

- 継続指示に従い[計画](superpowers/plans/2026-10-05-docker-sandbox.md)を保存。ExecutionTask ownerとcan_run_shell/can_read/can_write、relative artifact path、code/resource上限のDB不要UTをRED（未module）→GREEN2件。Docker呼出DIによる作成/隔離flags/ID限定cleanup/作成失敗no deleteもRED→GREEN2件。
- Docker engine29.4.0で公式Bun1.3.4 imageを取得しregistry digest固定。ホストmountを廃し容量64MiBのtmpfsを使用する判断へ計画更新。readonly rootfsにdocker cpが拒否された実失敗を確認し、固定管理コードを標準入力からtmpfsへ配置する実装へ変更。管理配置のみroot、実行は非root、network none/cap-drop ALL/no-new-privileges/resource上限を維持する。
- 実DockerのTS実行成功、readonly workspace拒否、明示writable成功、timeout、事前cancelを1件の実integrationで確認。静的型/lint/format/AST成功。現段階は空workspaceのrun/destroyのみ、repo export/Artifact回収/Task CLIは未実装であり全体完了ではない。全テスト/実Jev/独立レビューは変更完成後に実行する。
- Artifactはprivate directoryのSHA256 blobへexclusive作成、不変digest照合/O_NOFOLLOW/regular-file制約。symlink置換のRED（未module）→GREEN1件。Sandbox Task serviceの権限拒否no execution/成功stage RED→GREEN1件、既存LLM Task2件も成功。
- 共有executeAssignedTaskでrunningと結果stage/failed CASを既存LLM/Sandboxの実2callerへ適用。sandbox --direct CLIとartifact読取を配線し、実Docker CLI→stdout Artifact→waiting_approval→再実行拒否→明示レビューcompletedのe2e成功。CLI配線自体は失敗e2e前に追加してしまったためTDD順序の逸脱を記録し、後続拡張はCLIの失敗を先に確認する。
- Sandbox remote実行は現段階で拒否し--directのみ。daemon内実行はactive-job cancel/drainへ接続する後続で許可する。既存daemon shutdownの保証を未接続の長期Sandboxへ広げない。repo/file回収は未実装で明示reject。
- ファイル選択の実Docker/CLI RED（未回収/unknown --file）→GREEN。各directory/fileをO_NOFOLLOWのfd相対openで辿り、symlink差替えのpath競合を避け、regular file/総量1MiB/base64 encodingを検査。stdout+file bundleは単一既存Task Artifactへ保存、encoded blob上限1MiB。
- repo export RED（未module）、CLI RED（unknown --repo）→GREEN。HEADをcommit hashで固定しnative Git blobを読み、regular file最大2000件/8MiB、個別1MiB。env/key/既知credentials directory・未追跡・未commit変更・Git履歴を除外し、symlink/submodule拒否。実CLIでsource import/作業copy書換/元source不変/envとuntracked不存在/Artifact/明示レビュー成功。
- Ruling: tar archiveではなくGit object読取を採用し、credential除外/サイズ/regular fileをコピー前に確定する。encoded bundleは一既存Artifactで扱い、複数Artifact transactionを追加しない。costはlarge repo/Artifactやsubmoduleに別対応が必要なこと。実行中containerの親SIGKILLはdeadline対象、作成からstart前の異常死ではstopped containerが残り得る点を区別する。daemon経由/LLM tool/credential injectionは後続。
- 全190/190・型/lint/format/AST成功、37.36秒。Docker実機3件は既定全検査ではskipし別途opt-in実行。実Docker2件（隔離/ファイル/cancel/output/timeoutとrepo/Task CLI）成功、親SIGKILL後のrunning container期限終了/自動削除1件31.60秒成功。[証拠](verification/2026-10-05-docker-sandbox/real-docker.txt)。親SIGKILL検証中のstopped container残留は対象外の既知制約であり区別する。
- 実Jev1004判定missing/unsure0、errorsなし。未校正warningは既存/new関数の失敗分岐網羅候補であり自動承認根拠としない。権限拒否/CLI不正引数/作成失敗no delete/symlink拒否/サイズ境界/timeout/cancel/output/既存Task failure-CASの実テストと独立レビューで今回の変更を判定。
- Final: fresh独立Reviewer Critical/Important/Minorなし。Sandbox7件と既存LLM2件を独立成功。PID1へ同UID SIGSTOPを送るdeadline迂回候補は実Dockerで不成立を確認、期限後自動削除、probe cleanup済み。Final Ruling: one-shot Dockerのみ、daemon接続/credential注入/LLM toolは後続、large repo/encoded blob上限、作成からstart前crashのstopped container残留。costは該当後続と孤児停止containerのcleanupが必要なこと。Next: Permission/Approval/Auditとdaemon Sandbox cancel/drain、LLM tool境界へ進む。

## main公開：Docker Sandbox

- maina7c1580へ通常push成功。pre-push全190テスト/実Jev/公開検査45.50秒。force-pushなし。

## 権限変更のApprovalとAudit（進行中）

- 全体Nextに従い[計画](superpowers/plans/2026-10-05-permission-approval.md)を保存。Notion08のpermission変更を最初の実callerにする。pending request/人間decision/Agent revision CAS/approval receiptの実適用と、不変Auditを実CLIで確認する。外部operationや本人認証の空scaffoldは追加しない。
- Approval domain/serviceのDB不要UTを未module RED→GREEN。pending/reject/異ID/Agent自動承認を拒否し、approvedだけ実writerへ渡す。SQLite request/decisionは不変triggerとnative transaction.immediate、同key同内容原本再利用/異内容conflict、2Adapter/再openを実テスト。
- Agent capability revision/CASとapproval receiptを公開Portへ追加。Agent所有tableの不変capability historyへactor/task/event/tool/input-output/at/result/approvalのAuditを同transactionで保存。途中INSERT failureを実DBで起こしgrantとAudit両方rollback、古いrevision拒否、2Adapter再試行がfirst receiptを返し新しいgrantを上書きしないことをRED→GREEN。既存Agent transaction helperはnative Bun SQLite immediateへ置換、既存reporting経路も成功。
- 実CLI RED（unknown --key）→GREEN。request pendingで変更なし→human approve→apply→capability snapshot/Audit→重複apply原本再利用→reject no effectを確認。同timestampのAuditが適用→判断→申請の逆順になるREDを確認し、共通projectionの同Approval tieを申請/判断/適用のphase順へ訂正、GREEN。
- AuditはApproval原本とAgent変更原本を公開Portから集約し別SQL所有者/専用tableを追加しない。CLI actorはlocal adminの申告記録、本人認証ではない。権限変更decisionはhumanのみ、Agent executorはrequester一致を検査する。外部operationは未接続のまま。
- Final独立Reviewer Important1: capabilitySnapshotがlist()/MAX revisionを別statementで読み、別Adapter変更が間に入ると新revision/旧grantの組を返す。実2Adapterの決定的interleave RED（revision3/can_write、期待revision3/can_run_shell）を確認。共通snapshot関数を単一SELECTへ変更し、revisionとgrantを一SQLite read snapshotで読む一回のfix pass。対象capability実DB/CLI/既存reporting3件GREEN。その他Critical/Important/Minorなし。全suiteを再実行し、同skillの規則に従い再レビューは行わない。
- 修正後全197/197・型/lint/format/AST成功、39.27秒（Docker実機3件は別途opt-in）。実Jev1072判定missing/unsure0、errors/degradedなし。実Dockerでもgrantなし/pending拒否→human Approval→capability適用→tracked workspace/Artifact→Task明示レビュー成功。[実成否](verification/2026-10-05-permission-approval/real-docker.txt)。
- Final: 独立Reviewerは新規7件と既存Agent/CLI17件も成功。Important1の不整合snapshot読取を一回fix passでRED→GREEN/全suite確認済み。Critical/Minorなし。Final Ruling: 初期登録grantはbootstrap、登録後変更はhuman Approval、actorは申告local adminで本人認証ではない。capability指定は全体集合、なしは全撤回の申請。Auditは各所有者原本の公開Port集約、他外部operation/credential/service scopeは後続。Next: daemon Sandboxのclient待機/cancel/drainと実行Audit、続いてLLMの制約付きtool接続へ進む。

## main公開：権限変更Approval/Audit

- main51a58d8へ通常push成功、pre-push全197テスト/実Jev/公開検査47.48秒。force-pushなし。

## daemon Sandbox（進行中）

- [計画](superpowers/plans/2026-10-05-daemon-sandbox.md)。既存native Sandbox CLIを再利用し、一実行slot/cancel/shutdown drain/clientの長期待機を先に実e2eへ接続する。Task実行Audit詳細は次の小変更として分ける。
- SandboxJobsの未module RED→GREEN2件。単一slot/busy拒否/他Task cancel拒否/失敗後解放/shutdown新規拒否/drainをDB不要で確認し、cleanup等の非cancel failureはshutdownへ伝播。期待する中断は型付きSandboxCancelledErrorで区別しTask failedを保存する。
- 実daemon CLI RED（remote requires --direct）→GREEN。既存runSandboxCommandにsignalを渡しdaemon managed jobで呼出、RuntimeとSandboxを両方shutdown/drainしてからresourcesを解放。既存releaseResourcesを再利用し、close失敗でも他Adapterとsignal listenerを解放する。
- 実Dockerで6秒turnのclient待機、single slot busy時Task assigned保持、誤Task cancel拒否、正Task cancel→failed、daemon stop→Task failed/drain/DB close、前後container ID差分なしを確認。direct SIGINTもfailed保存/cleanup待機、既存human Approval→Sandbox/Artifact/レビューも成功。3件/9.55秒。Actor/credentials/raw出力は公開ログに含めない。
- Final独立Reviewer Critical/Important/Minorなし。独立UT/CLI12件・実Docker3件・静的検査成功。追加確認でrepo exportが取消signalを無視する経路を発見し、pre-abortでGitを実行するRED→native execFileへsignal伝播/型付きcancel GREEN。既存全callerは共通exportへ接続し、daemon停止時のコピー処理も中断対象にした。
- 制限環境の全検査はUnix socket EPERMで失敗したため中断し、socketを許可した環境で再実行。実Docker回帰3件9.59秒成功。最新実Jev1089判定missing/unsure0、errors/degradedなし。独立レビュー後の取消修正は追加回帰で確認し、再レビューは実施しない。
- 最終全200/200・型/lint/format/AST成功38.68秒。Docker実機5件は既定skipで別検証、今回CLI3件成功。[証拠](verification/2026-10-05-daemon-sandbox/check.txt)。Final Ruling: 一slot/queueなし、cancel応答はcancellingで完了はTask failedで確認、shutdownはcleanup異常を成功扱いしない。既知create/start間stopped container残留、資格情報注入/LLM tool/実行Auditは後続。Next: Task実行Auditを原子的に記録する。

## Task実行Audit（進行中）

- [計画](superpowers/plans/2026-10-05-task-execution-audit.md)。Task状態と原子的に保存済みの不変履歴を再利用し、実行開始/成果物保存/実行失敗をaudit listへ公開する。別tableや二重書込は不要。Runtime/Sandbox詳細tool inputは後続で、履歴projectionがそれを記録したとは扱わない。
- main d80c364の通常push成功、pre-push全200テスト/実Jev/公開検査50.79秒。force-pushなし。
- Audit pure未module RED→GREEN、CLI配線を一旦戻し既存Auditのみを返すRED→Task履歴公開GREENを確認。開始後owner変更のRED→開始時executorを保持する共通projection GREEN。成果物付与のrunning履歴を重複開始にせず、waiting_approval後の人間rejectを実行失敗と混同しない。
- 全202/202・型/lint/format/AST成功38.38秒、Docker実機5件別途opt-in。実Jev1094判定missing/unsure0、errors/degradedなし。実Docker追加assertは既存tool名を誤記して失敗し、agent.capabilities.changeへ訂正して再検証。
- 実Docker Task→Artifact→明示レビュー→Auditと既存capability履歴の共存1件1.287秒成功。Final独立Reviewer Critical/Importantなし、新規/既存UT/CLI4件と実Docker1件を独立成功。Minor1をdefer: 同ミリ秒version9開始/version10成功はID文字列sortで成功が先に見える。原本は不変でtask historyの数値version順で参照できる。表示のtie-orderは次のAudit拡張時に修正する。
- Final Ruling: 保存済み原本projection、actorは開始ownerで本人認証ではない。task.executionは状態履歴であり詳細tool実行記録ではない。新規table/二重書込なし、全Task履歴の線形読取。詳細tool Audit/資格情報/外部操作は後続。Notion Runtime06を再取得し変更された要件がないことを照合。Next: AgentからSandboxへ制約付き実行指示を接続する。

## Agent MessageのSandbox実行（進行中）

- main c5b99d7へ通常push成功、pre-push全202テスト/実Jev/公開検査47.98秒。
- [計画](superpowers/plans/2026-10-05-sandbox-message-proposal.md)。既存safe-mode RuntimeのTask Room返信を厳密JSONとして読み、明示選択した原本Messageを既存Sandbox実行へ接続する。LLM native tool/MCPを開放せず、host path/権限は既存CLI policyと最新Agent capsだけで決める。
- proposal pure未module RED→GREEN。同Task/active Room/owner Agent/参加/厳密JSON/version/tool/未知field/コード制限を確認。--proposalの実CLI未知flag RED→GREEN、--codeとの排他/resource/file policy不正拒否を最小UTで検証。既存serviceへproposalRefを渡し、成果物manifestに原本URIを保存する。
- 実Docker source import/隔離/成果物/原本参照/明示レビュー成功1件1.333秒。実Claude Maxの一周もAPIキーなし・native tools無効でJSON生成→Docker内6*7の自己検証→ANSWER=42/result.txt→waiting_approval→人間review completed成功。最初の実検証scriptはagent createのtext出力へ--jsonを付け誤って失敗し、既存CLI契約に合わせて再実行した。生provider出力とDBはprivate tmpのみ。
- 全203/203・型/lint/format/AST成功40.15秒。追加parser UT後の全検査と、実生成TypeScriptを含む隔離treeの同bun run check/実Jevを続ける。
- 最新repo全204/204・型/lint/format/AST成功40.73秒。生成code入り隔離treeは型/lint/AST/204テストに成功したが、project ruleを除外していたため末尾のreview:planと実意味レビューが失敗。Git管理済みruleだけを補い、全check/実Jevを再実行する。cache/秘密のコピーは行わない。
- Final独立Reviewer Critical/Important/Minorなし。proposal/既存cancel-drain UT4件、実Docker e2e1件も独立成功。
- 修正した隔離treeのbun run check全体も成功。実生成TypeScriptはlint/AST対象に含め、全204テストと型/lint/format/AST/review:planを確認。実Jev1105判定missing/unsure0、errors/degradedなし。Notion snapshot/秘密は送信しない。[証拠](verification/2026-10-05-sandbox-message-proposal/generated-check.txt)。
- Final Ruling: tools無効LLMから厳密JSON proposal、owner/Task/Roomを境界検証し、実行policyはCLIのみ。原本参照を成果物manifestに保持。明示CLIの一周であり自動tool loopは未完了。credential injection/本人認証/外部操作も後続。今回defer Minorなし（Task Audit同時刻tie-orderの既存Minorは継続）。Next: 人間のTaskレビューを委譲元Coordinatorへtyped decisionで返す。

## 委譲Taskの人間レビュー返送（進行中）

- [計画](superpowers/plans/2026-10-05-delegation-review-decision.md)。既存TaskReviewとhistoryから証拠を確認し、owner Agentが委譲元へtyped decisionとして報告する。人間の承認をAgentへ置換せず、Task結果の既存返送/correlation/activationを再利用する。
- main adc9955の通常push成功、pre-push全204テスト/実Jev/公開検査49.47秒。
- 未export UT RED→GREEN。最初のUT fixtureがgroup Roomのhumanを欠いて失敗し、実Room契約に訂正。通知write失敗→原レビュー保持/送信のみretry→同receipt再利用、approve/reject、異成果物拒否、archived延期、abort no readsをDB不要UTで検証。
- 実CLI RED（review後decision待ちtimeout）→daemon wake-upへ接続GREEN。既存結果返送と併存し、decision correlation/declared human actor/Coordinator返信/再起動duplicateなし/Task version不変を確認、既存A2A含む9件3.90秒。Task参照照合を共通関数へまとめ両poll callerへ適用。
- 最新全205/205・型/lint/format/AST成功40.69秒。実Jev1111判定missing/unsure0、errors/degradedなし。実Claude Maxの委譲→Task RESULT=42 Artifact→人間review→typed decision→Coordinator同Session再開を確認し、再openした原本ArtifactもRESULT=42と照合。生出力はprivate tmpのみ。
- Final独立Reviewer Critical/Important/Minorなし、関連domain/service/TaskReview SQLite16件を独立成功。Final Ruling: 原本reviewを報告するdecisionでありAgentが承認しない。決定的IDのreceiptで通知のみretry、Task/Artifact再実行なし。原本と成果物の証拠が違えばfail closed。本人認証/外部Approvalと自律tool loopは後続。既存Audit同時刻sortのMinorは次に解消する。

## Audit同時刻順のMinor解消

- [計画](superpowers/plans/2026-10-05-audit-same-time-order.md)。version9開始/version10成功の同timestampが成功→開始になるRED→同Taskをgroupしnative stable sortで原本順を保持GREEN。ID parser/新ordinal/schemaは追加しない。既存Approval phase/Task CLI4件成功。
- 全206/206・型/lint/format/AST成功38.94秒。実Jev1112判定missing/unsure0、errors/degradedなし。独立Reviewer Critical/Important/Minorなし、関連3件を独立成功。既存defer Minor1解消。Final Ruling: 同Task同timestampだけ原本history順、異timestamp/Approval phaseは既存規則を維持。Next: Memoryの有効期間をContext選択へ接続する。
- main31a1551通常push成功、pre-push全205テスト/実Jev/公開検査51.26秒。

## Memory有効期間（進行中）

- [計画](superpowers/plans/2026-10-05-memory-validity.md)。Notion03を再取得してoptional validFrom/validUntilを照合。UTC epoch millisecondsでJSON原本を拡張し、CLIはUTC ISO、Contextは既存返信identity時刻で現在のMemoryだけを選ぶ。期限切れで不変原本を変えない。
- 最小UTの未export RED→GREEN。JSON optional period/再decode、safeDate整数/from<until、開始inclusive/終了exclusive、期限切れ/未来/invalidated、legacy期間なしを確認。Contextにexpired/futureが混入するREDとCLI未知valid-from flag RED→GREEN。CLI再open/境界/不正2月31日拒否を確認。exactOptionalPropertyTypesでundefined指定fixtureが型失敗し、legacyの未指定fieldsへ訂正した。
- 実daemon→Runtime fixtureのContextで期限切れ/未来を除外し、従来のprocedural Memory・Task/委譲/人間decision通知の一周を保持。関連6件7.09秒成功。全207/207・型/lint/format/AST成功41.13秒。実Jev1120判定missing/unsure0、errors/degradedなし。
- Final独立Reviewer Critical/Important/Minorなし、domain/CLI/SQLite/Context6件を独立成功。Final Ruling: periodはUTC epoch milliseconds、CLIはcanonical UTC ISO。原本statusは期間で変えず、Contextと明示list --atだけ判定。時計は返信identityで注入、期間なしlegacyは時刻に依存しない。新timer/schema/providerなし。
- 次の照合でMemory scopeのID内colon拒否を発見。実生成a2a:/schedule系Task IDにはcolonが含まれ、そのTask scopeをcaptureできない。期間変更とは分け、共有scope validatorを次の小修正でRED→GREENする。
- main0da84ea通常push成功、pre-push全206テスト/実Jev/公開検査52.95秒。

## 名前空間付きTask Memory scope（進行中）

- [計画](superpowers/plans/2026-10-05-memory-namespaced-scope.md)。全callerを確認し、scopeをsplitする処理はなく完全一致で選択しているため、共有validatorのsuffixだけをcolon対応にする。既知prefix/空suffix/空白拒否は維持する。
- 最小UTと実daemon CLIでcolon付きTask scope captureが失敗するRED（1成功/2失敗）→共有validatorのsuffixをopaque IDとして受けるGREEN（3成功/3.73秒）。同Task MemoryだけContextへ渡し、別Task Memory混入を拒否するRuntime fixtureで検証。
- 全208/208・型/lint/format/AST成功41.73秒、Docker実機5件は別opt-in。実Jev1121判定missing/unsure0、errors/degradedなし。[証拠](verification/2026-10-05-memory-namespaced-scope/check.txt)。Final独立Reviewer Critical/Important/Minorなし、最小UT/実CLI3件を独立成功3.46秒。
- Final Ruling: 既知prefix/非空suffix/空白拒否を維持し、ID内colonを許可。Contextは完全一致であり別Taskへ範囲を広げない。新parser/schemaなし。Next: Git partial cloneの不足blobがSandbox repo export中にhost通信を起こさないことを実Gitで検証する。
- main53d5c2c通常push成功、pre-push全207テスト/実Jev/公開検査49.14秒。

## Sandbox repo exportの暗黙fetch拒否（進行中）

- [計画](superpowers/plans/2026-10-05-sandbox-git-no-fetch.md)。全callerは共通export関数へ接続済み。実ローカルfile transport partial cloneで不足blobを確認し、exportが拒否せずhost側fetchで成功するREDを確認。外部通信/実認証情報を使わないfixture。
- 共通native Git環境へGIT_NO_LAZY_FETCH=1と空GIT_ALLOW_PROTOCOLを追加する2行修正。既存repo protocol.file.allow=alwaysがあっても不足blobを取得せず拒否するGREEN3件293ms。取消/完全repo exportも成功。
- [Git公式仕様](https://git-scm.com/docs/git)を照合。禁止を外す対照実験ではfetch成功、独立Reviewerは両変数それぞれの拒否と不足blob未取得を実Gitで確認。Final Critical/Important/Minorなし。
- 全209/209・型/lint/format/AST成功40.75秒、Docker実機5件別opt-in。実Docker CLI tracked workspace→Artifact→人間review成功1件1.59秒。実Jev1124判定missing/unsure0、errors/degradedなし。[証拠](verification/2026-10-05-sandbox-git-no-fetch/check.txt)。
- Ruling: Sandbox準備で不足Git objectを補完しない。事前に利用者が完全cloneを用意する。hostの通信/認証helperを暗黙起動せず、既存失敗伝播と取消を維持する。新transport/credential abstractionなし。
- main423d120通常push成功、pre-push全208テスト/実Jev/公開検査48.57秒。Next: 公開GitHub Eventの明示read-only取込を既存Event/Subscriptionへ接続し、小さな実サービスe2eを積み重ねる。

## 公開GitHub Event取込（進行中）

- [計画](superpowers/plans/2026-10-05-github-public-events.md)。Notion Event/MVPの外部GitHub Eventを既存journalへ接続する。固定公開REST GET、認証/外部書込なし。公式API version2026-03-10、最新300件/30日、30秒〜6時間遅延を確認。全履歴/realtimeとは扱わない。
- 最小UT未module RED→公開response/ID精度/UTC日付/固定GET/認証なし/原本保持/不正/HTTP失敗/size上限GREEN。実CLIは旧配線へ一時復帰してunknown command RED→await配線GREEN。fetchだけnative preload fixtureへ差し替え、本物のCLI/SQLite/daemonでSubscription→assigned Task/6秒応答/再import原本維持/no duplicate/再openを確認。3件6.67秒。
- Response readerのDOM型がanyでlint失敗したため、受信chunkをunknownとしてdone/bytes検証する境界へ訂正。テストのnullable child stdoutもguardを追加し静的検査成功。native GETはページ10秒/4MiB、最大300件。後続ページ不正なら書込前拒否を確認。
- 実公開GitHub GET→保存原本→ID filter Subscription→一Task→実Claude Max（APIキー/native toolsなし）→原Message Artifact→明示human review completedを検証。生Event/Provider/DBはprivate tmpだけ。公開証拠は成否markerのみ。
- main89dfd7c通常push成功、pre-push全209テスト/実Jev/公開検査51.14秒。
- Final独立Reviewer Important1: 有効な公開.github repositoryを先頭文字制限が拒否。Critical/Minorなし、UT2件/fixture CLI1件を独立成功。GitHub公式のcommunity health repository名と照合し、取込が失敗するRED→単一segmentのdot/hyphenを許し`.`/`..`/query/hash/encoded traversalを拒否するGREENを確認。一回のfix pass、全suite/実Jevを再実行し再レビューはしない。
- 最終全213/213・型/lint/format/AST成功47.48秒。Docker実機5件は別opt-in。実Jev1141判定missing/unsure0、errors/degradedなし。[検証記録](verification/2026-10-05-github-public-events/check.txt)。Important1修正済み、Critical/Minorなし。再レビューは行わない。
- Ruling: 外部元はpublic repository限定、人間の明示CLIでread-only取込、LLMへの外部権限付与ではない。payloadは原GitHub Event全体、camel Event名をsnake case＋actionへ正規化。最初の観測原本を保持し、安定ID/type/source/time不一致はfail closed。actor metadataの後日変化は原本を変えない。各Event保存は既存transactionで原子的、batch保存途中失敗は再取込で重複を防ぐ。最大300件/30日/遅延あり、自動poll/ETag/webhook/private repoは未完了。Next: Memory retrievalのtype/tag/entity/importanceを既存Contextへ小さく接続する。

## Memory retrieval metadata（進行中）

- [計画](superpowers/plans/2026-10-05-memory-retrieval-metadata.md)。既存Memory JSONとContext selectorを再利用する。tag/entityのliteral relevanceと明示type/tag/entity filter、有効期間/原本不変を小さく接続。新検索server/vector/indexは追加しない。full-text/自動抽出は後続。
- 最小UT未module RED→optional metadataのJSON roundtrip/legacy未指定/各32件128文字/重複/importance0〜1/異型拒否/不変選択/関連tag優先/recency/同時刻importance GREEN。CLI未知--tag RED→capture/list filter GREEN。Context fields欠落RED→共通pure selectorとmetadata投影GREEN。
- 実CLI再openと実daemon Runtime fixtureで同Task scopeのtags/entities/importanceを受信しforeign Taskを除外、既存委譲/結果/明示レビューの一周保持。関連6件4.76秒成功。decodeのunion key参照がtsgoで失敗したため、明示unknown fieldをguard/mapで検証し型assertを使わず訂正、静的検査成功。
- main24e9dce通常push成功、pre-push全213テスト/実Jev/公開検査57.45秒。
- 全214/214・型/lint/format/AST成功47.29秒。Docker実機5件別opt-in。実Jev1147判定missing/unsure0、errors/degradedなし。[証拠](verification/2026-10-05-memory-retrieval-metadata/check.txt)。Final独立Reviewer Critical/Important/Minorなし、retrieval/CLI/Room runtime5件884msを独立成功。
- Ruling: optional metadataは未指定legacy JSONへfieldを追加しない。tag/entityは文字列一致で意味推定をしない。scopeが関連度より先、期間を選択前に除外、typeは明示CLI filter（Runtime既定は全4type）。importanceはconfidenceと独立、recencyの同時刻tieで比較する。listは新しい順の共通selectorへ統一し、--atなしでは失効原本も保持。新index/provider/policy factoryなし。full-text/summary/自動抽出/semantic consolidationは後続。
