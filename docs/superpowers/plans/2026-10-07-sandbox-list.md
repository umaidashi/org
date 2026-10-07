# daemon管理中Sandboxの一覧

Notion07の`org sandbox list`を既存`SandboxJobs`の一slotとthin clientへ接続する。daemonが現在所有するjobの一覧であり、Docker全container/別daemon/終了履歴/Task状態を混同しない。

1. native daemon e2eの既存cancel fixtureへlist空→running→cancel/drain後空を追加しRED。純粋jobs testで実Promise稼働中running/abort後cancelling/解放後空を確認する。
2. `SandboxJobs.list`をprivate active/controllerから最小projectionとして返す。taskId/stateだけでsignal/controller/completion/credentialを公開しない。追加DB/DDLやDocker ps呼出しなし。
3. parserはtarget不要のlistを明示し、未知option/余剰targetはDB/network前に拒否。applicationのdaemon依存へlistを注入しdirectは失敗させる。既存run/cancel/artifactは維持。CLI JSONは配列、read-onlyでslot/Taskを変更しない。
4. DI/native/full local gates/実Jev/Ponytail/一回fresh reviewを記録し、要件のCLI gapだけ更新する。一般retry/credential/Audit/実API/全体完成を推定しない。
