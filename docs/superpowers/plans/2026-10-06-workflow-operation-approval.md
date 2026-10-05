# Workflow操作Approvalの最初の検証単位

全体目標はAI Company Kernel。直前のread_only Task委譲を、重要操作の承認なしに書込みへ広げない。

最初の単位は既存の不変Approval request/decision/AuditにWorkflow操作を追加する。対象host・Workflow ID・入力digest・一回のrequest ID・effect(write/irreversible)を固定し、秘密や入力本文を保存しない。CLIからrequest/get/decide/auditを実行でき、人間だけが判断する。Permission変更は既存kindだけをapplyする。異なる操作への承認転用、二重判断、idempotency衝突を拒否する。

RED: Workflow操作のrequest保存とCLI要求が現在拒否されること。GREEN: 純粋domain、SQLite不変保存、実CLIのrequest→human decision→audit。全checkと実Jev、branchごとの最終独立レビューを行う。

この単位で外部書込みを実行しない。次の単位でhost policyとnative invokeに承認の完全一致と一度きりclaimを接続する。現在のAgent read_only制限は維持する。local human IDは自己申告であり認証機能ではない。
