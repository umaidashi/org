# Task更新の重要操作Audit

既存Task execution Auditはstatus historyからの投影。再照合するとTask review原本はあるがcollectAuditにreview専用投影はなく、旧棚卸しの「review接続済み」は訂正が必要。手動CRUD/comment/artifactとimport/adopt/sync/review/result-stageの共有SQLite writerを対象にする。

1. RED: 保存済みTask作成/更新/comment/artifact/reviewが8field操作Auditへ出ない。既存Task history/comment/artifact/review原本URIを再利用し、内容を別tableへ複製しない。
2. 新規成功操作の最小監査metadataを同writer transactionで不変保存。CLI local-host/Coreの実主体と実保存clockをDI。review.actor/comment.actorのkind不明scalarを推測したhumanへ変換しない。明示源Actor/Task/Event/Approval contextが分かるcallerはtyped contextで保持する。
3. createAssigned/import/sync no-op/replayは追加しない。新規adoptionの内部二versionを一つの操作として記録。stage resultとreviewは既存transaction/history/source refsを使用。既存task.execution投影を納品・実Runtime証明へ広げず維持し、操作metadataと意図を区別する。
4. 障害時のTask/原本/Audit rollback、immutability/legacy無backfill/同時刻順序/reopen、actualCLI create/update/comment/artifact/reviewとCore idempotent callersを検証。
5. mandatory Task Reader、全check/実Jev/fresh一review/Ponytail/作業ログ/main通常push。

Event/Subscription/Scheduleの操作別Audit、実業務Issue/変更repo/API認証と納品受入は次の残件。全readや汎用監査engineを増設しない。
