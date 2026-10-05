# Auditに基づく小さなCLI監視

根拠: docs/requirements.md のCLI logs。既存の不変Audit projectionを再利用し、`org logs [--task ID] [--event ID] [--limit N] [--json]` を実装する。新しいログDB、本文・資格情報の表示、followは追加しない。通常はdaemon経由、明示的--directは管理操作。

1. DBなしのfilter/limit UTと実CLIでREDを確認。
2. 読取Portを注入するAudit収集serviceを既存audit listと共有する。時系列の因果順序を維持し、完全一致filterをAND適用後に末尾N件を返す。limitは1..1000、未指定100。
3. 実CLI GREEN、全check、実jev、独立最終レビュー。文書・結果・未完了を記録しmainへ通常push。

レビュー重点: DB作成前の入力拒否、filter順序、既存audit互換、接続解放、秘密本文を増やさないこと。TUI/継続監視は次の検証単位。
