# Linear priorityの承認・実行・観測

[共通write計画](2026-10-07-core-provider-writes.md)の最初の小さな検証。Core読取ではpriorityを扱うが、現在のwrite field maskはstateId/assigneeId/labelIdsのみである。

1. 既存native Linear update fixtureのfields modeへpriorityを追加して、requestが拒否されるREDを確認する。既存success/unknown/staleの三経路を再利用し、固定HTTP応答で承認済みpriorityだけがmutation/receipt/observeへ渡ることを確認する。
2. 共有field名、入力parser、selection、応答parserを最小拡張する。整数0–4のみを許し、欠落/null/小数/範囲外/未知fieldを拒否する。既存field順序を保ちpriorityを末尾へ追加し、古い承認mask/digestとCore readerを維持する。update engineは再利用する。
3. input digest/baseline digest/returned mismatch/claim後再送拒否/unknown観測/再openを既存DI/nativeで確認する。Task-bound提案parserも同じ共有parserを消費していることを確認する。
4. 小さなGREENとfast UT、全check、非空dry-run/実Jev、Ponytail/独立reviewを記録する。priorityだけで共通update・六操作・実APIの完成とは扱わない。続いて複合content/fieldsとCore明示mappingを接続する。

外部API根拠は[公式SDKの生成型](https://github.com/linear/linear/blob/master/packages/sdk/src/_generated_documents.ts)のIssueUpdateInputと[公式GraphQL説明](https://linear.app/developers/graphql)。既存query/選択field/IssueUpdateInputの経路を拡張し、新SDK依存やmutation engineを追加しない。
