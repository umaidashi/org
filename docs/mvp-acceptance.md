# MVP受け入れ証拠の照合（2026-10-07）

## 目標と判定

[Notion MVP](https://app.notion.com/p/3ef8a4020cb68173a20be8c050bec268)の6 Phaseと、[全体要件](requirements.md)を維持する。MVPの一周が動くことと、全体の未完了がなくなることは別に照合する。本書は完了宣言ではない。

以下の実機一周のcode baselineはmain `1501862100378cb974fa00e14aa2694f0d49cae6`。当時の通常gateは356成功・12skip・0失敗（368tests/176files）。Artifact読取回収sliceでは384成功・12skip・0失敗（396tests/180files）を確認した（[記録](verification/2026-10-07-linear-artifact-status-recovery/check.txt)）。12skipを実機成功に読み替えず、[当時の通常gate記録](verification/2026-10-07-runtime-room-artifact-content/check.txt)と実機記録の日時・対象を区別する。

## Phaseごとの追跡

| Phase / 明示項目 | 現在確認した実装・検査 | 証拠と不足 |
|---|---|---|
| 1 Agent、Room/Message、Task/ExecutionTask | `src/agents/`、`src/rooms/`、`src/tasks/`と`tests/cli.test.ts`、`tests/room-cli.test.ts`、`tests/task-cli.test.ts`、`tests/session-cli.test.ts` | 通常gateは永続保存/実CLI/原本不変/Task CASを検査。最新のstage/状態更新二重障害の同DB/socket復旧と元返信取得は[復旧](verification/2026-10-07-interrupted-runtime-result-recovery/check.txt)・[取得](verification/2026-10-07-runtime-room-artifact-content/check.txt)。Human/RPC認証は未完了。 |
| 1 Event/Subscription、SQLite、local daemon、CLI | `src/events/`、`src/daemon/cli.ts`、`tests/event-cli.test.ts`、`tests/daemon-cli.test.ts`、`tests/automatic-wake-up-cli.test.ts` | 原本Eventから冪等Task・起動・停止・再起動を通常gateと実機一周で検査。汎用retryや公開HTTP受信は未完了。 |
| 2 Claude Code/Codex CLI、start/resume/stop、Role/instruction | `src/runtime/claude.ts`、`src/runtime/codex.ts`、`src/runtime/port.ts`、`src/sessions/`、`tests/session-runtime.test.ts` | Role/Agent/instructionをargv/inputへ渡す共通Portと両driver。現在mainのClaude二Agent/同provider Session/restartを下記で実測。Codexの実機は[以前の記録](verification/2026-10-04-task-execution/real-codex.txt)で、今回の再実行とは扱わない。完全な物理隔離は未完了。 |
| 3 Projected Typed Memory、scope、4type、extraction、supersede、ContextBuilder | `src/memory/domain.ts`、`src/memory/extraction.ts`、`src/memory/sqlite.ts`、`src/context/builder.ts`、`src/context/port.ts`、`tests/memory-extraction-cli.test.ts`、`tests/context-retrieval-sqlite.test.ts` | 原本根拠/4type/scope/明示採用/置換/有効期間/Context選択を通常gateで検査。現在の実Claude一周はreview-derived MemoryとSession継続を実測。一般意味dedup・conflict推定・自動summary等は要件書の未完了を維持。 |
| 4 scheduler、local event bus、subscription matching、wake-up、coordinator Room policy | `src/schedules/domain.ts`、`src/schedules/service.ts`、`src/daemon/cli.ts`、`tests/schedule-cli.test.ts`、`tests/room-rules-cli.test.ts`、`tests/a2a-proposal-cli.test.ts` | 固定間隔/同slot no replay/coalesceと原本Message→Coordinator→専門Agentを検査。[以前の実Schedule/Claude](verification/2026-10-05-periodic-scheduler/real-claude-max.txt)と現在のコード生成一周を区別。cron/calendar・一般tool loopは未完了。 |
| 5 Docker sandbox、Artifact、n8n WorkflowRuntime | `src/sandbox/docker.ts`、`src/sandbox/artifact.ts`、`src/workflows/port.ts`、`src/workflows/n8n.ts`、`tests/task-workflow-resume-cli.test.ts` | 現在の実Claude→Docker/回収/生成物gate/ローカルGitを下記で検証。n8n invoke/status/cancelとEvent配送は[以前の実n8n](verification/2026-10-05-n8n-workflow-runtime/actual-n8n-test.txt)・[配送](verification/2026-10-05-workflow-subscriptions/actual-n8n.txt)。業務Workflow/一般retry/限定資格情報注入等は未完了。 |
| 6 Linear TaskProvider | `src/linear/read.ts`、`src/linear/import.ts`、`src/tasks/port.ts`、`src/tasks/cli.ts` | 固定GraphQL読取/list→Local WorkItem初回取込/明示refreshまで。Local TaskProviderの同期PortへLinearの非同期write Adapterは接続されていない。human承認付きcommentの別Adapterと一回claim/no replay/Auditを実CLI HTTP fixtureで検証（[証拠](verification/2026-10-07-approved-linear-existing-issue-comment/check.txt)）。不明結果のstatus-only回収を追加（[証拠](verification/2026-10-07-linear-comment-status-recovery/check.txt)）。承認済みHTTPS output ArtifactリンクのattachmentCreateをfixtureで確認（[証拠](verification/2026-10-07-approved-linear-artifact-link/check.txt)）。Artifact不明結果の読取回収をDI/native fixtureで確認。title/description明示更新もbaseline/input固定と一回送信、同Issue slug変更後の次要求/refreshまでfixtureで確認（[証拠](verification/2026-10-07-approved-linear-issue-update/check.txt)）。update不明結果の現在値読取確認もobserved原本としてDI/native fixtureで検証（[証拠](verification/2026-10-07-linear-update-status-recovery/check.txt)）。送信主体は証明しない。status/担当者/labelsの明示UUID選択更新を同じ承認/claim/observe経路でfixture検証（[証拠](verification/2026-10-07-approved-linear-field-update/check.txt)）。Core対応/同期・実API送信は未完了。HTTP fixtureを実Linearとは扱わない。 |
| 6 GitHub events、Notion knowledge/docs | `src/events/github.ts`、`src/events/github-webhook.ts`、`src/knowledge/notion.ts`、`tests/github-events-cli.test.ts`、`tests/notion-knowledge-cli.test.ts` | GitHub公開GET/署名CLI取込とNotion HTTP contractは実装。Notion connector読取はできるがCLI REST資格情報とは別。公開Webhook実配送/private poll/Notion CLI実認証は未完了。 |
| 6 NATS/Redis if necessary、CLI/TUI既定 | `src/events/port.ts`、`src/tui/`、`tests/tui-cli.test.ts` | Local DB busとread/chat TUIを使用。NATS/Redisを必要なく追加しない。TUI本人認証/streaming/Task操作は要件書の未完了を維持。 |

## 現在の実機一周

`ORG_CLAUDE_CODE_TEST=1 ORG_GENERATED_GATE_TEST=1 bun --no-env-file test tests/coordinator-claude-real.test.ts`を上記mainで実行。7成功・1skip・0失敗、99.35秒。実コード生成一周97.64秒、explicit-any生成物の実Oxlint拒否1.61秒。[記録](verification/2026-10-07-mvp-acceptance/check.txt)。

固定HTTP fixtureの既存Linear WorkItemから、実Claude Max Coordinatorと専門Agentの内部Execution、実Dockerで生成Bunテストを非ゼロ件再実行、独立assert、隔離した生成物`bun run check`、承認済み元Artifactのowned local Git/bare remote受渡し、人間review、根拠付きMemory、同provider Sessionと再起動後の重複なしを確認。raw Artifact/資格情報を公開ログやJevへ送信しない。算術のみの別opt-in一周は今回skipであり成功に含めない。

## 未達と次の実装

1. Agent専用scope/credential、owner Task Messageからの操作承認、Runtimeの操作待機、人間承認後のTask再開、blockedのstatus-only観測、receipt Artifactと人間結果reviewまで実CLI/daemon fixtureで確認した。content/fields、並行操作、保存障害、SIGKILL/再起動も確認（[証拠](verification/2026-10-07-runtime-linear-resume/check.txt)：445成功/12skip/0失敗）。[実Claude Maxの受け入れ](superpowers/plans/2026-10-07-runtime-linear-real-claude.md)もcontent/fieldsで確認した（[証拠](verification/2026-10-07-runtime-linear-real-claude/check.txt)：447成功/12skip/0失敗、Linearは固定HTTP fixture）。Core status/Agent owner対応・自動同期は未達で、同期Coreを暗黙に変更しない。
2. 実Notion/Linear native認証は設定後に確認。キー値は不要で、以前の設定有無確認はfalseだった。connectorから秘密キーを取り出したり、fixtureを実認証に読み替えたりしない。
3. 既存業務Issueと変更先repoを確定してDraft PRまで一周する。現時点のorg GitHub open Issueは空、Linearのorg/Kernel/AIカンパニー検索も空。別対象の不存在を断定せず、既存の対象指定質問を維持する。新Issue・任意の業務writeは行わない。
4. 全体要件の他の未完了を保持し、Org Deskの未決定設計・将来Adapter・heavy GUIを勝手に確定しない。MVP証拠があっても全体目標はactive。

[Linear API公式資料](https://linear.app/developers/graphql)・[ページング](https://linear.app/developers/pagination)を外部Adapterの仕様確認に用いる。SDKや新規依存を、既存HTTP境界で足りる段階では追加しない。
