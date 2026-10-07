# 成功済みWorkflowのArtifact保存復旧

1. 既存native e2eへ所有Artifact保存先を一時的に通常ファイルで塞ぐ障害を追加する。Workflow成功後にTask failedとなるREDを確認する。
2. 保存例外を既存TaskResultPendingErrorへ変換しblockedを維持する。成功terminal receiptがあれば既存observeで結果保存を再開できるようにする。
3. 明示opt-in pollingも成功terminalとblocked Taskの組合せを選択する。権限・元Approval・Task履歴・execution/status照合を省略せず、外部invokeを繰り返さない。
4. 保存先復元→manual/auto観測→Artifact→人間reviewを実CLIで確認し、全型/lint/AST/テスト・実jev・独立/Ponytail reviewを実施する。

新Event形式/Task state/Port/retry frameworkは追加しない。自動保存再試行は既存host poll間隔に従う。一般backoffや部分blob破損の修復は別の未完了事項として明示し、この保存先障害の検証だけで全Artifact障害の完了を主張しない。
