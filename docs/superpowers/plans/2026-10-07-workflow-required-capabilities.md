# Workflowの追加Capability

重要操作に必要な `can_publish` / `can_spend` 等を、モデルの提案ではなく既存Workflowホスト契約で指定する。既存 `validateCapabilities` と実行前のowner再照合を再利用する。

1. 既存UTとnative CLIへ不足権限・承認後の契約変更のREDを追加する。
2. Workflow allowlistの任意 `requiredCapabilities` を検証する。省略時は既存契約を維持する。
3. Task提案・承認要求・再開・継続観測で追加権限を確認する。Task Approval bindingへ同じ配列を保存し、契約変更時は再開を拒否する。
4. 型・lint/AST・全テスト・実jev・独立レビューを実行し、結果を保存する。

業務Workflowのノードから副作用を推測しない。ホストは信頼された設定者であり、宣言が正しいこと自体はこの変更では証明しない。新しいpermission framework、DB table、依存は追加しない。
