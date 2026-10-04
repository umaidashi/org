# org — AI Company Kernel

Agent・Task・Room・Memory・Event・Runtimeを組み合わせ、AIの組織と実務をローカルで動かすTypeScriptプロジェクトです。現在はAgent registry、ローカルTaskProvider、Room・Message、Event・Subscription、EventからTaskを作る常駐daemonとローカルsocketが動きます。Sessionの永続化とCodex/Claude Runtimeへの接続も実装しています。Messageを根拠とするTyped Memoryとscope付きContextを実装しています。外部連携などは未実装です。[要件と進捗](docs/requirements.md)を参照してください。

## セットアップ

Bun 1.3.4以上を使用します。実行・依存管理・テスト・hooksはすべてBunです。

```sh
bun install --frozen-lockfile
bun run hooks:install
bun run check
```

`bun.lock`で依存を固定します。Node/npmのインストールは不要です。型検査はtsgo、lintはRust製Oxlint、formatはRust製Oxfmt、AST検査はRust製ast-grepを使います。Oxlintの型依存ルールはtsgolintも使用します。

## 最初に動かす

起動用のterminalでdaemonを立ち上げます。

```sh
bun run start daemon
```

別のterminalでAgentを登録し、一覧を確認します。

```sh
bun run start agent create chief --role 'Chief of Staff' --runtime codex
bun run start agent list --json
bun run start daemon stop --json
```

Agent・Task・Room・Eventの通常コマンドはUnix socket経由でdaemonへ接続します。daemonが停止している場合は接続エラーになります。DBを直接操作する管理用途では、明示的に`--direct`を指定します。

```sh
bun run start --direct agent list --json
```

以下の通常コマンド例はdaemonが起動している状態で実行してください。表示された`AGENT_ID`・`TASK_ID`等を後続コマンドに渡します。

## Agent

```sh
bun run start agent create chief --role 'Chief of Staff' --runtime codex
bun run start agent list
bun run start agent list --json
```

AgentはUUID・name・role・runtime・UTC作成時刻をSQLiteへ永続化します。既存のPython版DBも読めます。重複名は拒否し、登録済みAgentを置き換えません。JSONの作成時刻は初期契約の`created_at`を維持しています。runtimeは識別情報として保存し、この操作ではプロセスを起動しません。

## Task

```sh
bun run start task create '認証機能' --objective '認証APIとテストを完成させる' --json
bun run start task assign TASK_ID --owner AGENT_ID --json
bun run start task update TASK_ID --status running --json
bun run start task get TASK_ID --json
bun run start task history TASK_ID --json
bun run start task list --kind work_item --status running --json
bun run start task create 'schema調査' --objective '変更点を決める' --kind execution_task --parent TASK_ID --json
bun run start task comment TASK_ID --actor human --body '確認しました' --json
bun run start task artifact TASK_ID --artifact RESULT_ID --uri file:///tmp/result.txt --direction output --json
```

WorkItemと内部ExecutionTaskをkindで区別します。ownerは登録済みAgentのID。親・依存は既存TaskのIDで指定し、循環を拒否します。依存が完了するまでrunning/completedへ進めません。状態と不変履歴は同時保存し、途中失敗はrollbackします。

`--dependency`と`--label`は複数指定できます。誤った参照は`task update TASK_ID --clear-dependencies --clear-parent --clear-labels`で解除できます。コメント一覧は`task comments`、成果物一覧は`task artifacts`です。成果物はURIの参照のみで、ファイルアクセスや回収はまだ行いません。[Taskの詳細](docs/tasks.md)。

DBの既定パスは`~/.local/share/org/org.db`。daemonの起動と`--direct`の管理操作では`--db PATH`で使用するDBを指定します。通常clientの`--db`は接続先socketの既定パスを選び、接続後はdaemonが起動時に指定したDBを使用します。引数エラーは終了2、接続・保存・業務判断の失敗は終了1です。

## Room・Message

```sh
bun run start room create '設計会議' --type direct --human founder --agent AGENT_ID --json
bun run start room list --json
bun run start room send ROOM_ID --human founder --content '設計を確認してください' --json
bun run start room send ROOM_ID --agent AGENT_ID --content '確認済み' --reply-to MESSAGE_ID --json
bun run start room messages ROOM_ID --json
bun run start room archive ROOM_ID --json
```

`--agent`は登録済みAgentのID、`--human`は呼び出し元が指定するHuman識別子です。同じAgentとのRoomを複数作れます。`--type`はdirect/group/agent/taskで、Task Roomには`--task TASK_ID`を指定します。参加者は繰り返し指定でき、種類ごとの構成を検証します。`--activation-policy`の既定値はcoordinatorです。

MessageはRoom別の追記履歴です。senderは参加者、返信先は同じRoomのMessageに限定します。`--metadata`はJSON objectを指定できます。archive後は投稿できず、既存履歴は読めます。この操作ではAgentの起動、Activationの実行、Humanの認証は行いません。

