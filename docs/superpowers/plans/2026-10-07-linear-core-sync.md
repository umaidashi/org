# Linear Core snapshotの永続同期

[共通Provider計画](2026-10-07-common-linear-task-provider.md) Task1の続き。[責任境界](../../task-provider-design.md)、Notion04/08、既存Linear import/refresh/Task SQLiteを基準にする。

1. 既存外部WorkItemだけを対象に、明示expectedVersionを伴うopt-in CLI同期をREDから実装する。既存refreshの契約を変えず、ExecutionTask/別Issue/外部参照不一致を取得前に拒否する。
2. 同期時に外部title/objective/status/owner/priority/labelsだけを合成する。Local parent/dependencies/artifacts/createdAt/id/kindを保持し、外部日時は読取の鮮度情報として扱う。Local versionとupdatedAtはcommit時の値。新DDLや汎用sync engineを作る前に既存Task/履歴transactionを再利用できるか確認する。
3. 外部WorkItemのsnapshot更新は内部ExecutionTaskの状態遷移ではない。外部terminalの再openと無担当statusを、内部terminal不変条件やExecution結果受理から切り離す。domain/Task参照/autonomy/review/resultの全callerを照合してから保存境界を決める。型だけを広げて既存Local保証を弱めない。
4. 取得前・取得後・保存時CAS、取得中のAgent登録変更、無変更時no新履歴、保存障害rollback、関係/artifact/history原本の保持、再openをDI/実SQLite/別process CLIで確認する。外部readとLocal commitの跨system原子性は保証しない。
5. 各検証単位でfast UT/全check/非空dry-run/実Jev/Ponytail/独立正しさreviewを行い、証拠と判断をwork-logへ保存、通常mainへ公開する。全共通六操作/実API/全体goalはこの同期だけで完成扱いにしない。
