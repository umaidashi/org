# Agent構成Audit

trusted local host CLIのAgent登録/報告先変更を、既存writer transaction内の不変構成原本へ接続。既存ReportingHistoryとCapabilityChangeは維持し、共通collectAuditで8fieldを公開。実CLI actorはsystem/local-host、actor未指定の内部呼出はsystem/unspecified。本人認証や旧データの実主体を推測しない。旧DBを偽の過去記録で補完しない。

- AuditゼロのRED→SQLite focused12成功141ms。登録/変更とAudit障害のrollback、no-op/不変trigger/reopen/旧DB無backfillを検証。
- 初回既存Approval CLIは登録Auditが増え3期待→4で失敗。承認固有assertを登録以外へ限定。native5成功2.43秒、daemonの8field/停止後direct reopen/追加direct操作、既存ログ・Task Auditを確認。
- fresh reviewer P2一件: 同時刻sequenceが1,10,11,12,2…になる。最新ログの誤表示としてImportant、12操作RED→既存causalId/stable sortを1行で再利用、final focused4成功1.52秒。一fixpass/再レビューなし。Ponytail Lean/net0。
- final全check515成功21skip0失敗536tests210files184.88秒、type/Oxlint/Oxfmt367files/非空AST/dry-run成功。実Jev2388subjects145warnings/missing・unsure・review・errors・degraded0。新test/sourceもbyFile対象あり。

trusted hostが原本DBを捏造できる場合のauthenticity、全重要操作/全resource permissions/実サービス業務受入は別。既存人間permission変更Approvalを置換しない。
