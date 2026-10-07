# Agent構成操作のAudit

[棚卸し](../../important-operation-audit-inventory.md)の最初の不足。実callerはapplication CLIのAgent register/reports-to。trusted local hostからの操作と記録し、未提供の本人認証を推測しない。

1. 実SQLite登録/報告先変更→Audit欠落をRED。旧DBの主体不明を偽のhuman履歴へbackfillしない。no-op/失敗rollback/不変原本/reopenを検証。
2. Agent Adapterの既存transaction内に最小の構成操作原本を保存。登録と報告先操作のresource refs/時刻/結果を持ち、内容/秘密はAuditへコピーしない。共有writerへ実操作主体をDIし、既存ReportingHistoryやCapabilityChangeを重複しない。
3. 既存collectAuditへ投影し、実CLI direct/daemon/restartで8field・順序・原本を確認。全check/実Jev/fresh一review/Ponytail/公開Git記録/main通常push。

Agent resource permissions/Memoryその他の重要操作/実業務APIと全体は別残件。新Actor認証・policy engine・Audit daemonは作らない。
