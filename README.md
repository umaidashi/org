# org — AI Company Kernel

Agent・Task・Room・Memory・Event・Runtimeを組み合わせ、AIの組織と実務をローカルで動かすTypeScriptプロジェクトです。現在はAgent registry、ローカルTaskProvider、Room・Message、Event・Subscription、EventからTaskを作る常駐daemonとローカルsocketが動きます。Sessionの永続化とCodex/Claude Runtimeへの接続も実装しています。Messageを根拠とするTyped Memoryとscope付きContextを実装しています。公開GitHub Eventの明示取込も接続しています。LinearやNotionの外部Adapterは後続です。[要件と進捗](docs/requirements.md)を参照してください。

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

## RoomのActivation対象

```sh
bun run start room create Company --type group --human founder --agent CHIEF_ID --agent CTO_ID --coordinator CHIEF_ID --json
bun run start room send ROOM_ID --human founder --content 'CTOに質問' --mention CTO_ID --json
bun run start room targets ROOM_ID --message MESSAGE_ID --json
```

`targets`は起動対象Agent IDを選びます。`room activate ROOM_ID --message MESSAGE_ID`はdaemonの設定済みRuntimeでそのAgentを起動し、履歴・Memoryを含むcontextから返信を保存します。Sessionを再利用し、保存済み返信があれば新しいturnを実行しません。実Claude Maxでもcoordinatorだけの起動、同じSessionでの継続、返信の再利用を確認済みです。自動pollingはdaemon起動時に`--wake-up --runtime-config PATH`を指定すると有効になります。`daemon wakeups --json`でintent/結果を参照できます。失敗・中断を自動で繰返さず、必要なら`room activate`で再試行します。通常の人間発言はcoordinatorだけ、明示mentionやA2A宛先はそのAgentを選びます。複数Agent Roomではcoordinatorを指定し、単一Agentの既存RoomではそのAgentを使います。mention_onlyは明示宛先のみ、allは人間発言で全参加Agentを選びます。普通のAgent返信で再発火せず、sender自身も選びません。

mentionは参加Agentだけを指定でき、`--mention`は複数回使えます。archive後は選択できません。rule_basedは明示宛先の選択に対応し、独自ルールの定義・評価は未実装です。

## Agent間のA2A

```sh
bun run start a2a send ROOM_ID --from CHIEF_ID --to CTO_ID --type request --payload '{"objective":"Research"}' --task TASK_ID --json
bun run start a2a send ROOM_ID --from CTO_ID --to CHIEF_ID --type result --payload '{"evidence":["complete"]}' --reply-to REQUEST_ID --json
bun run start a2a list ROOM_ID --json
bun run start a2a get ROOM_ID MESSAGE_ID --json
```

種類はdelegate/request/result/question/decision/blocker/cancelです。宛先は同じRoomのAgentに限定し、Taskを指定した場合は存在を検証します。Task RoomではTask参照を継承します。返信は元Messageの宛先を逆転し、Taskとcorrelationを引き継ぎます。矛盾する参照は保存前に拒否します。

原本はRoomの不変Messageです。通常のMessageと共存し、archive後も読めます。この段階では送信に伴うAgent起動・Task委譲は行いません。Agent識別子はローカル操作側が指定する値で、本人認証ではありません。

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

Agent購読は登録済みIDを確認します。Workflow購読はhost allowlistの外部識別子を指定し、`--workflow-config`を持つdaemonが一度だけ起動します。`matches`は照合結果の取得です。

## EventからTaskへの処理

```sh
bun run start daemon --once --json
bun run start daemon deliveries --json
```

単発workerが現在有効な購読を既存Eventにも照合し、Agent購読ごとに割当済みExecutionTaskを1件作ります。Taskの成果物や状態は通常のTask CLIで操作できます。配信記録の`delivered`はTask作成・割当の成功であり、Agent実行の完了ではありません。

同じEvent/Subscriptionの再処理ではTaskと履歴を増やしません。Task保存後に配信記録が失敗しても次回実行で復旧し、進行中Taskを再割当しません。Workflow購読は理由付き`deferred`として表示します。Event由来TaskのRuntime起動は設定済みdaemonの`--wake-up`で有効にします。

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

既定socketはDBの絶対パスに`.sock`を付けたものです（既定DBでは`~/.local/share/org/org.db.sock`）。起動側とclient側に同じ`--socket PATH`を指定すれば変更できます。`daemon deliveries --socket PATH`はdaemon経由で取得し、socket指定なしの`deliveries`と`--once`はDBを直接操作する管理コマンドです。通常clientの接続は5秒でtimeoutします。RuntimeとSandbox実行は設定された実行期限まで待ちます。同じディレクトリの別DBも異なる既定socketを使います。

TCP listenerは開かず、Unix socketを0600で作成します。同socketの2重起動や既存file/symlinkの置換を拒否します。stop・SIGTERM・SIGINTで終了し、自分が作成したsocket/lockを解放します。`--wake-up`はRoomの未処理Messageを既存履歴も含めて選択し、起動intentを保存してから実行します。停止時は進行中turnを中止してdrainし、未実行Messageは次の起動へ残します。

SIGKILL等で残ったsocket/lockは自動削除しません。稼働中プロセスがないことを確認してから手動で整理してください。

Agent/Task/Room/A2A/Event/Memory CLIはdaemon clientとして動作し、`--direct`で管理用の直接操作も可能です。SessionのRuntime process管理とtimeout/cancelは実装済みです。同じPOSIX process groupの子孫を終了させます。daemon自身のSIGKILL時も監督pipeの切断で同groupを停止します。別groupへ離脱する子孫の隔離は後続です。固定間隔schedulerとDocker Sandboxのdaemon/直接実行CLIを実装しています。Task実行の自動retryは未実装です。WorkflowとTUIの実装範囲は後述します。

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

