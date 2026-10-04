# daemon強制終了時のRuntime監督

目的：daemonがSIGKILLされた時、Runtimeと同一groupの子孫も終了する。OSが閉じる親→監督stdin pipeをlifelineとして使い、PID pollingには依存しない。

1. 実processの親がrunProcessを実行しdriver/孫のPIDを記録、親だけSIGKILL。driverと孫が終了するe2eをRED確認。fixtureはfinallyで掃除する。
2. Bunで最小監督processを起動。stdinの最初のJSON行でargv/inputを渡し、pipeは開いたまま保つ。監督はpayloadを受けてdriverを同じgroupで起動、pipe EOF/エラー時に自身のgroupを停止。stdout/stderrは透過する。秘密をargvに載せない。
3. 既存process契約・build成果物を検証。静的検査・全テスト・実Jev・独立レビューを記録。

Review Focus: parentdeathがpayload送信前/実行中でも残らない。コードを埋め込む監督関数はself-containedで、Bun build後も動く。stdin/env/exitCodeの契約維持。新しいruntime起動失敗を成功に変えない。子孫のsetsidによるgroup離脱はSandboxの後続課題。
