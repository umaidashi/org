# Agent承認のLinear更新実行・観測

Spec: [要件](../../requirements.md)、Notion 04/08。前のTask-bound承認原本を使い、Agent actorを人間へ書き換えず実行する。

1. `task apply-task-linear-update EXECUTION --approval APPROVAL`と`observe-task-linear-update`の実CLI RED。content/fieldsの成功/不明結果/stale baseline、pending/reject、並行apply一回、並行observe唯一原本、再open no replayを検証。
2. 既存Task owner Message resolverを要求/実行へ共用し、承認原本のExecution ID/version/Messageから入力を再構成する。Human decision、parent WorkItem、actor、入力digest/field mask、source binding、read/write/network/contact capability、明示write scopeを秘密取得前・baseline後・claim直前に再照合。専用Agent read/write参照をhostで解決する。既存human経路は人間限定を維持。
3. 固定mutation/先行claim/応答検証/不明結果receipt/status-only観測/Auditは既存update engineを再利用。Task-bound authorizerは信頼するcompositionのDI callbackでありRPC入力ではない。observeはWorkItem version進行を許すがExecution sourceは承認時versionを維持する。Task状態変更/runtime自動提案はこの管理CLIから完了扱いしない。
4. DIのsource/capability/credential取得中変更・保存障害・secret反射、native e2eと全check/非空dry-run/実Jev/Ponytail/正しさreview、ログ/Git/通常main公開。

Scopeはcommand snapshot。Local再検証→claim/外部writeの跨process原子性や外部CASは保証しない。送信後の元Task/権限変化で外部成功を取り消せず、receiptは送信時の承認原本を保つ。本人認証/runtime接続/実API/実務Draft PRとその他全体残件を維持する。
