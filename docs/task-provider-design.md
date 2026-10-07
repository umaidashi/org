# 共通TaskProviderの責任境界

Notion root/04/08と[計画](superpowers/plans/2026-10-07-common-linear-task-provider.md)を根拠とする。共通六操作は未完成で、ここでは実装を進める境界を固定する。

- 外部WorkItemのstatus/owner/priority/labelsは外部snapshotの事実。内部ExecutionTaskの状態、parent/dependencies、成果物、実行履歴はLocal所有。外部state変更から内部実行や偽の状態遷移を生成しない。
- state UUID→Core TaskStatus、assignee UUID→登録Agent IDはhostの明示mapping。名前で推定しない。未知state/非nullの未mapping owner、不完全labelsを拒否する。無担当Issueはowner nullの外部WorkItemとして表現する。
- 最初の読取は既存`task linear-get --mapped`。host管理の`ORG_LINEAR_TASK_MAPPING` JSONを読む。RPCはmapping file pathを指定できず、Agent専用readと混ぜない。Core Task形式の外部snapshotを返し、version0はLocal CAS/versionを意味しない。Local履歴やExecutionTaskは変更しない。
- title/objective/externalRef/remote日時、priority0–4、全labels名をCore値へ変換する。読取snapshotのparent/dependencies/inputArtifacts/outputArtifactsはLocal合成前なので空。既存WorkItemの関係や成果物を消去した状態とは扱わない。
- `task sync-linear`で外部snapshotとLocal所有fieldsを合成し、明示expectedVersionでTask/履歴を原子的に保存する。既存refreshは本文更新だけの契約を維持する。競合は再読取を要求し、ExecutionTaskのtransition/terminal不変条件は緩めない。
- syncは既存import済みWorkItem限定。title/objective/status/owner/priority/labelsを合成し、Local親・依存・成果物・createdAt・元externalRefを保持する。同じ値ならversion/履歴は増えない。外部日時はread snapshotで確認するが保存version/updatedAtはLocal commitのもの。readとcommitの跨system原子性やremote日時の継続的な単調鮮度は保証しない。
- 外部参照付きWorkItemのstatusは外部snapshotの事実で、無担当やterminalからの再openをsync専用mergeで許可する。通常changeTaskのowner/transition/terminal制約は維持する。参照graphの存在・循環検証は両種で行い、依存の実行完了条件はExecutionTask/外部参照のないLocal Taskに適用する。外部WorkItemの状態から内部Executionを進めない。
- 共通の非同期六操作をLocal/Linearの両Adapterと実consumerへ接続する。createは既存Issueに対応するCore WorkItemの作成で、issueCreateは行わない。get/listでscope/pageを検証。update/addComment/linkArtifactは既存のhuman Approval/claim/receipt/観測を再利用する。outbound state/owner/labelsの対応は明示し、曖昧な逆mappingを推測しない。

外部read/writeの原子的CASや即時権限撤回、実API認証、本人認証、業務納品は別検証。空interfaceや未実装method、個別commandだけで共通Provider完成とは扱わない。

API仕様の確認元: [Linear GraphQL](https://linear.app/developers/graphql)、[Filtering](https://linear.app/developers/filtering)。GraphQLのHTTP200だけで成功とせず、既存queryLinearのbounded response/error/credential反射拒否を共用する。
