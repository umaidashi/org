# Agentの監査ログtail

Notion07の`org logs tail AGENT`を既存collectAudit/selectAuditLogsへ接続する。明示Agent actorの最新ログsnapshotを返す。実行時stdout/他humanの操作をAgentの発言と装わない。通常のtail同様、引数だけでは継続followしない。連続stream/新ログ基盤は要求が出るまで追加しない。

1. 既存logs CLI fixtureで二Agentの実Execution/Approval Auditを作り、`logs tail AGENT --limit N --json`が他Agentを除外し最新N件を返すRED。普通のlogs/task/event filterを維持する。
2. LogFilterにagentIdを追加し、AuditEntry.actorのagent/idを純粋に照合してから既存limitを適用。Taskの現在ownerを過去ログの主体へ付け替えない。missing/空Agent/未知verb/余剰target/不正limitはparserで拒否。既存Agent registryで対象が登録されていることを管理compositionで確認する。
3. direct/daemon/native/reopenで実同contractを確認。保存原本/Task/runtimeを変更せず、daemon薄client/既存Auditを再利用。JSONはAuditEntry配列でinput/output/approval refを保持する。
4. 指針/リファレンス/Ponytail/full local gates/実Jev/一回fresh review/ログ/証拠/Gitを維持。全重要Audit収集、本人認証、stdout stream、全体完成とは区別する。