## Event・Subscription

```sh
bun run start event publish github.pr.opened --source manual --payload '{"repo":"example","number":42}' --json
bun run start event subscribe 'github.*.opened' --subscriber-type agent --subscriber AGENT_ID --filter '{"repo":"example"}' --json
bun run start event matches EVENT_ID --json
bun run start event get EVENT_ID --json
bun run start event list --json
bun run start event subscriptions --json
bun run start event disable SUBSCRIPTION_ID --json
bun run start event enable SUBSCRIPTION_ID --json
```

publishは受信者を指定せず不変のEvent原本を保存します。patternの`*`はdot区切りの1区間、末尾`**`は0以上の区間に一致します。filterはpayloadの指定keyのJSON値との完全一致です。Subscriptionを変更してもEvent原本は変わりません。

Agent購読は登録済みIDを確認します。Workflow購読は外部識別子を保存するだけで、存在確認・実行はまだ行いません。`matches`は照合結果の取得です。

## EventからTaskへの処理

```sh
bun run start daemon --once --json
bun run start daemon deliveries --json
```

単発workerが現在有効な購読を既存Eventにも照合し、Agent購読ごとに割当済みExecutionTaskを1件作ります。Taskの成果物や状態は通常のTask CLIで操作できます。配信記録の`delivered`はTask作成・割当の成功であり、Agent実行の完了ではありません。

同じEvent/Subscriptionの再処理ではTaskと履歴を増やしません。Task保存後に配信記録が失敗しても次回実行で復旧し、進行中Taskを再割当しません。Workflow購読は理由付き`deferred`として表示します。Event由来TaskのRuntime起動は後続の実装です。

## 常駐daemon

```sh
# 起動用terminal：foregroundで動作
bun run start daemon

# 別terminal：同じDBのdaemonへ接続
bun run start daemon status --json
bun run start daemon dispatch --json
bun run start daemon stop --json
```

既定では1秒ごとにEventをpollingします。`--poll-interval MS`で10〜60000msの範囲を指定できます。poll失敗はstatusの`degraded`とerrorで表示し、次回pollで再試行します。成功すると`running`へ戻ります。

既定socketはDBの絶対パスに`.sock`を付けたものです（既定DBでは`~/.local/share/org/org.db.sock`）。起動側とclient側に同じ`--socket PATH`を指定すれば変更できます。`daemon deliveries --socket PATH`はdaemon経由で取得し、socket指定なしの`deliveries`と`--once`はDBを直接操作する管理コマンドです。clientの接続は5秒でtimeoutします。同じディレクトリの別DBも異なる既定socketを使います。

TCP listenerは開かず、Unix socketを0600で作成します。同socketの2重起動や既存file/symlinkの置換を拒否します。stop・SIGTERM・SIGINTで終了し、自分が作成したsocket/lockを解放します。SIGKILL等で残ったsocket/lockは自動削除しません。稼働中プロセスがないことを確認してから手動で整理してください。

Agent/Task/Room/Event/Memory CLIはdaemon clientとして動作し、`--direct`で管理用の直接操作も可能です。SessionのRuntime process管理とtimeout/cancelは実装済みです。同じPOSIX process groupの子孫を終了させます。daemon自身のSIGKILLと別groupへ離脱した子孫の監督は後続です。scheduler、Task実行のretry、Workflow・Sandbox等のCLIとTUIは未実装です。

## 検証とレビュー

```sh
bun run test:unit     # DB・子プロセスなしの最小単位UT
bun --no-env-file test ./tests/task-sqlite.test.ts
bun run test:e2e      # 独立したCLIプロセスによる操作検証
bun run check        # tsgo・Oxlint・Oxfmt・AST・全テスト・jev dry-run
bun run review:semantic
```

DIを必須にし、業務判断は純粋な関数、serviceは必要なPortだけを引数に取ります。IDと時刻も呼び出し元から渡します。UTではDBやプロセスの起動が不要です。永続化・rollbackは実SQLiteで、ユーザー操作はe2eで検証します。

検査はすべてローカルです。GitHub Actionsは使いません。

| タイミング | 実行内容 |
|---|---|
| Agentの実装中 | 対象テストのRED→GREEN、最小単位UT |
| 検証単位の完了時 | 全検査・実jevレビュー・独立レビュー |
| pre-commit | ステージ済みtreeの公開情報確認と静的検査 |
| pre-push | 送信対象refから到達する全履歴の情報確認、送信対象tipの全テスト・実jevレビュー |

意味レビューには`TYPESAFE_API_KEY`をGit除外済みの`.env`へ設定します。コード・テスト・指針が外部APIへ送られます。秘密情報・DB・Notion原文は送信しません。通常の検証コマンドは`.env`の自動読み込みを無効にし、意味レビューと既知キーの漏えい確認だけが明示的に読みます。warningは候補として判定し、通信失敗・判定漏れ・対象ゼロは拒否します。詳細は[レビュー方法](docs/quality-review.md)。