Sessionはdaemon経由で実行します。使用するRuntimeだけを設定してください。起動時の `--runtime-config PATH` に次のJSONを渡します。executable/cwdは絶対パス、envはdaemonの環境から渡す変数名だけを指定します。設定ファイルに秘密値は書きません。Claude Maxにはログイン済みのClaude Codeを使い、OS識別情報も明示して渡します。

```json
{
  "codex": {"executable":"/absolute/path/to/codex","cwd":"/absolute/path/to/workspace","env":["PATH","HOME"],"timeoutMs":120000,"maxOutputBytes":1048576},
  "claude": {"executable":"/absolute/path/to/claude","cwd":"/absolute/path/to/workspace","env":["PATH","HOME","USER","LOGNAME"],"timeoutMs":120000,"maxOutputBytes":1048576}
}
```

```sh
bun run start daemon --runtime-config ./runtime.local.json
bun run start session start --agent AGENT_ID --room ROOM_ID --message '作業内容' --json
bun run start session resume SESSION_ID --message '続けて' --json
bun run start session get SESSION_ID --json
bun run start session history SESSION_ID --json
bun run start session stop SESSION_ID --json
```

AgentはRoomの参加者である必要があります。Sessionの開始・送信はRuntimeの完了まで待機し、別のterminalからstopできます。待機時間はRuntime設定で制限します。daemon停止時は実行中のturnを中止して終了を待ち、再起動時に残ったrunning状態はfailedへ復旧します。provider Session IDを維持してresumeします。Codexはread-only/approval never、ClaudeはMaxのログインを使えるsafe-modeで起動し、tools・custom hooks・MCP・slash commandsを無効にします。管理policyはClaude Codeの優先規則に従います。自動e2eは実subprocessのfixtureを使用します。実Codexでも開始→同じprovider IDで再開→停止を別途確認済みです。実Claude MaxでもAPIキーなしで開始→同じprovider IDで再開→Task実行→承認待ち→停止を確認済みです。

RoomのMessageに応答を残す場合は、保存済みのMessage IDを指定します。

```sh
bun run start room send ROOM_ID --human founder --content '質問' --json
bun run start session reply SESSION_ID --room-message MESSAGE_ID --json
bun run start room messages ROOM_ID --json
```

入力Messageまでの履歴を最大30件・64KiBに限定して渡し、省略数もContextに含めます。同じSession/Messageの保存済み返信を再利用します。provider実行と返信保存の間でprocessが落ちた場合のexactly-onceは未実装です。

## Typed Memory

原Messageまたは不変TaskReviewを根拠にMemoryを明示的に登録します。--source-review org://tasks/TASK/reviews/REVIEW（IDをURI encode）でレビューを参照し、従来の--room/--messageとは排他です。保存前に公開Task/Review readerで原本一致を検査します。scopeのID部分はcolonを含むa2a:/schedule系Task IDも受け、Contextは完全一致で選択します。scope・type・confidenceを指定し、本文と根拠は変更しません。更新は新しいMemoryで置き換え、無効化も理由付きで追記します。

```sh
bun run start memory capture --type semantic --scope room:ROOM_ID --room ROOM_ID --message MESSAGE_ID --confidence 0.8 --content '決定した内容' --json
bun run start memory capture --type semantic --scope room:ROOM_ID --room ROOM_ID --message MESSAGE_ID --confidence 0.9 --content '新しい決定' --supersedes MEMORY_ID --json
bun run start memory list --scope room:ROOM_ID --json
bun run start memory invalidate MEMORY_ID --reason '根拠が失効した' --json
```

`session reply`は現在のRoom・Agent・Taskとcompany/globalのactive Memoryを選択し、scopeと新しさで最大20件に絞って渡します。Context全体の64KiB上限に合わせて省略数を記録します。`memory capture --valid-from ISO --valid-until ISO`で有効期間を指定できます。ミリ秒付きUTC ISOを受け、保存値はUTC epoch millisecondsです。開始は含み終了は含まない期間で、未来・期限切れはContextから除外します。`memory list --at ISO`でも同じ選択を確認でき、指定なしlist/getは期限切れの原本も保持します。captureにrepeatable --tag/--entityと--importance（0〜1）を指定でき、各32件/128文字/重複拒否です。list --type/--tag/--entityで明示filterし、新しい順に表示します。同scopeのContextはsource Messageにtag/entityが文字列一致するMemoryを優先し、recency→importance→IDで選択します。memory search QUERY --scope SCOPE --type TYPE --tag TAG --entity ENTITY --at ISOで本文を検索できます。SQLite FTS5 trigramのliteral phrase検索で3〜1024 Unicode文字、現在active/期間内のみを返します。原本とindex追記は同transaction、旧DBは初回にindexを作ります。Room Contextはsource本文のliteral FTSを既存のscope/metadata/recency/importance優先順位後のtie-breakerに使います。自然言語の意味検索、一般自動抽出、意味的な重複・矛盾判定は後続です。

## ExecutionTaskの実行

assignedのExecutionTaskに、そのownerのidle Sessionと対応するTask Roomの新しいMessageを渡します。

```sh
bun run start task run TASK_ID --session SESSION_ID --room-message MESSAGE_ID --json
bun run start task artifacts TASK_ID --json
bun run start task history TASK_ID --json
```

runningを先に保存し、Runtime返信をRoomに残します。結果Artifactの`org://rooms/.../messages/...`参照・Task履歴・waiting_approvalを原子的に保存します。結果は人間の確認待ちです。daemon起動時は中断されたrunning ExecutionTaskをfailedへ復旧し、履歴と承認待ちの結果を保持します。成果物の承認・却下は次の`task review`で記録します。`--wake-up`付きdaemonはEvent由来を含むassigned ExecutionTaskを自動実行します。完了済み依存を確認し、Task RoomとSessionを用意してMemory contextを渡します。WorkItemは実行せず、結果を自動承認しません。再起動後も承認済みTaskを再実行しません。外部操作の専用Approval APIと自動再試行は後続です。

