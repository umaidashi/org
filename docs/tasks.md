# Taskのローカル実装

NotionのTaskProviderを `src/tasks/port.ts` で定義し、SQLite実装を `src/tasks/sqlite.ts` に置く。WorkItemとExecutionTaskはkindで区別し、内部Jobを外部Issueへ同期することはない。外部Provider/同期は未実装。

```sh
npm start -- task create '認証機能' --objective '認証APIとテストを完成させる' --json
npm start -- task create 'schema調査' --objective '変更点を決める' --kind execution_task --parent TASK_ID --json
npm start -- task assign TASK_ID --owner AGENT_ID --json
npm start -- task update TASK_ID --status running --json
npm start -- task get TASK_ID --json
npm start -- task history TASK_ID --json
npm start -- task list --kind execution_task --status running --json
npm start -- task comment TASK_ID --actor human --body '確認しました' --json
npm start -- task artifact TASK_ID --artifact RESULT_ID --uri file:///tmp/result.txt --direction output --json
npm start -- task comments TASK_ID --json
npm start -- task artifacts TASK_ID --json
```

`--dependency` と `--label` は複数指定可能。priorityは0以上の整数で既定0。createではstatus/ownerは指定せずpendingで作成してassignする。ownerは登録済みAgentのID。親・依存も既存TaskのIDで指定する。

状態変更は明示的な遷移表を使う。pending→assigned、assigned→running、running→completed/failedが基本。blockedとwaiting_approvalからの復帰も許可する。依存未完了ではrunning/completedを拒否する。completed/failedへの通常更新は拒否する。成果物は終了後の回収に対応して追記できる。

状態とversion付きの全snapshot履歴は同時保存する。SQLiteの書き込みロックの中で最新状態を読み判断し、途中失敗はrollbackする。ProviderのexpectedVersionは古い呼び出し元の更新を拒否する。コメントと成果物参照も原本を書き換える操作は提供しない。

TaskArtifactは現在URI参照のみ。ファイル回収・権限・URIアクセスは行わない。Priorityによる自動dispatch、外部同期、Execution process、Approvalは別の未完了領域。
