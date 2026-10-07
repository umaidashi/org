# 重要操作Auditの棚卸し

2026-10-07、`collectAudit`と実際のwriter/callerを照合。08の重要操作とは、外部副作用、権限/組織の変更、永続的な業務状態やMemoryの更新、Agentへ私有Contextを渡す操作。デバッグ読取、Docker setup各コマンドを別domainとして増やさない。

| 操作 | 現在の原本/公開Audit | 判定 |
|---|---|---|
| capability変更/human承認 | ApprovalとCapabilityChange、不変8field Audit | 接続済み |
| Workflow invoke/status/cancel | Event/Approval/result原本 | 接続済み |
| Sandbox実行 | started/completed Event、Task/Artifact/実行主体 | 接続済み。完了権限の再照合を追加検証中 |
| Linear Agent read/write/comment/artifact | scoped read Event、承認write/receipt | 接続済み。実API認証は未証明 |
| Task execution/review | Task history/result/reviewからAudit | 接続済み。全手動Task CRUDの実行主体は同じ証拠ではない |
| Agent登録/報告先変更 | Agent row/ReportingHistory | 不足。登録の不変操作原本なし、報告先履歴に操作主体なし |
| Memory capture/supersede/invalidate/consolidate | 不変Memory/invalidations/receiptとsource refs | 不足。内容原本があるが8fieldの操作主体/入力出力参照へ未接続 |
| Session Context送信/停止/rebuild | Session/Room/Messageの原本と状態履歴 | 不足。Runtime呼出の重要操作Auditとして未集約 |
| Room/Task/Event/Subscription/Schedule設定 | 個別状態/Message/Event/履歴 | 操作別に未照合。全件充足と認定しない |
| Runtime/credential/resource grant config | trusted host設定ファイル | DB内の権限変更Auditとは別。設定をAPI秘密値付きで記録しない |

Ruling: 原本が存在するだけで8field Audit完了としない。一方、過去の主体不明データを推測したhuman/Agentとして補完しない。新しい実操作から最小限の原本を同じwriter transactionに保存し、既存`collectAudit`へ投影する。完全な別監査engine/全低水準コマンド追跡は作らない。

次はAgent登録/報告先の実callerから進む。これは組織と委譲先を変更する具体的な操作であり、未記録を任意の「管理操作だから対象外」にしない。全重要操作・全体は未達。