同じDBのcontinuous daemonは一台だけ起動できます。socketを変えてもSQLiteのPID/token leaseで二重所有を拒否します。DB/親のsymlinkは実パスへ正規化し、新DBは0600で作成します。終了した所有PIDのleaseは起動時に取得し直し、解放時は自分のtokenだけを削除します。PID reuseは生存扱いで拒否します。continuousモードでin-memory DBは使用できません。

### Task結果の確認

```sh
org task get TASK_ID --json
org task review TASK_ID --decision approve --actor founder --reason "成果物を確認した" --expected-version VERSION --json
org task reviews TASK_ID --json
```

却下は`--decision reject`を指定します。古いversion、未完了の依存Taskがある承認、成果物がないTaskは拒否します。判断記録と状態・履歴は一緒に保存され、失敗時はrollbackします。actorはローカル操作側が指定する記録値です。本人認証や外部操作のPermission/Approvalは後続です。

### Agentの組織関係

```sh
org agent create cto --role CTO --runtime codex --reports-to CHIEF_ID
org agent report CTO_ID --to CHIEF_ID --json
org agent report CTO_ID --clear --json
org agent reporting-history CTO_ID --json
org agent list --json
```

上司がいるAgentのJSONには`reportsTo`が含まれます。存在しない上司や循環は拒否し、変更と履歴を一緒に保存します。同じ関係の再設定は履歴を増やしません。上司関係は組織の記録であり、実行権限や自動委譲は別の境界です。

Agentのdelegate権限は作成時に`--capability can_delegate`で明示します。省略したAgentはtyped A2Aのdelegateを送信・自動起動できません。通常のRoom metadata経由でも起動前に検証します。既知の他のcan_*値は保存できますが、対応する実行境界の権限制約は後続です。ローカル管理者のCLI操作をAgent本人として認証する機能ではありません。作成後の権限変更はhuman Approvalとrevision CASで適用します（下記Approval参照）。

`--wake-up`付きdaemonでtyped A2Aの`delegate`を送ると、宛先AgentにExecutionTaskを一度だけ割り当てます。JSON payloadをTask指示に含め、`--task`参照は親Taskとして保持します。元Roomの通常返信turnは発行せず、Task RoomでMemoryを含めて実行し、成果物を承認待ちへ保存します。`room activate`による手動delegateはTask割当まで行います。結果はTask/Artifactで参照できます。--wake-up workerが委譲元へtyped result（成果物なし失敗はblocker）を返し、既存activationでCoordinatorへ通知します。返送失敗でTask結果を失わず、次tick/再起動では返送だけを再試行します。人間がtask reviewした後は、レビュー原本と前後Task履歴を照合したtyped decisionを委譲元へ返します。owner Agentは記録済みの人間判断を報告し、承認を代行しません。

固定間隔のEventは`schedule create`で登録します。`--start-at`はミリ秒付きUTC ISO、`--every-ms`は正の整数です。既存のEvent Subscriptionで宛先Agentを指定し、`--wake-up`付きdaemonがTaskを実行します。

```sh
bun run start -- schedule create daily --every-ms 86400000 --start-at 2026-10-06T00:00:00.000Z --event schedule.daily_0900
bun run start -- schedule list --json
bun run start -- schedule disable SCHEDULE_ID
```

同じslotのEventを再発行せず、停止中に逃した時刻は最新一件にまとめます。時計が巻き戻ると保存済み最大slotに追いつくまで発行を抑止します。cron・専用timezone/calendar設定と全missed runのcatch-upは後続です。JSONはUTC epoch millisecondsの`startAtMs`を保持します。


Docker Sandboxでは、assigned ExecutionTaskのownerに`can_run_shell`が必要です。`--repo`には`can_read`、`--writable`には`can_write`も必要です。Docker engineと固定公式Bun imageを使用し、networkなし・rootfs readonly・非root・resource上限付きtmpfsで実行します。

```sh
bun run start -- --direct sandbox run TASK_ID --code 'console.log(7)' --json
bun run start -- --direct sandbox run TASK_ID --repo . --writable --code "await Bun.write('result.txt','done')" --file result.txt --json
bun run start -- --direct task artifacts TASK_ID --json
bun run start -- --direct sandbox artifact org://artifacts/HASH
ORG_DOCKER_TEST=1 bun --no-env-file test tests/sandbox-docker-real.test.ts tests/sandbox-cli.test.ts
```

repoはHEADのregular fileだけをコピーし、未commit変更・未追跡ファイル・Git履歴・`.env`等の資格情報ファイルを持ち込みません。元repoをマウントしません。stdoutまたはstdoutと選択ファイルのbase64を含むJSONを、privateな`DB_PATH.artifacts`へ内容hashで保存します。保存blobは1MiB以内、選択ファイルは16件以内です。Taskは`waiting_approval`へ進み、既存`task review`で明示承認します。daemon経由でも実行でき、`sandbox cancel TASK_ID`で取消できます。実行は一slotで、停止時は取消・cleanup・Task failed保存を待ってDBを閉じます。直接実行のSIGINT/SIGTERMも同じ取消を行います。Task Roomのowner Agentが生成した厳密JSON Messageは`--proposal MESSAGE_ID`で明示選択して実行できます。明示host policyによるRuntime返信→一回のSandbox実行は下記で有効化できます。多段tool loop・credential注入は後続です。親SIGKILL後の実行中containerは内部deadlineで有限終了します。作成完了からstart前の異常死は停止containerを残し得ます。


登録後のcapability変更はApprovalを経由します。`agent capabilities`でrevisionを確認し、`approval request`へ変更後のcapability全体を指定します。`--capability`は繰返し指定でき、指定なしは全撤回の申請です。申請だけでは権限は変わりません。

```sh
bun run start -- agent capabilities AGENT_ID --json
bun run start -- approval request AGENT_ID --key sandbox-grants --actor founder --expected-revision 0 --capability can_run_shell --capability can_write
bun run start -- approval get APPROVAL_ID --json
bun run start -- approval decide APPROVAL_ID --actor founder --decision approve --reason 'Checked scope'
bun run start -- approval apply APPROVAL_ID --actor founder
bun run start -- agent capability-history AGENT_ID --json
bun run start -- audit list --json
```

