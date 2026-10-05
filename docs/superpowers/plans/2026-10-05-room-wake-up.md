# Room選択からSession返信へ

既存selectActivationAgentsとSession/Room Runtimeを結ぶ。まずmanual triggerの小さなe2e、次の段階でdaemon pollingへ同じ操作を結線する。

1. LocalAgentRuntimeにopen(agentId,roomId)を追加。既存createSessionForAgentの永続idle生成を再利用し、startもopen→sendへ統一。独立した初回空turnを発行しない。
2. activateRoomMessageにRoom get/messages・Session list・open/reply callbackをDI。選択したAgentだけ、同Roomのidle/failed Sessionを再利用（runningは拒否、stoppedは再利用しない）。既存Agent返信はsource/Agent単位で再利用し、繰返しやpartial retryで返信を増やさない。返却Session/MessageのAgent/Room/source整合も検証する。新しいjournal tableはこのmanual段階では作らない。
3. room activate ROOM --message IDをdaemon専用として配線。既存replyToRoomMessageがhistory/scopedMemoryを構築し永続返信を保存する。長いRuntime turnはclient 5s timeoutを使わずRuntime上限へ委譲。実subprocess fixtureのdaemon e2eでcoordinatorだけ/mention/A2A選択、provider Session再利用、繰返しの重複なし、driver failure、Room履歴/Session保存を確認。全検査/実Jev/独立レビュー→commit。

Review Focus: 全Agentの不要な起動/初回空turnをしない、既存返信を再利用、並列操作でrunningを回避、stop/失敗の状態、Room context保存、安全な長時間transport。provider実行後・返信保存前のcrashでは外部turnが再実行され得る。この実装ではexactly-once/自動再試行を主張しない。durable自動wake-upと復旧は次計画で扱う。
