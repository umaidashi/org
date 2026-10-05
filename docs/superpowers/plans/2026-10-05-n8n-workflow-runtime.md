# n8n WorkflowRuntime

Notionのinvoke(workflowId,input)/status(executionId)/cancel(executionId)を、既存TaskやAgentから独立したPortへ接続する。

一次資料: [Webhook](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook.md)、[Execution controller](https://github.com/n8n-io/n8n/blob/master/packages/cli/src/public-api/v1/controllers/executions.public.controller.ts)。Workflow Public controllerに任意invoke endpointはない。invokeは明示host allowlistのproduction WebhookをPOSTし、参照WorkflowはRespond to WebhookでexecutionIdを返す。statusはGET /api/v1/executions/ID、cancelはPOST /api/v1/executions/ID/stop。ローカル実機は公式固定版2.41.6で照合する。

1. Portとnative HTTP AdapterをDB不要UT RED/GREENで検証。固定host/許可Workflow/ID/状態/入力・応答上限/redirect禁止/API key非漏洩。invokeは自動retryしない。
2. 参照n8n workflowをリポジトリへ保存し、ローカル実n8nでinvoke/status/cancelを検証。
3. CLIと永続Execution receipt、Task/権限境界を接続し、小e2eで再openと重複実行拒否を確認。
4. 全check/実Jev/独立レビュー/通常main push。残る自動Workflow委譲・業務service e2eをrequirementsへ照合する。

n8n UI designer、独自queue、外部業務への実送信は追加しない。資格情報はenv経由でhost側だけが保持し、ログ・成果物・Jevへ含めない。

## 次の小e2e: CLIと永続receipt

既存EventBusの不変Eventをreceiptとして使い、新しいSQL journalを作らない。`workflow run WORKFLOW --key KEY --input JSON --config PATH`は決定的request IDを先にpublishし、成功だけstarted実行IDを追記する。同keyを再送しても二度invokeしない。失敗・通信不明もclaimを残して自動retryしない。`status/cancel`は保存済みreceiptと同host/Workflowを確認してから呼び、観測を新Eventへ追記する。原inputは保存せずhashを記録し、キー値はenvからhostだけが読む。手動local admin操作から始め、Task/Agent自動委譲と外部権限scopeは後続に接続する。

## 後続: Event購読からの一度だけのWorkflow起動

既存Workflow SubscriptionとDeliveryPlanを再利用する。明示host configがあるdaemonだけ非同期pollを有効化し、先に不変request Eventをclaimしてからnative invokeする。終了時は実行中pollをdrainする。既存Task宛配送の同期処理は維持し、Workflow execution IDをtaskIdへ混入させない。DeliveryにはWorkflow request参照を別に保存し、既にstarted receiptがある場合はそれを照合して配送完了を回復する。requestだけで結果が不明な場合はdeferredとして二度送らない。Workflow自身のreceipt Eventを自動購読の入力に戻して無限起動しない。最初にDIで重複・中断・unknown outcome・restartのRED/GREENを確認し、actual daemon＋loopback Workflowの小e2eへ接続する。Agent委譲のcapability/Task/外部scopeは別の検証単位で接続する。
