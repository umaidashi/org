# Session重要操作Audit

08の未接続項目を、既存Session lifecycle writer/callerと不変session_historyに照合する。Runtime開始/成功/失敗/stop/rebuildを対象とし、既存状態だけで実際に渡したContext本文まで証明したとは扱わない。

1. shared sendSession、manual/runtime/Task/自動wake-upの全caller、stop/rebuild/recoveryを追う。既存不変version原本から投影できる項目と、追加記録が必要な実操作主体/Context参照を分ける。
2. 実Runtime入力はshared sendSessionで一度組み立て、既存Sandboxと同様にSHA-256参照だけをAuditへ渡す。Task Roomの既知Task IDを保持。Session lifecycleの入出力version原本も使い、raw本文を新監査tableへ複製しない。
3. RED: 実Session操作が公開Auditへ出ない。原本の参照/主体/時刻/resultを既存transactionに接続。秘密/生prompt/Runtime auth情報を公開Auditへ複製しない。本人認証を推測しない。
4. 初期拒否でRuntimeゼロ、成功/失敗/stop競合/rebuild/restart/rollback/同時刻順序を、最小DIと実CLIで検証。no-opの重複監査や旧主体の捏造backfillなし。
5. 全check/実Jev/fresh一review/Ponytail/作業ログ/main通常push。

既読Context回収/別process権限原子性/実業務API受入は別残件。Sessionの履歴やAuditの存在をContext bytesの真偽/外部providerの内部実行証明へ言い換えない。
