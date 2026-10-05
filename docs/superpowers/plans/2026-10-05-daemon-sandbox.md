# daemon Sandboxの待機・cancel・drain

既存Sandbox CLI/Docker/Task/Artifactを再利用し、daemonの長期requestと停止境界に接続する。

1. 実callerが必要とする最小SandboxJobsをDI/TDD。初回は一実行slot、同時launchをbusy拒否。Task ID指定cancel、shutdownは新規拒否/abort/完了までdrain。queue/retryを作らない。
2. runSandboxCommandの既存native配線を使いsignalをDockerへ渡す。daemon contextからmanaged jobsで呼び、shutdown/closeでdrainしTask failed/Adapter解放を終えてからdaemon DBを閉じる。directのSIGINT/SIGTERMも同じAbortSignalへ渡しcleanupとfailed記録を待つ。
3. daemon専用sandbox cancel TASK。run clientは5秒timeoutを外しKernel timeoutを待つ。artifact読取は既存経路を使う。remoteのDB/transport変更拒否を保つ。
4. DB不要UTと実daemon/Docker e2eで長期client待機/cancel/Task failed/stop drain/コンテナ破棄/no replay/busy refusal、既存direct経路回帰を確認。全check/実Jev/一final独立レビュー→main記録。

Ruling: 最初は一Docker run slot、throughputの測定が必要になるまでqueue/pool/configを追加しない。SIGKILLの実行中deadlineは既存制約、create-start間stopped containerの既知残留は維持。Taskはcancel時failed、cancel endpointはcancellingを返し実完了はTaskで確認する。実行Audit詳細は次の小変更でTask原記録へ接続し、今回の停止境界と分ける。
Review Focus: 全failureのslot解放/AbortSignal/cleanup/drain、停止後launch拒否、DB close順、他Taskのcancel不可、CLIのfetch timeoutとsocket transport改変拒否、direct回帰。
