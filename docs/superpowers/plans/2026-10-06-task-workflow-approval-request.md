# AgentのTask提案に拘束した操作Approval要求

根拠: docs/requirements.md のAgent write承認待ち/再開。先にnative要求を小さく実装する。`approval request-task-workflow TASK --room ID --message ID --expected-version N --host URL --effect write|irreversible` は、assigned ExecutionTaskの最新version/owner/active Task Room/原本Agent Message/strict Workflow proposalを検証し、actor=owner、Task/version/Message参照・host/Workflow/input digest/安定request ID/effectを固定する。

1. domain binding検証とDI request service、実CLI要求→human approve→再openのRED。
2. 既存Approval requestOnceを再利用し、read/delegate/network/contact/write capabilityを先行確認。未知参照・owner/version/Room不一致で要求を保存しない。操作を実行せずcredential lookupも行わない。
3. 全check・実jev・独立最終レビュー・記録・main通常push。

この段階はApproval原本の固定だけ。Task状態はassignedのまま、待機/再開executorとhost/Agent allowlistの再照合は次の実装。手動Workflow runへ流用することは既存のactor/Task guardで拒否される。Human本人認証は別要件。
