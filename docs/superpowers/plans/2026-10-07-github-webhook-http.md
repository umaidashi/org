# 明示local HTTP受信から既存署名付きGitHub Eventへ接続する

[再照合](../../goal-reassessment.md)のTrigger Webhook受信残件。既存importGithubWebhookが署名・公開repo scope・payload上限・credential反射・原本冪等を実装済み。新Event engineを作らず、その関数へHTTP境界を接続する。業務Issue/公開ingress/実GitHub側hook登録を推測しない。

1. 最小Request/Response DI testでPOST/固定path/event header/signature/delivery/JSON・scope失敗がEvent保存ゼロ、正当署名が既存Event一件でRED。秘密値/bodyをHTTP応答やstderrへ出さない。署名の実検証は既存importerを使う。
2. 明示continuous daemon option（repoとportはpair）で127.0.0.1だけへBun.serveを起動。native maxRequestBodySize=65536を使い独自buffer/read engine不要。設定なしlistenerゼロ、once/status/directなど不適用拒否、port/repo事前検証。SecretStore既存github:host/github:webhook参照を再利用。
3. daemonの既存EventBus所有/lease/shutdownにlistenerを組み込み、開始失敗は既存resource cleanup、shutdown先行受付停止・async body取得後もclosingを照合しDB解放後publishを拒否する。署名済みissuesだけを受け、固定HTTPエラー、本文/secret非反射。ネットワークbindingを0.0.0.0へ広げない。
4. 実daemonとHTTP fetchで署名付きdelivery→Event→既存Subscription→ExecutionTask一件、invalid signature/repo/header/oversize no write、重複/restart no replay、stop後listenerなし/起動失敗後socket/DB cleanupを小さく確認。外部GitHub設定/公的ingressの実配送ではないことを記録する。
5. full localgate/actual Jev/一回fresh reviewer/Ponytail・証拠・README・要件・ログ・Git/main通常push。permissions/限定Sandbox credential/重要Audit inventory/実業務受け入れは別残件で継続する。
