# Session経由のContext読取をcan_readで制約する

[全体再照合](../../goal-reassessment.md)の具体的な未達。既存sessionAgentは登録/runtime/active Room参加を検査するがcan_readを要求しない。共通境界に既存requireCapabilityを再利用し、Session start/resume/rebuild/Room activation/Task経由のRuntimeへ無権限でContextを渡さない。resource permissionsモデル全般やprincipal認証は別単位。

1. 最小DI UTでcan_readなし/legacy/別capabilityを拒否し、Session作成・begin保存・Runtime呼出しゼロをRED確認。既存の肯定fixtureへ必要な明示can_readだけを与え、登録既定grantを広げない。
2. 全callersを追跡しsessionAgentに共通guard。非同期Runtime中にgrantが失効した場合は完了前に同じ登録Agent/runtime/active Room参加/capabilityを再照合し、provider ID/Room返信を保存しない。既存failureのSession履歴を維持する。scopeの自動推測/新DI container/新storeなし。
3. 実daemon CLIでlegacy/no-read拒否、明示can_read成功、既存Approvalによる失効後resume拒否・再起動後維持を確認。Room activationで無権限Runtime counterが増えない、Task経路も共通拒否を確認する。受け入れをSession単体の空Room assertで代替しない。
4. 型/lint/AST/全テスト/実Jev、一回fresh whole-unitレビュー/Ponytail、証拠・README・要件・ログ・Gitとmain通常push。permissions field/具体resource scope/credential/HTTP Webhook/重要Audit inventory/実業務受け入れは未達として継続する。
