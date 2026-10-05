# GitHub署名済みIssue webhookのlocal取込

NotionのEvent/webhook/安全性要件を、既存EventBus→Subscription→Taskへ接続する。新HTTP server/queue/tableは作らない。

`event import-github-webhook OWNER/REPO --payload RAW_JSON --signature sha256=HEX --delivery UUID`。host専用SecretStore grant `github:host` / `github:webhook`、環境変数 `GITHUB_WEBHOOK_SECRET`。公開repoのissues opened/edited/closed/reopenedだけを受け付ける。実GitHub接続なしで署名fixtureを検証できる。

HMAC-SHA256をraw UTF-8 bytesで検証、constant-time比較、64KiB上限、署名不正ならJSON処理/保存しない。固定repo/source、Issue identity/URL/日時を検証する。署名されないdelivery headerは初回metadataとしてのみ保存し、冪等IDはrepo ID+署名対象raw bodyのSHA256。同bodyのdelivery差替え/再取込は原本を返す。認証secretを含むbodyは拒否。署名は鮮度の証明ではない。

1. DI取込exportとCLI未実装RED。
2. 既存EventBus/SecretStore/CLIを再利用し最小UT GREEN。高速UTコマンドへ追加。
3. actual direct/daemon CLI、Subscription→一Task、署名改変/別repo/再送/reopenを検証。
4. 全check・実jev・独立最終review一回、重要指摘一fixpass、Git/main通常push。

Ruling: これは署名済みpayloadの明示取込境界。公開HTTP endpointとGitHubからの実配送は未完了。body hashの重複排除は同じbytesが対象で、REST polling Eventとの横断dedupは保証しない。既存list lookupを再利用し、量が増えたら公開Portのreceipt lookupへ置換する。

参照: [GitHub署名検証](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries)、[webhook payload](https://docs.github.com/en/webhooks/webhook-events-and-payloads)、[best practices](https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks)。