権限変更の判断は人間操作に限定します。古いrevisionは適用を拒否し、同じApprovalの再適用は最初の記録を返します。権限と不変Auditを同じトランザクションで保存します。actorはローカル管理操作の申告値であり、本人認証は後続です。外部メール・deploy・支出等の操作はまだ接続していません。

`audit list`はApprovalに加え、Taskの不変履歴から実行開始・成功・失敗を公開します。actorは開始時のowner、入出力は`task history`で読めるversion snapshot参照です。人間レビューの却下は実行失敗に変換しません。詳細tool引数・本人認証はこの履歴projectionの対象外です。

Agentへの生成指示は`{"version":1,"tool":"sandbox","code":"TypeScript"}`だけを返す形にします。Task Roomで`room activate`して生成したMessageを、`sandbox run TASK_ID --proposal MESSAGE_ID --writable --file result.txt`へ渡します。repo・書込・選択ファイル・実行上限はCLI側で指定し、Messageから権限を設定しません。Artifactは`proposalRef`で原本を参照します。

## 公開GitHub Eventの取込

```sh
bun run start -- event import-github OWNER/REPO --json
bun run start -- event subscribe github.pull_request.opened --subscriber-type agent --subscriber AGENT_ID
```

公開RESTを認証なしGETで読み、GitHub repo ID/Event IDを保存IDへ変換します。PullRequestEvent/action openedはgithub.pull_request.opened、PushEventはgithub.pushになります。payloadはGitHub Event全体で、filterはidやrepoなどの原fieldを指定します。再取込は最初の原本を保持し、SubscriptionとdaemonでTaskを一度だけ作ります。

