# Notionとの要件照合

## 目的と完了条件

ユーザーの継続目標：Notionを確認しながら、実装すべきことがなくなるところまで進める。言語はTypeScript。e2e・各種テストを設定し、TDDで動作とデグレ防止を確認する。

全体の目標をAgent一覧だけに縮小しない。以下の要件ごとに実際のコード・テスト・実行結果を照合し、証拠がない項目は未完了とする。参照したNotionの11ページを `docs/notion/` に保存した。変更時はNotionを再取得する。

| 領域 | 必要な動作・不変条件 | 現在の証拠・状況 |
|---|---|---|
| 言語 | TypeScript、型検査、unit/integration/e2e、再現可能なセットアップ | Bunへ統一。tsgo・Oxlint/Oxfmt・AST・unit/integration/e2eで257成功/8skipの265テストをローカル検証（外部・OS実機8件は別途opt-in実行）。Agent/TaskのDIによる最小UT11件35msにRoom/Event/Daemon UTを追加。新規依存インストールでも全検査を検証 |
| Agent | 永続Identity、role、reportsTo、runtime、capabilities、permissions、memoryPolicy | TSのID・name・role・runtime・createdAt・optional reportsToを実装。legacy schema/root JSON互換・循環/不存在拒否・同時変更時再検証・不変履歴/rollback・実CLIを検証。optional capabilitiesの既知値/重複/型/コピーとSQLite legacy互換・CLI明示指定を実装。delegateの送信/activation前can_delegateを検証。memoryPolicyはnone/reviewed-tasksの明示opt-inを登録/SQLite/CLI/不変TaskReview由来Memoryで検証。permissionsの外部scopeと他Capability境界は未完了 |
| 組織 | Chief of Staffから専門Agentへの委譲 | reportsToによるChief→専門Agentの関係と変更履歴を保存。can_delegate付きtyped A2A delegateを宛先ownerのExecutionTaskへ冪等生成し、opt-in daemonで自動実行。自律的な委譲指示の生成は未完了 |
| A2A | delegate/request/result/question/decision/blocker/cancel、correlation、Task参照 | version付きRoom Message・CLI send/get/listを実装。宛先/Task/返信/correlationを検証。実daemon request→resultと再openを確認。can_delegate付きdelegate→parent/source参照の冪等ExecutionTask→自動実行を実daemonと実Claude Maxで検証。Task結果のtyped result/blocker返送とCoordinator通知・snapshot参照検証/返送失敗再試行/再起動重複なしを実daemon/実Maxで確認。人間TaskReviewを原本/前後history/成果物照合してtyped decisionで返送、通知retry/再起動no duplicateを実daemon、同Session Coordinator再開を実Claude Maxで検証。自律委譲指示は後続 |
| Room | Direct/Group/Agent/Task、同じAgentの複数Room、参加者・archive | Local SQLiteとCLIを実装。種類別参加者構成・Agent/Task参照・archiveを検証。Human認証は未完了 |
| Message | Roomごとの永続履歴、replyTo・sender・metadata | 追記専用SQLite履歴とCLI。別プロセス読み直し・同Room返信・sender参加・metadata・archive後拒否・原本UPDATE/DELETE/REPLACE拒否・INSERT失敗後の復旧を検証 |
| Activation | coordinator既定、直接mention、mention_only/all/rule_based | optional coordinatorId、参加Agent mention検証、coordinator/mention_only/all/typed A2A宛先のpure選択とCLI targetsを実装。通常Agent返信の連鎖/自己起動を抑止。実daemonと旧JSON再openを確認。daemon専用manual activateでSession準備/再利用→Runtime/context返信、返信重複抑止・failureを実subprocessで検証。実Claude Maxでもcoordinatorだけ/Session継続/返信再利用を確認。opt-in daemon pollingでRoom自動wake-up・不変intent/結果・busy延期・中断復旧/no replay・cancel/drainを実processで検証し、実Claude Maxの自動投稿→返信/Session継続も確認。rule_basedはRoom固定metadata scalar完全一致・参加Agent限定・人間暗黙起動/mention優先を実装。条件保存/再openと実daemon Runtime返信/restart no replayを検証 |
| Session | Room/Identityとの分離、start/send/resume/stop、履歴から再構築 | 独立Session ID/provider ID・pure状態遷移・version競合拒否・SQLite状態/不変履歴の原子保存を実装。rollback/REPLACE拒否/別プロセス読込を検証。serviceによるRuntime turn結線とstop先保存/late応答保護、restart recovery関数を実装。両Adapter+SQLite+実Bun fixtureで開始/再開/停止を検証。CLI/daemon起動配線・起動時recovery・設定済みdriver・停止時drainを実装。実Codexの開始/再開/停止を確認。実Claude MaxもAPIキーなしで開始/同provider IDで再開/Task結果/停止を検証。failed SessionをexpectedVersion指定で明示再構築し、旧stop+fresh Kernel Session/provider IDなしをatomic保存。原本履歴/rebuiltFrom/rollbackを保持。新規Room Messageで履歴・有効なscoped Room summary Memory/Agent Memoryを再構成するnative fixtureを検証。summary自動生成は未完了 |
| Memory | semantic/episodic/procedural/relational、scope、根拠参照、confidence | 4type/scope/confidence/Message根拠検証とSQLite追記記録を実装。TaskReview canonical org URIも根拠として公開Readerで原本を検証し、実daemon capture/再open/Review不変を確認。CLI capture/get/list/invalidateを別プロセスで検証。optional validFrom/validUntilをUTC epoch millisecondsで原本保存。CLI UTC ISO/日付正規形/期間/範囲検証と再open・legacy互換・Contextの未来/期限切れ除外を実daemonで検証 |
| Memory更新 | extraction、dedup、conflict、supersede/invalidate、原履歴不変 | 同scope/typeのactiveを原記録不変のままsupersede、理由付きinvalidateを追記しstatusを投影。全UNIQUEキーのREPLACE/UPDATE/DELETE拒否と再openを検証。Agent opt-in reviewed-tasks policyでapproved TaskReviewの前後履歴を照合し、当時のtitle/objectiveと原reviewをepisodicへ一度だけ投影。実GitHub→実Claude Max→human review→Memory→失効→daemon再起動の原本保持/no revivalを確認。一般LLM extraction/semantic dedup/conflict/nightly consolidationは未完了 |
| Context | scope・type・tags/entity・recency・importance・full-textの選択、ContextBuilder | Room入力までの履歴を最大30件/64KiB・省略数付きで構成し、Runtime応答をreply Messageへ保存。実Codex/CLIで検証。activeで現在のRoom/Agent/Task/company/globalのみ最大20件を選択。有効期間内のactiveだけ選択、境界inclusive/exclusive・scope外先行除外・実daemon Contextを検証。summary/tag/entity/full-textは未完了 |
| Task | WorkItemと内部ExecutionTaskの分離、依存・owner・親・成果物 | kind別作成/取得/一覧、依存/owner/親、コメント/成果物URIを永続化。外部同期とArtifact回収は未完了 |
| Task状態 | pending/assigned/running/blocked/waiting_approval/completed/failed | 純粋な遷移・参照/依存判断、SQLiteの原子的な状態/不変履歴、rollback/古いversion拒否を検証。Event由来Taskの冪等作成/割当/復旧を追加。manual assigned ExecutionTaskをrunning先保存→Runtime/Room返信→結果Artifactとwaiting_approvalを原子保存。実Codex/CLI・failure/競合・rollbackを検証。単一DB所有のdaemon起動時にrunning ExecutionTaskをfailedへ復旧。成果物の明示レビューでcompleted/failed・対象version/成果物/actor/理由/時刻を不変保存し、依存未完了承認・競合・途中失敗を拒否。Workflow操作の対象host/ID/input digest/request ID/effectを固定する要求と人間判断を保存。手動Workflow runへ完全一致human approve/一回claimを接続。Agent write承認待ち/再開は未完了 |
| TaskProvider | create/get/update/list/addComment/linkArtifact、Localと外部Adapter | PortとLocal SQLite Adapterを実装・検証。外部Adapterは未完了 |
| Event | 不変event log、受信者から独立したpublish、イベントとTaskの分離 | SQLiteとCLIのpublish/get/list。受信者不要・別プロセス読込・原本UPDATE/DELETE/REPLACE拒否・INSERT失敗後復旧を検証。daemon配信は未完了 |
| Subscription | pattern・filter・enabled、Agent/Workflowへのルーティング | 純粋なpattern/filter判断とSQLite保存、CLI照合/有効無効を実装。Agent参照を公開Portで確認。単発workerでAgentのExecutionTaskを作成/割当。Workflowは明示host configのdaemonから先行claim付きで一度invokeし、started receiptから配送記録を回復する。Task IDとWorkflow requestを分離し、設定なし/不明結果はdeferred。--wake-upでAgent Taskの実Runtime自動起動を実daemon/実Maxで検証。実CLI＋ローカルHTTPで起動/再起動no replayを検証、Agent Taskからのread_only Workflow委譲を別scopeで検証。書込み操作ApprovalとAgent RPC認証は未完了 |
| Trigger | manual/internal/event/webhook/schedule | manual/eventと固定間隔scheduleのEvent生成を実装。internal専用API/webhookは未完了 |
| Daemon | ローカルAPI/socket、polling、process管理、execution状態、retry/timeout | 常駐polling/Unix socketとstatus/dispatch/stop、--once/deliveriesを実装。実プロセスで新Event処理・停止/再起動・同時起動拒否・0600・原本保護・所有inode cleanup・poll失敗復旧を検証。Agent/Task/Room/Eventはdaemon client化済み。Session Runtimeのprocess管理・timeout/cancel/drain、同POSIX group停止・親SIGKILL時pipe監督（source/bundleを検証）、SQLite PID/token leaseによる同DB別socketの二重daemon拒否・終了PIDからの取得を実装。Task実行のretryは未完了 |
| Scheduler | 定期実行、Agent wake-up、再起動後の整合性 | Room Messageのopt-in自動wake-upを実装。永続claim/不変結果・同時tick拒否・busy延期・起動時中断復旧・失敗no replay・停止drainと実Maxを検証。Event由来assigned ExecutionTaskの自動起動・scoped Memory・成果物/承認待ち・明示レビュー・再起動no replayを実daemonと実Claude Maxで検証。固定間隔Schedule→Event→Subscription→Agent Task/Runtimeを実daemonで検証。同slot不変原本/disable/再起動/no replay/時刻巻戻り/最新missed slotのcoalesceを実装。cron/calendarと自動retryは未完了 |
| Runtime | Claude Code/Codex CLI Adapter、role/instruction injection | 明示argv/env/input・timeout/cancel・出力上限の実子プロセス境界を検証。Codex/Claudeのstart/resume引数生成・応答解析・process DI境界をUT検証。共通RuntimeTurn PortとLocalAgentRuntime start/send/resume/stop/shutdown、停止drain・同時実行拒否を実fixture/SQLiteで検証。daemon/CLI配線と実Codexの開始/再開/Room返信を検証。Task runで実Codex結果をwaiting_approvalへ記録。実Claude Maxのsafe-mode/tools無効起動とTask結果を検証。--wake-upで依存completedのassigned ExecutionTaskを自動実行。WorkItem除外/失敗/停止/再起動を実CLIで検証 |
| Sandbox | local process/Docker、checkout/mount、資格情報の限定注入、destroy | Docker one-shot CLIを実装。networkなし/rootfs readonly/非root/容量制限tmpfs/CPU-memory-pids上限。HEAD regular treeだけをコピーしenv/untracked/Git履歴/原本mountなし。timeout/cancel/output上限/finally ID限定destroyを実Dockerで検証。daemon経由の6秒待機/cancel/drain/direct SIGINTを実CLIで検証。owner Agentの同Task Room厳密JSONを明示proposal指定で実行し、実Claude Max→Docker→stdout/file/原本Message参照→人間reviewを検証。明示host policyでRuntime返信→権限再照合→一回のDocker実行→Artifact→人間review→Memoryを実CLI/Docker/実Claude Maxで検証。多段tool loop/credential注入は未完了 |
| Artifact | 回収・永続参照・Taskとの関連付け | Runtime結果Messageをorg URIのArtifactへTaskと原子関連付け。実fixture/Codexで検証。Dockerの選択regular file回収/各path componentのO_NOFOLLOW/総量制約/内容hash blob保存とTask承認待ちを実CLIで検証 |
| Workflow | n8n invoke/status/cancel、Task/Agentから分離 | WorkflowRuntime Portとn8n HTTP Adapterを実装。host allowlistのproduction Webhookでinvokeし実行ID/Workflowを照合、公開APIでstatus/cancel。公式固定版2.41.6のローカル実機でsuccess/waiting→canceledを検証。入力・応答上限/redirect禁止/no retry/応答JSONエラー非漏洩。CLI run/status/cancel/list/historyと不変Event receiptを実装。先行claim/同key二重invoke拒否/unconfirmed no retry/入力hash/host・Workflow照合を実CLIと実daemon+n8nで検証。Event購読の実daemon+n8n success/restart no replayを検証。Task owner/Room/version/capability・明示read_only scope・Agent固有SecretStore参照を照合する委譲を実装。実Max→ローカルn8n→成功Artifact→human review→Memory/restart no replayを検証。手動write/irreversible契約はhuman Approval完全一致と一回claimで実行。長時間非同期再開・業務Workflow・Agent操作Approval待ち/再開は未完了 |
| Permission | read/write/delegate/approve/spend/publish/contact/shell/networkを実行境界で制約 | delegateは送信前とdaemon activation前にcan_delegate必須。旧Agentは既定拒否、reserved metadata迂回も拒否。Sandboxはowner確認/can_run_shell、repoにcan_read、writableにcan_write必須。登録後capability変更はhuman Approval/revision CAS/一回適用のreceipt/原子Auditで制約し、2Adapter/rollback/実CLIを検証。Task Workflowはcan_read/delegate/access_network/contact_externalとhost read_only scopeを照合。その他重要操作境界/Agent認証は未完了 |
| Approval | 送信・deploy・削除・契約・支出・権限変更で待機し承認後に実行 | 最初の実操作としてcapability変更をpending→human approve/reject→適用へ接続。idempotency key原本再利用/異内容conflict、一判断不変保存/再試行、pending/reject no effect、古いrevision拒否、後続grantの上書き抑止を実CLI/SQLiteで検証。Workflow操作はhost/ID/input digest/request ID/effect/要求actorを不変保存し、手動native runで完全一致human approve/一回claimを強制。外部送信/deploy/削除/契約/支出の業務AdapterとAgent承認待ち再開は未完了 |
| Audit | actor/task/event/tool/input-output/timestamp/result/approvalの参照 | Task結果レビューのactor/task/version/outputArtifacts/timestamp/decisionを不変記録。capability変更のactor/task/event/tool/input-output/時刻/result/approval参照を変更と原子保存し、request/decision/applyの公開Port集約をaudit CLIへ接続。同時刻の因果順序も検証。Task実行状態の開始/成功/失敗を既存原子履歴からaudit CLIへ投影し、開始owner/Event/version入出力参照を公開。Workflow操作Approval request/decisionと新規不変Workflow receiptのclaim/開始/不明結果/status/cancelをAuditへ投影。actor/Task/Event/Approval/hash/execution参照と同時刻因果順を検証。actorなしlegacy原本に人物は補完しない。重要操作全般・詳細Sandbox toolなどは未完了 |
| 実行安全性 | idempotency/retry/timeout/concurrency/cancel/secret redaction | Event→Task作成の冪等性/同時実行/receipt復旧を実DB/CLIで検証。一般の外部副作用・retry/timeout/cancel/secret redactionは未完了 |
| CLI | daemon/agent/room/task/workflow/event/sandbox/logs/tui | Agent/Task/Room/Eventのdaemon経由操作と明示的--direct管理操作を実装・検証。その他は未完了 |
| TUI | Agent/Room/Task/Eventの監視と対話 | 未完了 |
| 外部連携 | Linear TaskProvider、GitHub Event、Notion knowledge/docs | 公開GitHub Eventの明示REST GET→原本Event→Subscription→一Taskを実装。実CLI再取込/再open/6秒HTTP待機と実公開GitHub→実Claude Max→Artifact→人間reviewを検証。最新300件/30日のAPI制約あり。private/webhook/自動poll、Linear/Notion Adapterは未完了 |
| Ports | Agent/Memory/Task/Workflow/Event/Scheduler/Sandbox/SecretStoreの交換可能性 | 各既存Portへ初期Adapterを接続。SecretStore PortとEnvironment Adapterは明示actor/reference grantだけを解決しWorkflow host APIキーへ接続。lookup DI/未知actor先行拒否/例外・値非漏洩を最小UTで検証。Agent別Workflow allowlistと専用credential参照を実装。read-only macOS Keychain Adapterを明示grant/専用path/service/account/timeout/output上限で接続。private一時Keychainと実CLI/Workflow HTTPのenvなしhost/Actor別キー交換をopt-in実機検証。Agent RPC認証・Vault・Sandbox注入は未完了 |
| 運営の実務e2e | Issue→委譲→実装→テスト→レビュー→Draft PR→人間判断→記憶 | 未完了 |
| ログ | 依頼・承認・判断・変更・テスト結果をリポジトリ/Gitへ記録 | `docs/work-log.md`、Notion snapshot、RED/GREEN、実jevレビューを記録。継続する |

