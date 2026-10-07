# Agentの明示Room resource permission

01のAgent.permissions未実装と08のpermission変更承認を、現在のRoom Context送信経路へ接続する。formatは原文未定義なので最小の具体契約を採る。

Ruling: permissionsはまず閉じた `{rooms: string[]}`。存在すればRoom allowlistにないContext送信を拒否し、空配列は全Room拒否。未設定の旧Agentは既存参加者/can_read制約を維持。線形Issue/workflow/credential grant等の既存host resource guardを置換せず追加制限とする。汎用policy engine/ワイルドカード/組織Role継承を作らない。

1. 小さなDI RED: 同じ参加者/can_readでも明示policyなしRoomのcreate/start/postRuntime保存を拒否。許可Room/旧Agent対照、closed schema/duplicate/malformed拒否。
2. Agentの純粋permissions型/strict validator、SQLite保存/旧DB移行。既存Approval agent_capabilities operationとCAS履歴へoptional permissionsを追加し、未指定は現在policyを保ち、指定変更は同じhuman approval必須。初期trusted host登録は既存capability bootstrapと同じ扱い。新kind/別revision/storeなし。
3. 共有sessionAgentでチェックし全Session/Room/Task callerを照合。permission変更後再開/完了保存のguardは既存再照合を再利用。実CLI direct/daemon/reopenで許可/拒否/Approval/履歴/Auditを確認。
4. fullcheck/実Jev/fresh一review/Ponytail/README/要件/ログ/証拠/Git/main通常push。

これはRoom Context権限の具体実装。全resource権限の一元永続化やOS同UID隔離、外部API認証ではない。Memory等の重要操作Auditと実業務受入も別残件。
