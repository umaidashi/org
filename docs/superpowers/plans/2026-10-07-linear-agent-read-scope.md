# Agent別Linear読取scope

Spec: [要件](../../requirements.md)、Notion 08 Security（Agent毎の外部scope・credential）。

最初の動作は管理CLIがAgentの権限を使って許可された既存Issue UUID一件を読むこと。Agent本人認証やruntime tool接続とは区別する。host環境の`ORG_LINEAR_AGENT_SCOPES`が指すJSONだけを設定原本とし、RPC引数で設定pathや環境変数名を指定させない。各scopeはagentId、issueIds、apiKeyEnvの閉じた契約。human用LINEAR_API_KEYへfallbackしない。

1. 実CLIの`task linear-get UUID --agent ID`をREDにする。DIで未知Agent、capability不足、scope外、未知/重複設定、読取中capability撤回、secret反射を拒否する。
2. 既存readLinearIssue/EnvironmentSecretStoreを再利用。read/network/contact_externalを秘密取得前と読取後に照合。専用credentialはhost境界だけが取得しRuntimeへ渡さない。旧human read/listは維持。
3. direct/daemon/reopenの小さなe2e、全check、実Jev、Ponytailと正しさレビュー、ログと通常main push。

Agent提案→承認→write、本人認証、TaskProvider交換、実Linear認証と実業務一周はこの読取成功から完了扱いしない。scopeは一commandのhost設定snapshotであり、途中のfile書換えを継続監視しない。
