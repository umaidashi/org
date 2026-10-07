# Approval DecisionをMemoryの原本根拠へ接続

Notion03を2026-10-07再取得し、Decisionはimmutable source of truthであることを確認。既存ApprovalStoreの確定decisionを再利用し、新Decisionテーブル/抽出engineを作らない。

1. `memory capture --source-decision APPROVAL_ID`でpendingを拒否し、確定approve/rejectだけを根拠に採用する実CLI RED。DIでreaderなし/別ID/決定なし/読取失敗/保存失敗を確認。
2. canonical URI `org://approvals/ID/decision`をsourceRefsへ保存。request.idとdecision.approvalIdの一致を公開readerで照合。既存source selectorと相互排他、値はDB作成前に検査する。
3. 既存captureMemoryの末尾optional injected reader、CLIの遅延reader/closeへ最小追加。承認を実行/送信せず、不変Decision原本を読取るだけ。approveだけでなくrejectもDecision原本であり、Memory本文の真偽は保証しない。
4. RED/GREEN、全gate、実Jev、一回fresh全単位review、Ponytail、証拠・ログ・Git。自動候補抽出/全Decision種別/本人認証は別未達。Workflowは既存Event receiptsを原本とし、同じ履歴を別storeへ複製しない。