## 実装順

1. TSへ移行し既存Agent e2eを維持。既存SQLiteデータを読めることを検証。
2. Task・Execution・Room・Message・Event・Subscriptionの永続化とCLIを小さく検証。
3. ローカルdaemonと決定論的なイベント→Task処理、実行の状態遷移・安全性。
4. Runtime/Session、MemoryとContext、coordinator・A2A。
5. Scheduler、Sandbox・Artifact、Workflow、Permission・Approval・Audit。
6. 外部AdapterとCLI/TUI、実務の一周を実サービスまで検証。

実サービスの資格情報が不足する場合は、ローカル実装とcontract testsを進め、実サービスで未検証の部分を分けて記録する。モックの成功を実サービスの成功とは扱わない。

## 対象外（Notionに明記）

重いGUI、独自LLM provider、独自vector DB、Kafka等の大規模基盤、独自Workflow designer、完全な外部A2A protocol。NATS/Redisは必要性が確認できた時にAdapterとして追加する。

## 追加された品質要件（2026-10-04）

- Voicy記事を参考に、実際のAgentモジュールをリファレンスとし、人間も読むコーディング指針を定める。実装済み：`docs/reference-implementation.md`、`docs/coding-guidelines.md`。
- 型・lint・AST・jev-lintで生成物をレビューする。実装済み：strict tsgo、type-aware Oxlint、fixture付きAST、指針をcontextにしたjev rule。実APIの判定も実行済み。結果と指摘の扱いはverificationに記録。
- GHAは使わず全てローカルで行う。Lefthookのpre-commitでindexの静的検査、pre-pushで全push対象treeの全検査・意味レビュー。Agentは作業中にRED/GREENと全テストを実行する。実装・hook設定済み。実際のhook実行結果は作業ログへ記録する。
- APIキーはユーザーが `.env` に設定し使用を許可。`.env` はGit除外、値は出力しない。
