# 共通TaskProviderの承認付きwrite

[全体計画](2026-10-07-common-linear-task-provider.md)・[実consumer計画](2026-10-07-async-task-provider.md)の残三操作。既存Approval/claim/receipt/観測を再利用し、新mutation engineを作らない。

1. updateのCore patchと外部入力の境界を先に検証する。既存state/ownerの逆引きは一致が一つだけの時に許し、欠落・曖昧さをcredential/保存前に拒否する。labelsは表示名からUUIDを推測せずhost明示対応を用いる。priority/contentとfieldsを一回の承認対象として表せるよう、既存field mask・digest・response検証・receipt観測の全callerを確認してTDDで拡張する。既存承認の互換と不明結果の再送禁止を維持する。
2. 共通update consumerをLocal/Linearへ接続する。actor/expectedVersion/承認IDは操作contextとして明示する。外部write成功とCore mirror同期失敗を同一視せず、receiptから回復できる結果を保つ。Local Executionの状態機械を緩めない。
3. addCommentは既存commentの承認、UUID/idempotency、claim、receiptを消費する。Localの原本記録との役割を明示し、未承認や重複再送を共通consumer/native daemonで拒否する。
4. linkArtifactは既存Local output原本を先に確定してから、そのversion/URIで外部リンクを承認する。承認前の原本stageと外部writeを別の可視操作にし、method内の隠れたstageやwrite後throwで半成功を隠さない。Local input/outputとの共通契約を定める。
5. 実際に使うmethodのみ追加し、同じCore consumerで両Adapterの六操作を検証する。小さなRED/GREEN、全check、実Jev、Ponytail/独立安全性review、公開ログを継続する。実API認証・本人認証・実業務納品と他の全体残件は別途維持する。
