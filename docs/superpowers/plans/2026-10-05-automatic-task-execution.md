# EventのExecutionTaskを自動実行

Notion09 MVPのイベント→永続Agent→Memory→Task実行をつなぐ。既存Event dispatch、TaskProvider、Room/Session、runExecutionTaskを再利用し、別queue/tableを増やさない。

1. pollExecutionTasksをDI/TDD。assigned execution/ownerあり/依存completedだけ。既存active Task Roomを再利用、なければownerが参加するTask Roomを作る。Task/versionをmetadataへ記録したAgent入力Messageを再利用、idle Session再利用/open、既存runExecutionTaskでrunning→結果Artifact→waiting_approvalへ。入力はTaskobjective、ScopedMemoryは既存RoomRuntimeが構築。WorkItem/未割当/失敗/承認待ちは実行しない。busy Sessionは延期。AbortSignalで次Task前に終了。
2. --wake-upの同じ単一async workerでRoom wake-up後にassigned Taskをpoll。共通runTask callbackをmanual/autoで再利用。準備エラーはassigned現versionのままならfailed、Runtime後の失敗/CASは既存実行操作の履歴を守る。起動時running Task recoveryは既存のまま。Taskごとの失敗で他Taskを止めない。
3. 実daemon fixtureでEvent publish→Subscription→assigned Task→Task Room/Memory/context→Runtime返信→成果物/waiting_approval→明示approveを確認。再poll/再起動でturn/成果物が増えない、driver失敗/dependency延期/cancel後未実行Taskを確認。全検査/実Jev/独立レビュー・実Maxのmarker Event e2e→commit。

Review Focus: WorkItemを実行しない、割当/参照/依存/owner/activeRoom、TaskCAS/原本の既存不変条件、余分な初回turnなし、結果を自動承認しない、停止後claimしない。自動retry/権限の拡張/外部副作用は追加しない。Runtimeの既存read-only/toolsなし境界を維持する。
