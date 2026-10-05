# n8n WorkflowRuntime

Notionのinvoke(workflowId,input)/status(executionId)/cancel(executionId)を、既存TaskやAgentから独立したPortへ接続する。

一次資料: [Webhook](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook.md)、[Execution controller](https://github.com/n8n-io/n8n/blob/master/packages/cli/src/public-api/v1/controllers/executions.public.controller.ts)。Workflow Public controllerに任意invoke endpointはない。invokeは明示host allowlistのproduction WebhookをPOSTし、参照WorkflowはRespond to WebhookでexecutionIdを返す。statusはGET /api/v1/executions/ID、cancelはPOST /api/v1/executions/ID/stop。ローカル実機は公式固定版2.41.6で照合する。

1. Portとnative HTTP AdapterをDB不要UT RED/GREENで検証。固定host/許可Workflow/ID/状態/入力・応答上限/redirect禁止/API key非漏洩。invokeは自動retryしない。
2. 参照n8n workflowをリポジトリへ保存し、ローカル実n8nでinvoke/status/cancelを検証。
3. CLIと永続Execution receipt、Task/権限境界を接続し、小e2eで再openと重複実行拒否を確認。
4. 全check/実Jev/独立レビュー/通常main push。残る自動Workflow委譲・業務service e2eをrequirementsへ照合する。

n8n UI designer、独自queue、外部業務への実送信は追加しない。資格情報はenv経由でhost側だけが保持し、ログ・成果物・Jevへ含めない。
