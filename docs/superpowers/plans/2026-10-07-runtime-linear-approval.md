# Runtime Linear提案からhuman操作承認待ち

Spec: [要件](../../requirements.md)、Notion 04/06/08。外部WorkItemと内部Executionを分離し、既存Runtime・Task状態機械・Task-bound承認を使う。

## Task 1: Native Runtime提案の承認待ち

1. 実CLI/daemon/native SQLite/Runtime fixtureでcontent/fieldsの提案→running原本Message→Agent操作Approval→artifactなしwaiting_approval→human approve/reject→再起動no Runtime replayを検証する。
   Expected: 新opt-in未対応またはApproval欠落でRED。
2. 明示daemon `--linear-updates`とhost Issue/write scopeに一致するExecutionだけを対象にし、Sandbox/Workflowとの曖昧選択を拒否する。host config loaderを共用し専用read credentialだけ与える。既存承認requestへtrusted running phaseを追加し原本versionを維持。既存assigned CLIを緩めない。
   Expected: focused native/DI green。承認要求に外部mutationなし。scope/capability/原本変化/保存失敗は先行拒否しfalse pendingを返さない。
3. 全check・非空dry-run・実Jev・Ponytailと独立正しさreview、ログ・Git・main通常公開。
   Expected: 全gate終了0、実行件数/skip/判定欠落を確認して記録。

Interfaces: running phaseは既存requireTaskOwnerMessageへ委譲する。Taskのartifactなしwaiting_approvalはrunExecutionTaskが保存し、新状態/DDL/依存を追加しない。承認requestとTask遷移は別保存で原子性を保証しない。起動時の既存原本返信回収は外部operation実行ではない。

Review Focus: assigned管理経路の互換性、未一致scope/readonly/権限不足、親WorkItem version、Runtimeへのcredential流出、HTTP中原本変化、Approval保存/Task状態保存障害、再起動の承認原本保持。実API認証・Agent本人認証・承認後Task再開/観測・実業務Draft PRは次の全体残件として保持する。
