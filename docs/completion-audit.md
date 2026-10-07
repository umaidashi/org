# 全体目標の証拠監査（2026-10-07）

最新の要件分類とNextは [全体ゴール再照合](goal-reassessment.md)。以下のbaselineは当時の記録であり、追記済み機能の未実装判定を現在へ流用しない。全体未達は維持する。


## 判定と証拠の境界

全体目標は未達。MVPの動作一周、通常gateの成功、実サービスへの納品、全明示要件の充足は別々に判定する。今回の監査は未達を取り除くための一覧であり、完了宣言ではない。

調査HEADは`e801879`、製品/テストの受け入れbaselineは`22803f4`。両者の差分はwork-logと監査計画だけで、製品/テストは一致する。[実Claudeを含む全gate](verification/2026-10-07-runtime-linear-real-claude/check.txt)は447成功/12skip/0失敗、459tests/190files/214.87秒。実Jevは2107subjects、missing/unsure/review/errors/degradedなし、128warning。通常pre-pushは445成功/14skip/0失敗だった。今回、このgate自体を再実行したとは扱わない。

以下の「検証あり」は該当する実装と、このbaselineで実行されたテストを確認した意味。外部HTTP fixtureや過去の実機記録は実APIの現在の認証・業務納品を証明しない。新しい変更ではTDDと全gateを改めて行う。

監査後の進捗: `agent send`を既存Message/Room activationへ接続した。[計画](superpowers/plans/2026-10-07-agent-send.md)と[最終検査](verification/2026-10-07-agent-send/check.txt)を参照。448成功/14skip/0失敗、実Jevと独立review成功。以下のCLI欠落表は監査baselineの記録で、この一件は解消済み。他の未達と全体未完了の判定は維持する。

Memoryの追加進捗: `memory capture --source-event EVENT_ID`で、既存Event原本の存在/IDを保存前に検証する経路を接続。CLI再読取り、原本不変、拒否時の保存ゼロを確認し、TaskReview専用selectorも維持する。Event由来の自動候補抽出やWorkflow/Artifact/一般Decisionの全provenanceは未達のまま。

hash Artifact追加進捗: `--source-artifact org://artifacts/HASH`を既存captureへ接続し、既存readerのno-follow/サイズ/hash検証を保存前にawaitする。missing/corrupt/symlinkの拒否、原本bytes不変とMemory再読取りを検証。ローカルhash blobの存在/整合性に限定し、全Artifact種別や自動候補抽出の完成とは扱わない。

## 取得した原文

