# Runtime結果の実行参照と明示再関連付け

1. 通常TaskのRuntime返信にhost生成のtaskExecution（Task ID/実行version）を残す。既存reply callbackへrunning snapshotを渡し、通常TaskだけをRoom返信へ結線する。Workflow/Sandbox提案にはこの結果参照を付けない。
2. taskExecutionはroom sendのユーザーmetadataから拒否する。Room/Task IDと正の安全整数versionを検証し、既存返信の別実行への再利用を拒否する。
3. `task recover-result ID --session S --room-message M --expected-version N`でblockedの通常結果だけを再関連付けする。原本Room/Message/Session・実行参照・元running以降のstatus-only履歴・最新version・依存completedを照合する。旧/未対応metadata・別Task/owner・snapshot変更・既存成果物は拒否。現在のRuntimeを呼ばず元返信を成果物にする。
4. 所有SQLite stage障害→原本返信→daemon再起動→障害解除→明示復旧→人間reviewをnative CLIで検証する。DIでは不正参照/古いversion/履歴変更/競合/再stage障害を確認する。全check/実jev/独立PonytailレビューとGitへ記録する。

新table/Port/自動retryは追加しない。旧metadataには実行versionを捏造しない。本人認証や同UIDのDB改変からの隔離は保証しない。Workflow/Sandboxの結果やDB全体停止時の復旧を一般Runtimeの原本再関連付けと混同しない。
