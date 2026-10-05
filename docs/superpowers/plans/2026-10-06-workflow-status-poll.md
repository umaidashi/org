# 起動済みWorkflowのstatus-only自動観測

Notion Securityの実行境界/承認/重要操作AuditとMVPの自律実行に照合。`daemon --workflow-config PATH --observe-workflows`だけを明示opt-inし、既存blocked Executionとworkflow.unconfirmed(phase=observation)を選択して既存observeTaskWorkflowへ渡す。新invoke/Approval claim/Runtime turnは行わない。未起動Approval待ちは除外する。

Ruling: まずstatusを一回読むreadyOnly経路を既存observerへ追加。有効なpending応答はblockedのまま、履歴を増やさない。terminalは既存再認可/CAS/Artifact/review待ちへ渡し、失敗/不明/資格情報例外は既存例外としてwake-up failureにする。自動再invoke/一般retry/業務Workflowは含まない。既存manual observeの待機動作は維持。全履歴scanは既存event journalと同じ最小実装、規模が増えたらindex付きqueryへ。

1. readyOnly pending/terminal UTとpoll selector/cancel/error、daemon flag RED。
2. 既存observer/daemon tickへ接続、pending no historyとterminal artifactをGREEN。
3. native HTTP fixtureでpending→success/再起動→一回invoke維持、manual経路回帰、全check/実jev/独立review一回・Important一fixpass、Git/main push。

Review Focus: pendingでも現在authority/receipt/identity照合、status-onlyによる新invokeなし、読取中version競合は既存CASで拒否。複数Taskは個別観測を続け、例外を最後に集約してpoll失敗を報告、次tickに再評価（再invokeなし）。同UID local adminのdaemon boundaryを本人認証済みと主張しない。