## 配布用ビルド

```sh
bun run build
# daemonを起動済みの場合
bun dist/cli.js agent list --json
./dist/cli.js agent list --json

# daemonを起動せず、DBを直接確認する場合
bun dist/cli.js --direct agent list --json
```

Bun向けにCLIをbundleします。リポジトリとパッケージは公開前提です。資格情報・個人情報・非公開の固有名をコードやログに含めないでください。公開情報ゲートは既知キーと基本的な秘密ファイルを確認する補助検査であり、すべての情報漏えいを証明できるものではありません。

[コーディング指針](docs/coding-guidelines.md) · [リファレンス実装](docs/reference-implementation.md) · [作業ログ](docs/work-log.md)

## SessionとRuntime

Sessionはdaemon経由で実行します。起動時の `--runtime-config PATH` に次のJSONを渡します。executable/cwdは絶対パス、envはdaemonの環境から渡す変数名だけを指定します。設定ファイルに秘密値は書きません。

```json
{"codex":{"executable":"/absolute/path/to/codex","cwd":"/absolute/path/to/workspace","env":["PATH","HOME"],"timeoutMs":120000,"maxOutputBytes":1048576}}
```

```sh
bun run start daemon --runtime-config ./runtime.local.json
bun run start session start --agent AGENT_ID --room ROOM_ID --message '作業内容' --json
bun run start session resume SESSION_ID --message '続けて' --json
bun run start session get SESSION_ID --json
bun run start session history SESSION_ID --json
bun run start session stop SESSION_ID --json
```

AgentはRoomの参加者である必要があります。Sessionの開始・送信はRuntimeの完了まで待機し、別のterminalからstopできます。待機時間はRuntime設定で制限します。daemon停止時は実行中のturnを中止して終了を待ち、再起動時に残ったrunning状態はfailedへ復旧します。provider Session IDを維持してresumeします。Codexはread-only/approval never、Claudeはbareかつtools無効で起動します。自動e2eは実subprocessのfixtureを使用します。実Codexでも開始→同じprovider IDで再開→停止を別途確認済みです。実Claudeは未確認です。

RoomのMessageに応答を残す場合は、保存済みのMessage IDを指定します。

```sh
bun run start room send ROOM_ID --human founder --content '質問' --json
bun run start session reply SESSION_ID --room-message MESSAGE_ID --json
bun run start room messages ROOM_ID --json
```

入力Messageまでの履歴を最大30件・64KiBに限定して渡し、省略数もContextに含めます。同じSession/Messageの保存済み返信を再利用します。provider実行と返信保存の間でprocessが落ちた場合のexactly-onceは未実装です。

## Typed Memory

原Messageを根拠にMemoryを明示的に登録します。scope・type・confidenceを指定し、本文と根拠は変更しません。更新は新しいMemoryで置き換え、無効化も理由付きで追記します。

```sh
bun run start memory capture --type semantic --scope room:ROOM_ID --room ROOM_ID --message MESSAGE_ID --confidence 0.8 --content '決定した内容' --json
bun run start memory capture --type semantic --scope room:ROOM_ID --room ROOM_ID --message MESSAGE_ID --confidence 0.9 --content '新しい決定' --supersedes MEMORY_ID --json
bun run start memory list --scope room:ROOM_ID --json
bun run start memory invalidate MEMORY_ID --reason '根拠が失効した' --json
```

`session reply`は現在のRoom・Agent・Taskとcompany/globalのactive Memoryを選択し、scopeと新しさで最大20件に絞って渡します。Context全体の64KiB上限に合わせて省略数を記録します。自動抽出、意味的な重複・矛盾判定、期間/tag/entity/full-text retrievalは後続です。

## ExecutionTaskの実行

assignedのExecutionTaskに、そのownerのidle Sessionと対応するTask Roomの新しいMessageを渡します。

```sh
bun run start task run TASK_ID --session SESSION_ID --room-message MESSAGE_ID --json
bun run start task artifacts TASK_ID --json
bun run start task history TASK_ID --json
```

runningを先に保存し、Runtime返信をRoomに残します。結果Artifactの`org://rooms/.../messages/...`参照・Task履歴・waiting_approvalを原子的に保存します。結果は人間の確認待ちです。daemon起動時は中断されたrunning ExecutionTaskをfailedへ復旧し、履歴と承認待ちの結果を保持します。専用Approval API、自動再試行、Event由来Taskの自動実行は後続です。

同じDBのcontinuous daemonは一台だけ起動できます。socketを変えてもSQLiteのPID/token leaseで二重所有を拒否します。DB/親のsymlinkは実パスへ正規化し、新DBは0600で作成します。終了した所有PIDのleaseは起動時に取得し直し、解放時は自分のtokenだけを削除します。PID reuseは生存扱いで拒否します。continuousモードでin-memory DBは使用できません。
