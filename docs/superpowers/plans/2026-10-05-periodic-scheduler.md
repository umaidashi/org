# 定期ScheduleをEventへ接続

Notion07再取得last edited 2026-10-04T01:51:58.336Z、Scheduler/再起動整合性とEvent schedule triggerを実装する。既存Event log→Subscription→Task/Runtimeを使い、別timer/実行queueを増やさない。

1. EventBus.publishOnceをnative SQLite transaction.immediateでTDD。createEventで検証/コピーし、同ID同内容は原本再利用、異内容conflict、保存障害後の再試行/2Adapter/reopen/不変trigger維持を検証。
2. 固定間隔Schedule {id,name,everyMs,startAtMs,eventInput,enabled,createdAt}を純粋domain/必要Port/SQLiteへ保存。CLI schedule create/list/get/enable/disable。UTC canonical startAtと正のsafe整数intervalを境界検証。definitionはimmutable、enabledだけ明示変更。
3. pure dueEventはnow/startから最新のslotを計算、schedule ID/slotをEvent IDとcreatedAtに固定。pollSchedulesは必要PortとnowのDI。既存daemon dispatchの前にpublishOnceし、既存Event routeへ流す。disabled/futureはemitしない。保存失敗をdegradedで公開し次tick再試行、Event保存後crash/再起動でも二重発行なし。
4. 実CLIの定期Event→Agent Task→Runtime成果物とdisable/再open、同じslotの再poll/再起動no duplicateを検証。全check/実Jev/独立レビュー→commit/main。

Ruling: missed slotは最新1件へcoalesceし過去の大量実行を発火させない。cron/calendar/timezone専用APIは未実装、UTC startAt+固定intervalで明示する。costは各missed slotのcatch-upがないこと。既存のimmutable Event logをreceiptとして使いSchedule cursor/二重queueを作らない。
Review Focus: Date/interval overflow、same slot ID/canonical payload/idempotency conflict、時間巻戻り、disabled/future、2Adapter並行/保存障害、参照保持/definition変造拒否、既存dispatch/wake-up停止と状態、空検査なし。

Ruling: domainはUTC epoch millisecondsのstartAtMsを保持し、CLIでcanonical UTC ISOを変換する。純粋domainにDate constructorを持ち込まず既存AST制約を維持する。costはJSONにstartAtMsが表示されること。
