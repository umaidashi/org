# Task成果物の人間レビュー

目的：waiting_approvalのExecutionTask結果を、確認したversionに対してapprove/rejectできる。actor・理由・対象成果物・時刻を不変記録としてTask遷移と一緒に保存する。

1. pure判断とPort serviceのDB不要UTをRED→GREEN。空欄・対象状態/kind・成果物なし・古いversionを拒否する。
2. Task所有SQLite Adapterでreview record、状態/履歴を一つのBEGIN IMMEDIATEに保存。競合・rollback・UPDATE/DELETE/REPLACE拒否を本物のDBで検証する。
3. `org task review ID --decision approve|reject --actor HUMAN --reason TEXT --expected-version N`と`task reviews ID`。実daemon経由のe2e、全検査、実Jev、独立レビューを記録する。

approveはcompleted、rejectはfailed。結果確認のローカル管理操作であり外部副作用を許可するApprovalではない。actorはローカル操作側が指定する記録値で、認証済み本人という保証はしない。専用Permissionと外部操作Approvalは後続。

Review Focus: 古い成果物への承認にならないexpectedVersion、原本の不変性、決定保存失敗時の状態/履歴rollback。既存管理用task updateは残り、このAPIのみを使用したという認可保証は後続Permissionで扱う。
