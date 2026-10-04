# ExecutionTaskの起動時復旧

目的：DB所有権を取得したdaemonだけが、中断されたrunning ExecutionTaskをfailedへ遷移させる。自動再実行は行わない。既存Message・Artifact・履歴は保持する。

1. DB不要のPortテストで対象限定、期待version、時刻、保存失敗の伝播をRED→GREENで確認する。
2. Session復旧後・socket受付前に配線する。本物のdaemonとSQLiteで、runningのExecutionTaskだけがfailedになり、work_itemとwaiting_approvalが保持されることを確認する。
3. 型・lint・AST・全テスト・実Jevレビューを実行し、独立レビューを行う。

Review Focus: adminの同時更新はexpectedVersionで拒否する。復旧に失敗したdaemonは受付を開始しない。プロセスの子孫終了・stale socket自動除去・自動retryは今回の保証に含まれず、後続のNextとする。