[root](https://app.notion.com/p/3ee8a4020cb681d18daacc1e0016d596)と00–10を全て再取得した。root/10は編集2026-10-07、00–09は2026-10-04。取得レスポンスに切詰め・未知block警告なし。Notion自身のverificationはunverifiedで、ユーザー指定の設計資料として照合した。raw本文・認証情報を新しい公開証拠やJev入力へ追加しない。

| 番号 | 原文 |
|---|---|
| 00 | [概要・設計原則・Ports](https://app.notion.com/p/3ef8a4020cb681ab8129e9a952d854a2) |
| 01 | [Agent・組織・A2A](https://app.notion.com/p/3ef8a4020cb6810a8b2df2617e3d41e9) |
| 02 | [Room・Chat・Session](https://app.notion.com/p/3ef8a4020cb681e0801ed8cd22eba0cb) |
| 03 | [Projected Typed Memory](https://app.notion.com/p/3ef8a4020cb6811eab2ffd06fc174a11) |
| 04 | [Task抽象化](https://app.notion.com/p/3ef8a4020cb681b18ce9de552f36dd24) |
| 05 | [Event・PubSub・Trigger](https://app.notion.com/p/3ef8a4020cb6810f940deeae34962eea) |
| 06 | [Runtime Ports](https://app.notion.com/p/3ef8a4020cb681cda474cf6801b22706) |
| 07 | [CLI/TUI・daemon](https://app.notion.com/p/3ef8a4020cb6813ea03bf25b87ede752) |
| 08 | [Security・Permission・Approval](https://app.notion.com/p/3ef8a4020cb6815f9afdeaef5707f50d) |
| 09 | [MVP・六Phase](https://app.notion.com/p/3ef8a4020cb68173a20be8c050bec268) |
| 10 | [Org Desk](https://app.notion.com/p/3f28a4020cb6817ba677e241ac8b1a71) |

## CoreとPorts

| 要求 | 現在の直接証拠 | 判定・不足 |
|---|---|---|
| 00 Runtime agnostic / local first / deterministic core | `src/runtime/manager.ts`、`config.ts`、両driver、`src/daemon/`、各domainのAST fixture | 両CLI Runtimeとローカルdaemonは検証あり。全外部Port交換を証明するものではない |
| 00 persistent identity / ephemeral execution / immutable history | Agent/Sessionを分離したdomain・SQLite、不変Message/Event/history、Docker finally destroy | 検証あり。停電耐久・全環境の物理隔離は未証明 |
| 00 AgentRuntime start/send/resume/stop | `src/runtime/manager.ts`、`tests/session-runtime.test.ts`、Claude/Codex実機記録 | 検証あり。API-model/Remoteは将来候補 |
| 00 MemoryProvider / Extractor / Retriever / Consolidator / ContextBuilder | `src/memory/port.ts`、`extractor.ts`、`retriever.ts`、`consolidation.ts`、`src/context/port.ts`、DI/SQLite/native tests | 各既存処理に差し替え境界あり。残るsource/policyは下記 |
| 00 TaskProvider create/get/update/list/addComment/linkArtifact | `src/tasks/port.ts`、`sqlite.ts`、`tests/task-cli.test.ts` | 共通六操作は両Adapter/実await consumerで検証済み。実APIは未達 |
| 00 WorkflowRuntime invoke/status/cancel | `src/workflows/port.ts`、`n8n.ts`、公式ローカルn8n記録、native tests | 検証あり。業務Workflow/現在の遠隔認証は未証明 |
| 00 EventBus publish/get/list/subscribe / Scheduler | `src/events/port.ts`、SQLite、`src/schedules/port.ts`と`service.ts`の注入clock/EventBus | Local/固定間隔は検証あり。別busは必要時の候補 |
| 00/06 SandboxRuntime / SecretStore | `src/sandbox/service.ts`のrun/save関数Port、`docker.ts`、`src/secrets/port.ts`、Environment/Keychain Adapter | DI境界あり。名前だけの空interfaceを追加しない。限定credential注入は未実装 |
| 00 Core Domain全項目 | `src/agents`、`rooms`、`sessions`、`memory`、`tasks`、`events`、`workflows`、`sandbox`、`approvals`、`audit` | ExecutionはTask/Session/Workflow実行記録で表現。別の空domainは作らない。permissionは部分実装 |

## Agent・Room・Session（01/02）

| 明示項目 | 現在の直接証拠 | 判定・不足 |
|---|---|---|
| Agent id/name/role/reportsTo/runtime/capabilities/memoryPolicy | `src/agents/domain.ts`、SQLite、`agent-domain`/`agent-reporting-cli`/`agent-permission` tests | 検証あり。roleとRuntimeを分離。memoryPolicyはnone/reviewed-tasks |
| Agent permissions | Agent domainにこのfieldなし。host Runtime/Workflow/Linear scopeとcapabilityを別々に照合 | resource permissionの共通契約・本人認証は未達。capabilitiesの存在だけで代替完了にしない |
| Chief of Staff→専門Agent | `src/agents/service.ts`、A2A delegate、`coordinator-claude-real.test.ts` | fixture/実Claudeの委譲一周あり。任意業務の実装/納品は未証明 |
| Coordinatorのみ起動 / mention例外 / 一斉起動抑止 | `src/activation/domain.ts`、`room-runtime`/`activation-cli`/`automatic-wake-up-cli` tests | 検証あり |
| A2A id/from/to/type/taskId/payload/correlationId | `src/a2a/domain.ts`、service、`a2a-cli.test.ts` | 検証あり。delegate/request/result/question/decision/blocker/cancelの型あり |
| typed request/result/decisionと冪等委譲 | A2A adoption/reporting、Task review、不変Room原本、Coordinator実機記録 | 検証あり。全typeが汎用自律tool loopで処理されるとは主張しない |
| Direct/Group/Agent/Task、同Agentの複数Room | `src/rooms/domain.ts`、SQLite、`room-domain`/`room-cli` tests | 検証あり |
| Room id/title/type/activationPolicy/participants/createdAt/archivedAt | 同domain、SQLite・CLI tests | 検証あり |
| Message id/roomId/sender/content/replyTo/metadata/createdAt | 同domain、追記専用SQLite・Room CLI/rollback tests | 検証あり。sender文字列は本人認証とは別 |
| mention_only/coordinator/all/rule_based、coordinator既定 | activation domain、Room metadata rules、native restart tests | 検証あり |
| Agent/Room/Session/Memoryの分離 | Session domain、Task/Room関連、Memory source、Context | 検証あり |
| 壊れたSessionをRoom messages+summary+Agent Memoryから再構築 | `sessions/rebuild`契約、`session-cli.test.ts`、実Max Memory引継ぎ記録 | 明示rebuild/要約Memoryで検証あり。常時自動要約は別残件 |

## Memory（03）

| 明示項目 | 現在の直接証拠 | 判定・不足 |
|---|---|---|
| semantic/episodic/procedural/relational | `src/memory/domain.ts`、Memory domain/SQLite/CLI tests | 検証あり |
| id/type/scope/content/status/confidence/validFrom/validUntil/sourceRefs/supersedes | 同domain、validity/SQLite/service tests | 検証あり。active/superseded/invalidatedを原本+projectionで管理 |
| global/company/department/project/agent/room/task scope | domain validation、capture/list/search CLI | 保存・明示検索とhost明示Room/Agent pairのRuntime関連付けを検証。manual Session/保存Session再起動reply/rebuild/Task/自動wake-upに直接CLI証拠あり。不存在/非参加Agent・archiveの起動拒否も検証 |
| 現在scopeに関係するMemoryだけretrieve | `src/rooms/runtime.ts`、retriever、Context DI/SQLite/native tests | Room/Agent/Task/company/globalで検証。host明示department/projectをmanual/Task/自動wake-up/rebuild/保存Session再起動replyで実CLI検証。本人認証/全scope自動抽出とは区別 |
| Message原本から候補抽出 | `memory/extraction.ts`、strict JSON Extractor、`memory-extraction-runtime-cli.test.ts` | 同Roomで検証あり。strict URI根拠としてEvent/Workflow receipt/hash Artifact/TaskReview/確定Approval Decisionを接続。全scope自動抽出は未達 |
| Task executions / Decisionsから候補抽出 | approved TaskReview+前後Task履歴、`memory/reviews.ts`、確定Approval Decision reader | TaskReview投影とapprove/reject Decision原本付き明示capture/Room strict candidate URIを検証。一般Decision全種/全scope自動抽出は未達 |
| Workflow executions / Events / Artifactsから候補抽出 | `memory/service.ts`にEvent/Artifact原本Reader、CLI capture/実DB/blob検証あり | Event/Artifactの明示captureとRoom strict candidate URIを検証。Workflow履歴は不変Event receiptを同じReaderで候補根拠に採用。opt-in Room自動採用/再起動と実DB後方根拠失敗の保存ゼロを検証。全scope自動抽出/実業務Workflowは未達 |
| Deduplicate / Conflict detection | 同値content dedup、metadata不一致先行拒否、明示supersedes、Room夜間同値整理 | 完全同値/metadata衝突は検証あり。意味conflictの自動推定は未達 |
| 旧Memory削除/上書き禁止、明示supersede/invalidate | immutable SQLiteとstatus projection、原本/REPLACE拒否/reopen tests | 検証あり |
| retrieval優先:scope/type/tags/entity/recency/importance/full-text | `memory/retrieval.ts`のfilter/sort、SQLite FTS、retrieverとContext tests | 選択/順位・bounds・DI交換に検証あり。typeは選択filter。Vector/rerankは必要時のみ |
| providerとpolicy分離、conservative extraction/nightly consolidation/scoped relevance | Provider/Extractor/Consolidator/Contextの別境界、明示Room allowlistのdaemon設定 | 全scopeの明示allowlist nightlyを検証。意味consolidation/全scope自動抽出は未達 |

## Task・Event・Runtime（04–06）

| 明示項目 | 現在の直接証拠 | 判定・不足 |
|---|---|---|
| Task id/title/objective/status/priority/owner/parent/dependencies/labels/inputArtifacts/outputArtifacts/externalRef | `src/tasks/domain.ts`、SQLite、Task domain/CLI tests | Local modelは検証あり |
| pending/assigned/running/blocked/waiting_approval/completed/failed | domain transitions、SQLite原子history、Execution/Approval/復旧tests | 検証あり。図の一本道に限定せずblock/review復旧を扱う |
| WorkItemと内部ExecutionTaskの分離 / 外部Taskを汚さない | kind/parent、Event/A2A生成、Linear import、内部Task原本 | 検証あり。内部Executionで新Issueを作らない |
| WorkItem↔既存Linear Issue同期 | `linear/import.ts`のsnapshot/refresh、承認write/observe、専用scope | title/objective/選択fieldの明示操作あり。Core status/ownerの明示読取は検証済み。明示write共通updateも両Adapterで検証済み。共通comment/artifactも両Adapterで検証済み。自動双方向同期/実APIは未達 |
| TaskProvider create | Local create/SQLite tests | 外部新Issue作成をこの実務で行わない。既存Issueへのprojection/取込との意味を接続時に明示する |
| TaskProvider get/list | Local tests、Linear get/listの固定GraphQL一ページ/UUID/Team/cursor tests | 共通AsyncTaskProviderと実await consumerで両Adapterを検証済み。実APIは未達 |
| TaskProvider update | Local CAS/history、Linear content/fieldsの承認/claim/observe | 共通Port/明示Core patch/逆mapping/承認付きwriteはDI・実CLI・全gateで検証済み。外部writeは明示承認が必要 |
| TaskProvider addComment/linkArtifact | Local comments/artifacts、Linear approved comment/HTTPS attachment | 同じCore非同期Port/実consumer、Local CAS原本とLinear承認receiptで検証済み。実APIは未達 |
| Event≠Task、Publisherは受信者を知らない | `events/domain.ts`/port、`daemon/domain.ts`/service、native tests | 検証あり |
| Subscription subscriberType/subscriberId/eventPattern/filter/enabled | domain、SQLite、pattern/filter/daemon tests | Agent/Workflowの検証あり |
| Event→Subscription→Task/Workflow→Agent→新Event | dispatch/Workflow配送/Task wake-up、実Claude/ローカルn8n記録 | 動作一周あり。任意adapterの同等性や現在実サービス認証とは別 |
| schedule/manual/event/internal event Trigger | Schedule Event、event publish、内部result/Audit Event、daemon polling | 内部Eventをpublishできる。internal専用APIは原文が要求する別Portではない |
| webhook Trigger | GitHub署名payloadのCLI取込/native tests | payload contractは検証。常駐HTTP受信・実Webhook配送は未達 |
| control/execution plane分離 | daemon composition、Runtime manager、Sandbox/Workflow関数Port | 検証あり |
| Sandbox create→checkout/mount→credential注入→execute→Artifact→destroy | Docker create/start/exported HEAD/exec/copy/rm、resource/network制約、実Docker記録 | one-shotとArtifact回収は検証。限定credential注入は未達。host mountを使う必要はない |
| Workflow invoke/status/cancel、初期n8n | `workflows/port.ts`、`n8n.ts`、native/公式ローカルn8n記録 | 検証あり。未来Workflow Adapterは対象外候補 |

## CLI/TUIとdaemon（07）

CLIの原文は例示だが、例示した操作の提供有無を省略しない。引数表記の差はREADMEへ明示し、未実装verbを同名で使えるとは主張しない。

| 原文操作 | 実装/同等経路 | 判定 |
|---|---|---|
| org daemon / org agent list / agent create | application parser、daemon、`cli.test.ts` | 検証。createにはrole明示を要求 |
| org agent send chief MESSAGE | `agents/send.ts`と実CLI/daemon tests、Room/activation再利用 | 明示送信・監査・実Runtime経路を検証済み。本人認証は別残件 |
| room list/create | Room parser/CLI tests | 検証。参加者は--human/--agentで指定 |
| room open | `org room open ROOM_ID --human HUMAN_ID`、既存Room chat | alias実装済み、実PTY送信/再open/終了を検証。名前検索・本人認証は未達 |
| task list/assign | Task parser/CLI tests | 検証 |
| workflow run --input | Workflow parserとJSON入力、Approval/native tests | 検証。任意業務Workflow実機は別 |
| event publish --data | Event parser/CLI、JSON payload | 検証。必須sourceを追加指定 |
| sandbox list | `sandbox/jobs.ts`、daemon composition、実Docker CLI/DI | daemon所有jobのrunning/cancelling snapshotを検証済み。direct/Docker全container/別daemon/終了履歴の一覧は対象外 |
| logs tail AGENT | `audit/logs.ts`、Approval CLI parser/registry、実direct/daemon/reopen | exact immutable Agent actorの最新Audit snapshotを検証済み。連続follow/Runtime stdout/全重要Audit収集は別範囲 |
| org tui:Agents/Rooms/Tasks/Events | `tui/monitor.ts`、Session状態別counts、monitor/CLI/Room chat tests | 監視と対話あり。[現行実PTY証拠](verification/2026-10-07-room-open-tty/tty.json)で四領域描画/送信/再open/終了を確認。全platform・本人認証・実モデル対話は未達 |
| thin client/local API/socket | daemon client/server、0600、PID/lease/inode、client/native tests | 検証。RPC/人間本人認証は未達 |
| scheduler/event polling/runtime管理/execution state/timeout/wake-up | 各daemon stages、Schedule/Runtime/Task/native tests | 検証 |
| retry | delivery attempts/deferredの再処理、A2A通知/Artifact status-only再観測 | 限定retryのみ。Task実行の安全なretry方針/契約は未達。外部効果を無条件再送しない |

## Security・Approval・Audit（08）

| 明示項目 | 現在の直接証拠 | 判定・不足 |
|---|---|---|
| can_read/write/delegate/approve/spend/publish/contact_external/run_shell/access_network | Agent enum、Sandbox/Workflow/Linear実行境界、capability変更Approval/native/DI tests | enum全件あり。全tool境界への適用/本人認証は未達 |
| Agent別working directory / credential | `runtime/config.ts`のagents profile、alias env、`runtime-agent-profiles-cli.test.ts` | 選択/継承抑止は検証。native同UIDプロセスの物理FS/Keychain/IPC隔離は未証明 |
| Agent別sandbox / tool access / network / external service scope | Task owner+capability、Docker network none、Claude tools/MCP/hooks off、Workflow/Linear host allowlist | 現在の制約を検証。許可network/限定credentialをSandboxへ注入する契約は未達 |
| 万能credential共有禁止 | Environment/Keychain explicit actor/reference grant、Agent専用Linear/Workflow keys、env allowlist | 暗黙共有なしを検証。hostが明示的に同じcredentialを与えることの強制禁止ではない |
| 外部影響/不可逆操作のApproval | Workflow write/irreversible、Linear update/comment/Artifact、capability変更 | pending/reject/no effect/完全一致/一回claim/receiptを検証。外部メール/deploy/削除/契約/支出は例示で、そのAdapterを実装済みとはしない |
| Audit actor/task/event/tool/input-output ref/time/result/approval ref | `src/audit/`、Approval/TaskReview/外部Event receipts、audit/native/rollback tests | 既存重要操作で検証。Sandbox tool実行の開始/結果をdirect/daemon/Runtimeで検証。本人認証/全重要Auditの網羅は別判定 |
| idempotency key/concurrency/timeout/cancel/redaction | durable claim/CAS、Runtime group/pipe監督、HTTP bounds/timeout、cancel/drain、credential反射拒否 | 現在の経路で検証。任意将来toolの保証や外部CASは含まない |
| retry | 不確定claimのno replay、status-only観測、保存障害修復 | 安全性を保つ限定処理。一般Task retryは未達 |

## MVP Phaseと残件の優先順

| Phase | 判定 |
|---|---|
| 1 Kernel / SQLite / daemon / CLI | 現在の永続化・状態・実CLI検査あり。上記CLI gaps/本人認証まで完了したことにはしない |
| 2 Claude/Codex / Session / role-instruction | 両driver、fixture、実Claude/過去Codex記録あり。現在の全provider再実行ではない |
| 3 Typed Memory / scope / extraction / supersede / Context | 限定経路に検証あり。全source/scope/policyは未達 |
| 4 Scheduler / bus / matching / wake-up / coordinator | 固定間隔/Local bus/実Claude wake-upに検証あり。cron/calendarは原文が指定していない拡張 |
| 5 Docker / Artifact / n8n | 実機記録と現在native契約あり。credential注入/全詳細Audit/一般retryは未達 |
| 6 Linear TaskProvider / GitHub events / Notion knowledge | 個別操作/HTTP contractあり。Linear共通契約と実Linear/Notion CLI認証は未達。NATS/Redisは必要時だけ |

次は原文07の`agent send`を既存Room/activationへ接続し、Founderの主操作面の欠けを小さなCLI e2eから埋める。その後は、Memory Event等の根拠Reader、Linear共通TaskProviderとCore status/owner対応、安全なTask retry/限定Sandbox credential・permission/Auditを進める。優先順の変更は原文根拠と実際の不足に基づきログへ残す。

現在の`.env`は値を出さず設定有無だけ確認し、LINEAR_API_KEY/NOTION_API_KEYなし、TYPESAFE API keyあり。実Claude Maxは既存ログインを使える。既存業務Issueと変更先repoの指定は未回答で、新Issue/任意業務writeは行わない。実API認証/本人認証/実業務Draft PRは、独立した実装可能な残件を止める理由にも全体完了へ読み替える理由にもしない。

## 必須へ勝手に格上げしないもの

00/04のAdapter候補（Postgres、GitHub Issues、Notion Task、API model、remote Sandbox、Mem0等）、06の将来Workflow、05の将来Event bus、03の必要時vector/rerankは全実装を要求していない。09はheavy GUI/独自LLM・Vector DB/Kafka/Workflow designer/完全A2Aを対象外とする。cron/calendar、汎用tool loop、常時自動Room summary、停電耐久/GC等は現行要件書に残る拡張・堅牢化で、原文が指定した個別実装方式と混同しない。未証明の現保証を完了扱いせず、候補も勝手に消去しない。

10は「設計中」「実装・issue作成は対象外」と明記。現在/履歴/関連先/鮮度/粒度、read-only、元Task状態と不明鮮度の分離、複数Session、原本参照と権限/redaction、未観測終了を推測しないという設計を保持する。閾値/role権限/正式schema/UI範囲は未決定で、今回実装要件へ変更しない。

## 2026-10-07 Linear Core読取の追加

ホスト明示mappingを使う既存linear-get --mappedで外部state/assignee/priority/labels/timestampsをCore WorkItemとして読み取る。Local ExecutionTaskと履歴は変更しない。共通非同期六操作、永続status/owner同期、実Linear認証は未達のまま。[設計](task-provider-design.md)と[計画](superpowers/plans/2026-10-07-common-linear-task-provider.md)に従い継続する。

## 2026-10-07 Linear Coreの永続同期追加

明示task sync-linearで外部Core snapshotを既存WorkItemへCAS/不変履歴付きで反映できる。外部six fieldsとLocal所有fieldsを分離し、内部ExecutionTaskと履歴の不変を実CLI/DI/実SQLiteで確認。[証拠](verification/2026-10-07-linear-core-sync/check.txt):457成功/14skip/0失敗。04の同期の一経路を満たしたが、共通非同期六操作/実consumerと両Adapter契約/双方向mapping/実API認証は未完了。その他Memory/permission/本人認証/Sandbox credential・Audit/安全retry/実業務納品/CLIの残件を維持。

## 2026-10-07 共通非同期TaskProvider三操作

共通Core consumerのcreate/get/listをLocal/Linear両Adapterへ接続し、実CLI/direct/daemon/reopen、外部snapshotとLocal原本保持、完全page検証とCAS同期を確認。[全gate](verification/2026-10-07-async-task-provider/check.txt):462成功/14skip/0失敗。実Jev2191subjects/missing・errors・degraded0。Linear createは既存Issueのミラー作成で新Issueを作らない。残update/addComment/linkArtifact・双方向明示mapping・実API認証と他の全体残件は未達。[次の計画](superpowers/plans/2026-10-07-core-provider-writes.md)へ続く。

## 2026-10-07 Linear priority承認付き更新

既存selected-field updateへpriority整数0–4を追加。承認mask/input digest/baseline/返却値/不明結果観測に通し、priority0、priority-only競合、承認後変更、返却mismatch、並行一回/再送禁止/再openをDI・実CLI fixtureで確認。[全gate](verification/2026-10-07-linear-priority-write/check.txt):462成功/14skip/0失敗、実Jev2193subjects/missing・errors・degraded0。Core共通update・明示逆mapping・複合変更・残comment/artifact・実API/本人認証/実業務納品と他の全体残件は未達。

## 2026-10-07 Linear複合変更の承認付きwrite

selected fieldsへtitle/descriptionを追加し、状態・担当・labels・priorityと一回の承認/digest/返却照合/不明結果観測で更新できる。UTF8 byte上限/NUL/空title、選択contentの競合・入力変更・返却mismatch、未選択変更、本文解除のnull正規化とlegacy承認互換をDI/実CLIで確認。[全gate](verification/2026-10-07-linear-combined-write/check.txt):465成功/14skip/0失敗、実Jev2195subjects/missing・errors・degraded0。共通Core update/逆mapping/comment/artifact・実API/本人認証/実業務納品と他の全体残件は未達。

## 2026-10-07 共通Core Task update

Local/Linearの実AsyncTaskProvider.updateを同じawait consumerとCLI/direct/daemonへ接続。closed Core patch、state/owner一意逆mapping・host labels、human Approval/receipt後CAS/selected Core照合、Local原本/関係保存、sync障害receipt保持・再送禁止/get回復をDI/実HTTP fixture/SQLite/reopenで確認。[全gate](verification/2026-10-07-core-task-update/check.txt):470成功/14skip/0失敗、484tests/197files165.05秒。実Jev2224subjects/missing・errors・degraded0。共通四操作は検証済み、残addComment/linkArtifactと実API/本人認証/全重要Audit/Memory等の残件・実業務納品は未達。

## 2026-10-07 共通Core comment/artifact

残二操作をAsyncTaskProviderと同じawait consumer/CLI/daemonに接続し、Local CAS原本/history rollback、Linear承認・Core ID/原本照合・credential取得前後metadata変更拒否・各一回/再送禁止・reopenを検証。[全gate](verification/2026-10-07-common-task-comment-artifact/check.txt):473成功/14skip/0失敗、487tests/197files165.42秒。実Jev2235subjects/missing・errors・degraded0。共通六操作の実接続は確認済み、実API/本人認証/全重要Audit/Memory残件/実業務納品を完了にしない。

## 2026-10-07 daemon Sandbox list

既存one-slot jobsとrunSandbox DIへread-only listを接続。idle/running/cancelling/解放後空、private lifecycle非公開、direct/余剰/実行option拒否を確認。[実Docker](verification/2026-10-07-sandbox-list/native-docker.txt):5成功/0失敗9.04秒。[全gate](verification/2026-10-07-sandbox-list/check.txt):474成功/14skip/0失敗488tests/197files167.28秒。実Jev2237subjects/missing・errors・degraded0。狭いCLI gapの充足で、本人認証/全重要Audit/Memory/実業務納品/全体完成を変更しない。

## 2026-10-07 Agent監査ログtail

既存collectAudit/selectAuditLogsへAgent actor filterを接続し、他Agent/human同ID除外、filter後limit、登録対象照合、DB前parser拒否を検証。Task現在ownerを過去主体へ付け替えず、direct/daemon/停止後reopenで同結果を確認。[全gate](verification/2026-10-07-agent-log-tail/check.txt):475成功/14skip/0失敗489tests/197files166.02秒、実Jev2238subjects/missing・errors・degraded0。最新snapshotの明示操作で、Runtime stdout stream/全重要Audit/本人認証/実業務納品/全体完成を主張しない。

### 2026-10-07 全scope保守的整理

global/company/department/project/agent/room/taskを既存exact planner/transactionへ接続。公開Readerでactive Room/Agent・Task実在をreceipt前・transaction内照合、旧Room key互換、combined allowlist最大32・重複拒否、非Room別namespace、UTC coalesce/巻戻り/再起動no replayを確認。[証拠](verification/2026-10-07-memory-scoped-consolidation/)全gate484成功/14skip/0失敗498tests200files174.31秒、実Jev2287subjects/欠損・エラー・劣化0。全scope期間外同値グループのmutation RED→GREEN、実CLI7scope/実daemonRoom+department/SQLite rollbackも確認。意味conflict/全source・scope自動抽出/本人認証/全resource permission/実業務納品/全体は未達。[次の計画](superpowers/plans/2026-10-07-sandbox-execution-audit.md)へ進む。

### 2026-10-07 Sandbox詳細execution Audit

既存immutable Event/共有Artifact producer/collectAuditへ実行claim・結果receiptを接続。actor/Task実行version/元Event/入力digest/proposal ref/時刻/Artifact URIを保存し、本文・出力・repo path・例外本文を追加保存しない。開始保存前runnerゼロ、結果保存障害は開始のみ/同version再実行禁止を実SQLiteで確認。[証拠](verification/2026-10-07-sandbox-execution-audit/)全gate490成功/14skip/0失敗504tests201files175.40秒、実Jev2303subjects/欠損・エラー・劣化0。実Docker4成功3files12.02秒でdirect/daemon/Runtime、cancel/drain/SIGINT/Agent tail/再起動原本保持を確認。成果物生成とTask stage/review、同DB操作と跨操作全原子性は区別する。全体は未達、[次の要件再照合](superpowers/plans/2026-10-07-goal-reassessment.md)で必須残件と将来候補を整理する。

### 2026-10-07 Runtime既知private環境値の反射拒否

全default/per-Agent runtime選択envのprivate非空値を共通wrapperで検査し、成功stdout解析前と復号後text/provider IDの反射を全応答拒否。Process例外反射は固定Error、既存非zero stderrはreason-onlyを維持。実Room activation/auto Memoryでprivate提案の返信・Memory保存拒否とsafe提案採用を対照検証し、再起動原本保持を確認。[証拠](verification/2026-10-07-runtime-secret-reflection/)全gate496成功/14skip/0失敗510tests203files178.37秒、実Jev2319subjects/欠損・エラー・劣化0、DI3成功37ms。既知literal/信頼されたpublic target設定だけの保護であり、未知・変換/auth-cache secret・同UID隔離の保証ではない。全体未達、[次のcan_read境界](superpowers/plans/2026-10-07-session-read-capability.md)へ進む。
