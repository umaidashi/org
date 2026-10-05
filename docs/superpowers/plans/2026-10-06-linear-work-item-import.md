# 既存Linear Issue→local WorkItem

新Issue/mutationを作らず `task import-linear ISSUE_ID` で既存read DTOをlocal work_itemへ取込む。Coreにvendor schemaを持込まずlinear serviceで既存createTaskを使い、stable `linear:issue:UUID` IDとexternalRef URL、identifier label、本文出典を保持する。Task statusはlocal pending、外部workflow状態の同期とは扱わない。

必要な追加Port操作だけをDIする。Task SQLite所有者がBEGIN IMMEDIATE内で初回Taskとhistoryを原子的に保存。再取込は初回履歴と時刻以外の全Taskを照合し、同じ内容なら現在Taskを返してlocal進捗を巻戻さない。外部内容変更は明示conflictで、自動上書き/双方向syncは後続。新履歴/Taskの二重作成を防ぐ。Task create失敗時rollbackは実DB triggerで確認する。内部execution_taskは既存--parentで別に作り、外部queryが増えないことを確認する。

1. DI service未実装/native once operation未実装/実CLI未対応RED。
2. 小serviceとnative atomic once、既存taskCLIをGREEN。
3. 既存HTTP fixture CLIを拡張しimport/reimport/reopen/local更新保持/child分離を確認。native rollback/concurrent接続/conflictも検証。
4. 全check/実jev/独立最終review一回、必要Important一fixpass、docs/Git/main push。
