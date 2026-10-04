# Agent reportsToの組織関係

Notion01を再取得しsnapshotと同じ更新時刻を確認。Chiefから専門Agentへの委譲の前に、永続IdentityのreportsToを小さく追加する。

1. Agentのoptional reportsTo、変更のpure判断/DI service。存在しないAgent/上司、自分・間接循環を拒否。上司解除を可能にし、ID/名前/role/runtime/createdAtは保持。DB不要UTをRED→GREEN。
2. Agent所有SQLiteにnullable reports_toと追記履歴をadditive migration。BEGIN IMMEDIATEで現在graphを再取得/検証し、変更と履歴を一括保存。既存Python schema互換・競合循環拒否・失敗rollback・原履歴不変を検証。
3. create --reports-to ID、report ID --to ID または--clear、reporting-history ID、list --jsonでreportsTo。実daemon CLIを検証し全検査/実Jev/独立レビューを記録。

Review Focus: 変更前のservice判断だけを信用して同時変更のcycleを通さない。rootにはreportsToを付けず旧list JSONを維持。繰り返し同じ関係にする操作は追加履歴を作らない。capabilities/permissions/memoryPolicy、typed A2A・自動委譲は後続であり、組織登録だけで権限を与えない。
