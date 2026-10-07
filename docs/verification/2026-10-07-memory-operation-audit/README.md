# Memory重要操作Audit

Memory capture/supersede/invalidate/consolidateの成功更新と同じSQLite transactionで不変原本を保存し、mandatory ReaderでcollectAuditへ接続。時刻はadapter clock DIの実保存時刻。過去proposal/review/consolidation requestの時刻と区別。CLIはsystem/local-host、daemonはsystem/core、提案採用は原本Agent、Task review projectionは既知system処理とTask ID。本文/秘密値はAuditへコピーしない。

- RED: 保存済みMemoryの公開Auditゼロ、0成功1失敗60ms。
- 初期GREEN6成功102ms、拡張SQLite/Agent/Sandbox Audit14成功5files198ms。成功原本/入力出力URI、createOnce/replay no-op、更新とAudit両方rollback、replace/update/delete拒否、reopen。
- caller proof3成功73ms。Agent抽出の主体/実保存時刻/再採用で不増、Task review projectionの主体/Task ID、legacy migrationに偽Auditを追加しない。
- 実CLI3成功3files6.28秒。capture/supersede/invalidate/7scope consolidationの公開8field Auditと別process再読取。
- fresh reviewer C0/I0/M0、独立3成功79ms、Ponytail Lean/net0。fixpassなし/再レビューなし。既存transaction wrapper簡素化は今回のdiff外。
- 初回全check520成功21skip0失敗541tests213files186.50秒、type/Oxlint/Oxfmt370files/非空AST/dry-run成功。途中のtest追加後の最終treeは別途final-checkで確定する。
- 実Jev2411subjects146warnings、missing/unsure/review/errors/degraded0。変更source/testに対象あり。抽象failure-path候補は初期拒否/rollback/no-op/reopen/実CLIで照合、具体反例なし。

実人間の本人認証、trusted host DB原本捏造防止、失敗した書込み試行の独立監査は新保証ではない。旧主体はbackfillしない。Session等の残る重要操作/実業務API/全体は未達。

- 最終tree全check terminal0: 520成功21skip0失敗、Ran 541 tests across 213 files. [186.44s]。type/lint/Oxfmt370files/非空AST/dry-run成功。次Session反例はrunning/history2/Audit Reader undefined、合成データのみ。
