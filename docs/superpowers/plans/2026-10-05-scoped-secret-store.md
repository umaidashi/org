# Scoped SecretStoreとWorkflow委譲の前提

全体目標はNotion AI Company Kernelを満たすまで継続する。[Security原則](https://app.notion.com/p/3ef8a4020cb6815f9afdeaef5707f50d)と[主要Ports](https://app.notion.com/p/3ef8a4020cb681ab8129e9a952d854a2)を再取得して照合した。

最初の検証単位はSecretStore PortとEnvironment Adapter。hostが設定したactor/secret reference/env名のgrantだけを解決し、未知actor/referenceはenv読取前に拒否する。env名・値・raw例外を公開しない。lookupをDIして最小UTを回し、既存Workflow host configのAPIキー読取をこのPortへ接続して実CLI e2eを確かめる。万能env lookupや秘密を返すCLIは作らない。

1. 未module RED→固定grant/重複拒否/unknown actor拒否/入力mutation非影響/例外非漏洩のDB不要UT GREEN。
2. 既存Workflow host configが明示したAPIキーだけをnative Adapterへ解決する。daemon/CLI実e2eと全check/実Jevで検証。
3. 独立Final reviewerを一回実施、重要指摘は一回fix passして再検証。証拠/ログ/Gitと通常main push。
4. 後続のTask Workflow委譲は、最新Task owner/version/Agent capabilities/Roomを照合し、Agent別Workflow scopeと資格情報grantで実行する。LLMへ秘密を渡さず、重要外部操作のApproval境界を接続してから許可する。この検証単位ではTask委譲完了を主張しない。

初期Environment Adapterは既存host envの参照だけで、暗号化保管/Vault/macOS Keychain/Sandbox credential injectionは後続。
