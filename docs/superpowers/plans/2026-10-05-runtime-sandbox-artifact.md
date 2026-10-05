# Runtime返信からSandbox成果物へ

既存Task実行・Sandbox producer・単一実行slotを再利用する。Agent返信を不変Messageとして保存した後、hostが指定するpolicyで権限を再確認し、native Dockerの成果物をwaiting_approvalへ保存する。既定のMessage成果物は維持する。

1. Task実行へDIされた成果物producerを接続。running snapshotと検証済み返信だけを渡す。producer失敗はfailedへ記録し、成果物をstageしない。最小UT RED/GREEN。
2. Sandbox保存処理を再利用し、running version・最新owner/capability・Room・strict proposalを実行直前に確認。
3. daemonの明示host policyと既存SandboxJobsへ接続。policyなしは既存動作。実CLI/native Dockerで実行・停止・レビュー・Memoryまで検証する。
4. 生成コードのcheck、全check、実Jev、独立レビューと一回の修正、通常main push。

汎用tool frameworkやqueueは追加しない。全体完了はrequirements.mdの未完了項目で別途判断する。
