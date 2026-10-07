# Task原本に結び付いたLinear更新承認

Spec: [要件](../../requirements.md)、Notion 04 Task/08 Security。外部WorkItemと内部ExecutionTaskを分離し、所有者Agentの不変Messageから外部影響の承認を作る。

1. `task request-task-linear-update EXECUTION --room ROOM --room-message MESSAGE --expected-version N --key KEY`を実CLI REDにする。提案はclosed `{version:1,tool:"linear-update",workItemVersion:N,title,description}` または排他の`fields`。対象はExecutionTaskのparent WorkItemから導出し、自由なactor/Issue/credential入力は受け付けない。
2. assigned Task/version・active Task Room・所有者Message・read/write/network/contact_external・host write scopeを照合。専用read credentialと既存Linear baseline/input digestを再利用。HTTP前後に原本を再照合。Approval actorはAgent、taskIdはWorkItem、operation.bindingにExecutionTask ID/version/Message参照を固定する。旧human原本/schema互換を維持。
3. native e2eでpending→human approve/reject、同key/reopen、原本binding、scope/権限/parent/version/Message不一致、既存human applyからのAgent承認拒否とmutationゼロを検証。DIでHTTP中の原本・権限変更とsecret反射拒否を確認。全check・実Jev・Ponytail/正しさreview・ログ/Git/通常main公開。

この段階は承認要求と人間判断まで。Agent-bound apply/observeとruntimeの自動提案接続は次に進め、既存human applyをactor書換えで流用しない。実API認証・本人認証・業務Issue→Draft PRなどは未完了を維持する。
