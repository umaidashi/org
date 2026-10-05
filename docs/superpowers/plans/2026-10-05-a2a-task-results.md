# 委譲成果をtyped A2Aで返す

既存Task結果/typed A2A/immutable Room Messageを再利用。新しいqueue/tableは作らない。

1. pollDelegationResultsを必要Portとclock/identity/signalのDIでTDD。active Roomの検証済みdelegateごとにnamespaced子Taskを参照し、owner/source/parent整合を検証。waiting_approval/completed、またはfailedの結果を宛先→元送信者のreplyTo/correlation保持typed result（成果物なし失敗はblocker）で保存。payloadはexecutionTaskId/status/version/outputArtifacts参照、raw provider errorなし。既存返送を検証して再利用し、保存直後crash/再起動で二重返送しない。
2. opt-in wake-upの同じworkerでTask実行の後に返送。Taskは先に結果/承認待ち保存済み、返送失敗でTaskの成果を失わない。次tick/restartで返送だけ再試行。通常A2A resultのactivationは既存selectorを使い、普通のAgent返信は連鎖しない。
3. 最小UTと実daemon e2eで委譲→Task→typed result→Coordinator返信/成果物参照、失敗blocker/別Task継続、再起動でturn/返送増加なし。全check/実Jev/独立レビュー/実Maxを検証→commit/main。

Ruling: 原Room archiveなら返送を延期しTask結果は保持。結果通知は成果物がレビュー可能になったことを表し自動承認しない。初回返送のstatus/versionを不変保存、後続の人間レビューdecision通知は別変更。costは後続レビュー状態がTask側の参照になること。
Review Focus: 未作成TaskとDB障害の区別、偽装typed返信/別Task/異なるartifactの再利用拒否、原参照/owner/parent、結果失敗時Taskをfailedへ戻さない、同一worker停止/非並列、返送後crash復旧、ループなし。