固定API host・redirect拒否・ページ10秒/4MiB・最大300件で、Agentが外部操作をする機能ではありません。取込途中の保存失敗は再実行で原本を再利用します。[公式API](https://docs.github.com/en/rest/activity/events)は最新300件/30日、30秒〜6時間遅延です。自動poll・webhook・private repoの認証は後続です。

### 承認済みTaskのMemory

```sh
org agent create reader --role Reader --runtime claude --memory-policy reviewed-tasks
```

--wake-up付きdaemonは、policyを明示した元ownerのapproved TaskReviewを前後履歴と照合し、Task scopeのepisodic Memoryへ一度だけ投影します。本文は当時のtitle/objectiveとレビュー原本のJSONで、confidence=1は記録が存在する確度です。結果内容の真実性や本人認証を保証する値ではありません。再起動でも明示invalidated/supersededを保持します。未指定/noneは自動投影せず、rejectは対象外です。一般LLM抽出・semantic dedup/conflict・夜間統合は後続です。


## Runtime提案の自動Sandbox実行

`daemon --runtime-config runtime.local.json --sandbox-config sandbox.local.json --wake-up`で、`can_run_shell`を持つTask ownerの返信をstrict Sandbox JSONとして実行します。shell権限のないAgentは通常のMessage成果物を返します。既定は無効です。

```json
{"writable": true, "files": ["result.txt"], "timeoutMs": 30000, "maxOutputBytes": 65536}
```

host policyのJSONに上記を保存します。任意の`repo`はhostが読み取るGit repositoryです。repoには`can_read`、書込には`can_write`が必要です。未知fieldを拒否し、Agentはcodeだけを提案します。実行直前に最新Task版・owner・権限・Roomを照合し、成功したstdout/選択ファイルを原Message参照付きArtifactへ保存します。失敗はfailed、人間の明示reviewまでcompletedへ進みません。`sandbox cancel TASK_ID`とdaemon stopは既存の取消・cleanupを使います。

```sh
ORG_DOCKER_TEST=1 bun --no-env-file test tests/runtime-sandbox-cli.test.ts
```


## n8n WorkflowRuntimeの参照

WorkflowRuntimeはAgentRuntimeと独立し、n8nのproduction Webhookでinvoke、公開Execution APIでstatus/cancelします。host allowlist外のWorkflowや不一致の実行IDを拒否し、invokeを自動再試行しません。CLIは不変Eventのreceiptを保存し、同じkeyの二重invokeを拒否します。

[成功用参照Workflow](docs/reference/workflows/org-kernel-check.json)と[停止用参照Workflow](docs/reference/workflows/org-kernel-wait.json)はローカル検証用です。WebhookがexecutionIdを返し、後者は60秒待機するためstopを確認できます。公式n8n2.41.6で検証しています。

```sh
ORG_N8N_TEST_CONFIG=/private/path/config.json bun --no-env-file test tests/workflow-n8n-real.test.ts
```

実機test設定はbaseUrl、apiKey、workflows（id/path配列）を持つprivateな一時JSONです。リポジトリには保存しません。通常の全testではこの実機testをskipします。


## Workflow CLIとreceipt

`workflow.local.json`はhostと許可Workflowを指定します。キー値は設定へ書かず、`apiKeyEnv`が指定する環境変数をhost側で読みます。daemonを使う場合は起動時にその変数を渡します。

```json
{"baseUrl":"https://n8n.example","apiKeyEnv":"N8N_API_KEY","workflows":[{"id":"WORKFLOW_ID","path":"org-kernel-check"}]}
```

```sh
bun run start workflow run WORKFLOW_ID --key check-001 --input '{"issue":123}' --config ./workflow.local.json --json
bun run start workflow status REQUEST_ID --config ./workflow.local.json --json
bun run start workflow cancel REQUEST_ID --config ./workflow.local.json --json
bun run start workflow list --json
bun run start workflow history REQUEST_ID --json
```

runの戻り値`payload.requestId`をstatus/cancel/historyへ渡します。claimは外部呼出しより先に保存し、通信失敗でも同じkeyを自動再送しません。不明な結果はunconfirmed Eventとして残ります。原入力はhashだけを記録し、観測は追記します。status/cancelは保存済みreceiptと同host/Workflowを照合します。これは手動local admin操作です。Taskからの委譲は以下のAgent scopeで制限します。

## Event購読からWorkflowを起動する

```sh
bun run start --direct event subscribe manual.requested --subscriber-type workflow --subscriber WORKFLOW_ID --json
bun run start daemon --workflow-config ./workflow.local.json
```

host設定のAPIキー環境変数はdaemon起動時に渡します。Agent Runtime設定や`--wake-up`は不要です。入力は元EventのID/type/source/payload/createdAtで、保存するWorkflow receiptは本文のhashだけです。Deliveryの`workflowRequestId`は不変requestを指し、`taskId`はnullです。先にclaimした配送を再起動時に再送せず、started receiptから配送記録だけを回復します。結果不明やhost不一致はdeferredのままです。Workflow自身のreceipt Eventはこの自動購読から除外します。

設定なしで既にdeferredとなった配送を、自動で復活させることはありません。必要なら判断のうえ新しい購読またはEventを作ります。TaskからのWorkflow委譲は別途Agent scopeを設定します。

## SecretStore

WorkflowのAPIキーは`SecretStore` Port経由でhost側だけが解決します。初期Environment Adapterは、hostが指定したactor/secret参照/env名のgrantだけを読み、未知actor・未知参照はenv読取前に拒否します。欠損・過大値・lookup失敗のエラーは固定文言で、秘密や元の例外を出力しません。秘密値を表示するCLIはありません。

現在のWorkflow configは`host:workflow`の`n8n-api-key`参照を解決します。これは信頼済みhost内部の識別子で、Agent認証ではありません。Agent別Workflow scopeと最新Task owner/capability照合を実装しています。Workflow操作Approvalは後述の経路で実装しています。Sandboxへの限定credential注入は後続です。Environment参照自体は暗号化保管機能を提供しません。

## Taskから読み取りWorkflowへ委譲する

Workflow設定にAgent別の許可と専用キー参照を追加します。

```json
{"baseUrl":"https://n8n.example","apiKeyEnv":"N8N_HOST_KEY","workflows":[{"id":"WORKFLOW_ID","path":"org-kernel-check"}],"agentScopes":[{"agentId":"AGENT_ID","workflowIds":["WORKFLOW_ID"],"apiKeyEnv":"N8N_AGENT_KEY","effect":"read_only"}]}
```

`--wake-up --runtime-config ./runtime.local.json --workflow-config ./workflow.local.json`でdaemonを起動します。Agentにはcan_read、can_delegate、can_access_network、can_contact_externalが必要です。Runtimeは許可IDを含む指示に対して`{"version":1,"tool":"workflow","workflowId":"WORKFLOW_ID","input":{}}`を返します。hostは最新Task owner/version、Room、capabilityを照合し、Agent固有キーで一度だけ呼び出します。キーはRuntimeへ渡しません。Sandboxとの同時設定は曖昧なため拒否します。

成功した実行IDとWorkflowを照合してTask成果物を保存します。`task artifacts TASK_ID --json`でIDを取得し、`task artifact-content TASK_ID --artifact ARTIFACT_ID --json`で内容とintegrityを確認できます。人間のTask review後、設定済みMemory policyに従ってMemoryへ記録します。実Claude Maxとローカル公式n8nで一周と再起動後no replayを検証済みです。

read_onlyは信頼済みhostが宣言する契約で、n8n各nodeの副作用を自動判定する機能ではありません。Agent Taskからの書込みWorkflowは、後述の操作Approval待機・再開を使用します。Workflowの観測窓は既定30秒で、停止時にはHTTPを中断します。不明な結果はclaimを保持して再送しません。検証済みstarted後の継続観測は後述のobserve-workflowを使用します。業務出力とAgent RPC認証は未完了です。

## Workflow操作の承認記録

書込み・不可逆操作の承認対象を、host・Workflow・入力SHA-256・一回の実行request IDへ固定できます。

```sh
bun run start approval request-workflow WORKFLOW_ID --key operation-001 --actor founder --host https://n8n.example --input-digest INPUT_SHA256 --request-id INVOCATION_ID --effect write --json
bun run start approval decide APPROVAL_ID --actor founder --decision approve --reason '対象と入力を確認した' --json
bun run start approval get APPROVAL_ID --json
bun run start audit list --json
```

`--effect`はwriteまたはirreversibleです。hostは資格情報・query・fragmentを含まない正規URL、入力digestは小文字64桁です。要求と判断は不変保存し、同keyの別操作や判断の変更を拒否します。入力本文・APIキーは保存しません。Workflow承認を`approval apply`へ渡してAgent権限を変更することもできません。

手動CLIのnative Workflow実行は以下の承認照合へ接続しています。Agent Taskのwrite/irreversible scopeは後述のTask-bound Approvalで制約します。人間actorはローカル管理者の申告値です。

## 承認済みWorkflowを実行する

host設定のWorkflowへ`"effect":"write"`または`"effect":"irreversible"`を指定すると、run前に人間の操作Approvalが必須になります。effect省略は既存のread_only契約です。宣言はhost管理者の責任で、node副作用を自動検査するものではありません。

```sh
bun run start workflow request-approval WORKFLOW_ID --key operation-001 --input '{}' --config ./workflow.local.json --actor founder --json
bun run start approval decide APPROVAL_ID --actor founder --decision approve --reason '対象と入力を確認した' --json
bun run start workflow run WORKFLOW_ID --key operation-001 --input '{}' --config ./workflow.local.json --approval APPROVAL_ID --actor founder --json
```

request-approvalはrunと同じ引数から入力digestと一回の実行IDを生成します。host・Workflow・入力・key・effect・要求actorが違えばrunを拒否します。承認済みでもclaim後の再実行は拒否し、通信失敗はunconfirmedとして残します。原入力・キーはreceiptへ保存せず、承認IDと実行IDで追跡します。Approval要求自体が外部Workflowを起動することはありません。

write/irreversible Workflowは自動Event配送でdeferredとなり、Agentのread_only scopeには登録できません。Agent Taskの承認待ち・再開と長時間Workflowの明示観測は後述します。actor認証は後続です。

## Workflowの実行Audit

`audit list --json`は不変Workflow receiptから、呼出しactor、Task/Event、Approval、入力hash参照、実行ID参照と観測結果を表示します。人間承認の要求・判断と実行を同じApproval IDで追跡でき、同時刻でも要求→判断→claim→開始→観測の順で表示します。

通信中断などの結果不明は`unconfirmed`で、成功/失敗とは断定しません。status/cancelのnative観測者は`{"kind":"system","id":"host:workflow"}`です。Agent Taskの呼出しはAgent、承認済み手動実行は要求したhuman actorを記録します。host識別子は本人認証を意味しません。actor情報を持たない過去receiptには人物を補完せず、`workflow history`で原本を確認します。raw入力や資格情報はAuditへ出しません。

## Roomのrule_based起動

Room作成時に、参加Agentと人間Messageのmetadata条件を指定します。

```sh
bun run start room create 'Code requests' --type direct --human founder --agent AGENT_ID --activation-policy rule_based --activation-rules '[{"agentId":"AGENT_ID","metadata":{"topic":"code","urgent":true}}]' --json
bun run start room send ROOM_ID --human founder --content '確認して' --metadata '{"topic":"code","urgent":true}' --json
bun run start room targets ROOM_ID --message MESSAGE_ID --json
```

`daemon --wake-up --runtime-config ./runtime.local.json`で条件に一致するMessageを自動起動します。条件はscalarの完全一致で、`1`と`"1"`、nullと欠落は区別します。複数一致はAgentごとに一回だけ起動し、明示mention/A2Aを優先します。Agentの通常返信から暗黙起動しません。

ルールは1〜32件、各条件は1〜16個。参加者外・空条件・非scalar・過大文字列・reserved mentions/a2a・未知fieldを拒否します。ルールはrule_based Roomだけに保存でき、任意コードや正規表現を実行しません。ルールなしの旧rule_based Roomは、暗黙起動を拒否する既存動作を保ちます。

## 壊れたSessionを再構築する

provider Sessionが利用不能になった場合は、failed Sessionのversionを確認して明示的に作り直します。

```sh
bun run start session get SESSION_ID --json
bun run start session rebuild SESSION_ID --expected-version VERSION --json
```

元Sessionの停止と、provider IDを持たない新しいKernel Sessionの保存を一transactionで行います。元のfailed履歴を保持し、新Sessionの`rebuiltFrom`に元ID/versionを記録します。古いversion・非failed・archive済みRoomは拒否し、保存失敗時は元の状態へrollbackします。

rebuild自体はproviderを起動しません。次の新規Room Messageをactivateすると、最新SessionがRoom履歴と現在有効なscope内Memoryからcontextを作り直します。semantic Room Memoryをsummaryとして保持する場合も、このcontextに含まれます。元Message・Memoryは変更しません。Room summaryの自動生成と一般の自律retryは未完了です。Taskや結果不明の外部操作を自動で再実行する機能ではありません。

## macOS Keychainへ交換する

Workflow設定では`apiKeyEnv`の代わりに、暗号化保管されたitemの明示参照を指定できます。hostと各Agentでどちらか一つを選びます。

```json
{"baseUrl":"https://n8n.example","apiKeyKeychain":{"path":"/absolute/path/org.keychain-db","service":"org-n8n","account":"host"},"workflows":[{"id":"WORKFLOW_ID","path":"org-kernel-check"}],"agentScopes":[{"agentId":"AGENT_ID","workflowIds":["WORKFLOW_ID"],"apiKeyKeychain":{"path":"/absolute/path/org.keychain-db","service":"org-n8n","account":"AGENT_ID"},"effect":"read_only"}]}
```

AdapterはmacOSの`security find-generic-password`で指定path/service/accountだけを読みます。default search listへ暗黙fallbackせず、未知actor/referenceをOS lookup前に拒否します。OS処理は5秒・出力上限付きで、資格情報envを継承しません。元の認証errorや値を出さず、読み取れない場合は固定エラーです。キーを表示・登録するCLIはありません。

専用の一時Keychainと実CLI/HTTPによる再現テストは`ORG_KEYCHAIN_TEST=1 bun --no-env-file test tests/keychain-real.test.ts`です。自作itemだけを作成・削除し、既存itemを変更しません。通常全検査ではこの実機テストはskipします。

grantは信頼済みhost内部の許可です。Keychainへの交換はAgent RPC認証やAgentプロセスの完全なfilesystem/credential隔離を意味しません。Vault、Sandboxへの限定credential注入は未完了です。

## Auditログを監視する

```sh
bun run start logs --json
bun run start logs --task TASK_ID --limit 20 --json
bun run start logs --event EVENT_ID --json
```

`logs`は`audit list`と同じ不変記録を時系列で読みます。Task/Event指定は完全一致のAND条件です。絞り込み後の最新100件を表示し、`--limit`は1〜1000件を指定できます。通常はdaemonへ接続し、DBを直接読む管理操作には`--direct`を指定します。本文・秘密情報を追加表示する機能ではなく、継続followやTUIは未完了です。

## Coordinatorの委譲proposal採用

```sh
bun run start a2a adopt ROOM_ID --message COORDINATOR_MESSAGE_ID --json
```

Coordinatorの原本Messageにある厳密JSON `{"version":1,"tool":"a2a","type":"delegate","to":"SPECIALIST_ID","payload":{"objective":"調査内容"}}`を、local adminが明示採用します。送信者・Room・Task・相関IDはhostが固定し、直属の参加専門AgentとCoordinatorのread/write/delegate権限を確認します。原本参照を持つtyped delegateを一度だけ保存し、同じ原本の再採用は同じ結果を返します。`--wake-up` daemonが既存の委譲Task実行・結果通知・人間レビューへ接続します。本人認証・一般tool loopは未完了です。

```sh
bun run start daemon --wake-up --runtime-config /absolute/runtime.json --delegation-room ROOM_ID
```

`--delegation-room`を指定したactive Coordinator Roomだけ、人間へのCoordinator返信を自動採用します（繰返し可、最大32）。直属参加専門Agentの候補をContextへ渡し、strict `tool=a2a`返信は既存の権限検査を通します。通常本文はそのまま表示し、結果・decisionへの返信から再委譲しません。返信保存後・採用前の中断はfailed wakeupとして保持するため、`room activate`または`a2a adopt`で明示回復します。自動retryはしません。

## daemonの監視TUI

```sh
bun run start tui
bun run start --socket /absolute/path/org.sock tui
```

実端末からAgent/Room/Task/Eventの一覧を1秒間隔で読みます。`r`で更新、`q`またはCtrl-Cで終了します。日本語の端末幅とresizeを扱い、終了・接続失敗時にraw modeと画面を復元します。各一覧は最大10行を取得し、画面高さを4種類に配分して代表行を表示します（5行未満では全見出しを表示できません）。表示はID/name/title/role/type/statusとAgentごとのSession状態件数です。複数Roomのrunning/idle/failed/stoppedを別々に表示し、SessionがないAgentはsessions=0です。Room名はtitleを表示します。各一覧は独立した読取のため、原子的snapshotではありません。終了は進行中読取のtimeout（最大約5秒）まで待つ場合があります。daemon接続専用で`--direct`には対応しません。指定Roomの会話入力は次のコマンドで利用できます。Task操作は未完了です。

## Roomで対話する

```sh
bun run start tui --room ROOM_ID --human founder
```

active Roomに参加するhuman IDを指定して、日本語の一行入力をRoom Messageとして保存します。直近20件を表示し、`/refresh`または空行で再読込、`/quit`・Ctrl-C・EOFで終了します。失敗した送信を自動再試行しません。表示本文は各2048文字で制御文字を除去します。Human IDはローカルの宣言的identityで、本人認証ではありません。Agentの自動返信にはdaemonの既存opt-in wake-up設定が必要です。自動refresh/streamingやTask操作は未完了です。

## AgentのWorkflow提案を承認対象に固定する

```sh
bun run start approval request-task-workflow TASK_ID --room ROOM_ID --message MESSAGE_ID --expected-version VERSION --host https://n8n.example --effect write --json
bun run start approval decide APPROVAL_ID --actor founder --decision approve --reason '原本提案を確認' --json
```

assigned ExecutionTaskの最新version、owner Agent、active Task Roomの原本提案Messageを確認し、Task/version/Message参照とhost/Workflow/input hash/request ID/effectを不変Approvalへ固定します。read/delegate/network/contact/writeのcapabilityが必要です。要求は冪等で、同Taskの異なる提案は競合します。この段階では外部操作やcredential lookupを行わず、Task状態も変更しません。手動Workflow runへの流用はできません。daemonのhost/Agent allowlistと待機・再開executorへ接続しています（後述）。

## Agent Workflowの承認待ちと再開

hostの`workflows`とAgentの`agentScopes`で同じ`effect: "write"`または`"irreversible"`を明示すると、Runtime提案を操作Approvalへ固定してTaskが`waiting_approval`に止まります。この時点ではAgent credentialを読まず、外部Workflowを呼びません。outputArtifactがないため結果レビューもできません。

```sh
bun run start approval list --json
bun run start approval decide APPROVAL_ID --actor founder --decision approve --reason '対象と入力を確認' --json
bun run start task get TASK_ID --json
bun run start task resume-workflow TASK_ID --approval APPROVAL_ID --expected-version VERSION --json
```

再開はdaemon専用です。承認原本のTask/version/owner/Message/input hashと、現在のTask snapshot・capability・dependency・host/Agent scopeを再照合し、Agent専用キーを解決後にも再確認します。先行claimの後に一度だけ実行し、verified successのArtifactを結果レビュー待ちへ保存します。pending/rejected/不一致・古いversion・重複再開は呼出しません。operation待機とApprovalは再起動後も保持されます。通信失敗・timeout・停止の不確定結果はreceiptへ記録し、自動再実行しません。

操作Approvalと実行結果レビューは別の判断です。write effectは信頼済みhost宣言で、Workflow nodeの副作用を検査しません。本人認証、完全process隔離は未完了です。Approval保存とTask待機更新は別所有者のため原子的ではなく、Task更新が失敗すると要求だけが残る場合があります。


## 長いWorkflowの継続観測

Workflow host設定の`taskWaitTimeoutMs`は50〜30000ms（既定30000ms）です。検証済みstarted receiptがあり、その後のstatusが通信失敗・timeout等で不確定になるとTaskは`blocked`へ移ります。invoke自体が不明でstartedがない場合や、確定した実行失敗は`failed`です。

```sh
bun run start task get TASK_ID --json
bun run start task observe-workflow TASK_ID --expected-version VERSION --json
```

観測再開はdaemon専用で、保存済みexecutionのstatusだけを読み、invokeしません。現在のTask/version/owner/capability/dependency、原本Messageとreceipt、host/Agent scopeを照合し、write/irreversibleは元のhuman Approvalも再確認します。成功を検証するとArtifactを保存して結果レビュー待ちへ戻り、まだ不明ならblockedを保持します。daemon再起動でも自動再送しません。自動poll・一般retry・Artifact保存失敗からの復旧は未完了です。


## Room原本からMemoryを抽出する

参加Agentの原本Messageを、次のJSON形式で保存します。既存Sessionの`reply --room-message`で候補生成を依頼できます。

```json
{"version":1,"tool":"memory","candidates":[{"type":"procedural","content":"変更前に最小テストを実行する","confidence":1,"sourceMessageIds":["SOURCE_MESSAGE_ID"]}]}
```

```sh
bun run start memory extract --room ROOM_ID --message PROPOSAL_MESSAGE_ID --json
```

採用はlocal adminの明示操作です。active Room参加Agentのcan_read/can_write、同Roomの提案より前の原本を先行確認し、scopeは`room:ROOM_ID`へ固定します。最大10候補、候補本文16KiB、提案全体64KiB。既存4typeとconfidenceを検証し、根拠と提案Messageの両方をsourceRefsへ残します。

完全一致type/contentはnon-activeも含めて再利用し、無効化・置換された内容を抽出から復活させません。候補の`supersedes`は同Room/typeのactive Memoryだけを明示置換します。全候補を検証後に個別保存するため、保存障害時に部分採用が残る場合があります。同proposalを再実行すると安定IDと原本で照合します。原本Messageは変更しません。confidenceはモデルの申告値で、事実の正しさや本人認証を保証しません。意味による重複・競合判定、夜間consolidation、他scopeへの自動採用は未完了です。


## Contextの取得境界

Room返信では、差替え可能なMemoryRetrieverと純粋なContextBuilderを使います。SQLite Adapterはscope・有効期間を再照合し、source本文が3〜1024 Unicode文字のときliteral phraseで全文検索します。scope、tags/entity、新しさ、重要度が同順位の場合に全文一致を優先し、最後はID順です。短文・巨大本文・NULを含む本文は全文検索を行いません。検索障害はRuntime起動前にエラーとなります。

ContextBuilderは入力Messageまでの最大30件、Memory最大20件、UTF-8最大64KiBと省略件数を維持します。別Room履歴と巨大なsourceを拒否します。意味検索・vector rerank・自動summary生成は未完了です。


## 完全同値Memoryの整理

```sh
bun run start memory consolidate --scope room:ROOM_ID --key REVIEW_KEY --at 2026-10-06T00:00:00.000Z --json
```

active Roomの有効なMemoryだけを対象に、type/content/confidence/有効期間/tags/entities/importanceが完全に同値のものを整理します。最も古いcreatedAt/IDをkeeperとし、他を理由付きinvalidateします。元Message・Memory・sourceRefsは変更しません。各根拠はinactiveになった原記録にも残り、keeperへ自動mergeしません。

失効と不変receiptは同じtransactionで保存し、開始後に公開Room Portでactiveを再確認して、対象snapshotの変更やstorage障害を全rollbackします。同じkey/scopeは元receiptを返して再整理せず、時刻も更新しません。新しく整理する場合は新しいkeyを選びます。これはlocal adminの明示操作です。夜間処理は下記のhost opt-in、意味重複/競合推論は後続です。異なるDBや外部Roomとの分散transactionは保証しません。


## 指定Roomの夜間Memory整理

```sh
bun run start daemon --memory-consolidation-room ROOM_ID --poll-interval 1000
bun run start memory consolidations --scope room:ROOM_ID --json
```

Room指定は繰り返し可能（最大32）、既定では無効です。Runtime設定やLLMは不要です。最初のpollで現在UTC日の一回を処理し、翌日以降も最初のpollで一回。停止中の日は現在日にまとめ、同日poll・再起動・時計巻戻りで再整理しません。archived Roomは対象外です。同日追加のMemoryは次のUTC日に整理します。

不変receiptはkey/scope/実処理時刻/keeper・失効IDを保存します。nightly-memory:のkeyはdaemon専用で、手動consolidateには指定できません。全文やAPIキーはreceiptへ追加保存しません。DB障害・不正履歴はdaemonのpoll errorとして報告します。対象は同値metadataの整理で、意味重複・競合推論・自動summary生成・全scopeの自動処理は未完了です。

## 両AgentのClaude Max実機検証

```sh
ORG_CLAUDE_DELEGATION_TEST=1 bun --no-env-file test tests/coordinator-claude-real.test.ts
```

ログイン済みClaude CLIをPATHから使い、native toolsを無効にしたCoordinatorと直属専門Agentで、自動委譲→算術成果物→人間レビュー→根拠付きMemory→同Coordinator Session再開→再起動後の重複なしを確認します。一時DB/daemonは終了時に削除します。通常の全検査はこの実機テストをskipします。Issueからコード実装・Draft PRまでの実務e2eは未完了です。

## Notion knowledgeの明示読取

```sh
bun --env-file=.env src/cli.ts --direct knowledge notion PAGE_ID --json
# daemon経由の場合はdaemon起動時にNOTION_API_KEYを設定する
bun --env-file=.env src/cli.ts daemon
bun run start knowledge notion PAGE_ID --json
```

`NOTION_API_KEY`には対象ページのread権限を持つIntegration tokenを使います。値はGit・ログ・Runtimeへ渡しません。Notionのnative Markdown APIから一ページをGETし、canonical UUID・content hashを返します。切詰め/取得不能blockを含む応答は拒否し、10秒通信timeout・256KiB応答上限・redirect拒否を適用します。ページや添付URLへの書込・自動retryは行いません。native Markdownの対応範囲を超える意味的完全性、編集version snapshotは後続です。アプリのNotion接続とは別認証です。

Notion文書をRoomの不変原本へ取り込む場合は `knowledge notion PAGE_ID --room ROOM_ID --human HUMAN_ID --json`。active Roomの参加humanに限定し、本文にも出典URL/hashを保持します。各明示取込は新Messageで、自動重複排除やAgent起動は行いません。

## 既存Linear Issueの読取

`bun --env-file=.env src/cli.ts --direct task linear-get ORG-1 --json` は既存Issueを読み取ります。`LINEAR_API_KEY`はPersonal API keyを設定し、daemon経由はdaemon起動時に設定します。UUIDまたはTEAM番号を指定でき、固定GraphQL queryのみで新Issue・mutation・local WorkItem同期は行いません。HTTP fixtureのCLI検証と実Linear APIの認証成功は区別します。

`task import-linear ORG-1 --json` は既存Issueの初回snapshotをlocal WorkItemへ保存します。同じ内容の再取込は現在のlocal進捗を返し、外部本文変更はconflictを返します。内部作業は `task create TITLE --objective OBJECTIVE --kind execution_task --parent WORK_ITEM_ID` で分離できます。双方向同期は未実装です。
