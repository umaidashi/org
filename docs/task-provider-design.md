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
- 共通consumerの最初の三操作は`task create/get/list --provider local|linear`。既存sync storeをLocal実行側へ残し、CoreのAsyncTaskProviderは実装済みcreate/get/list/updateを定義する。未実装method/stubを追加しない。残るcomment/artifact二操作は同じ境界へ実際に接続するまで未達。
- Linear createはCoreのstable IDとexternalRefが指す既存Issueを読取り、外部six fieldsを採用したLocalミラーを初回version0で保存する。Core入力のLocal parent/dependencies/createdAtは保持する。新Issue/外部変更の要求ではなく、title/objective等をIssueへ送らない。既存ミラーなら重複拒否。
- Linear adapterのTeam scopeはhostのORG_LINEAR_TASK_TEAMのみ。create/getはCore IDと同Teamのcanonical Issue参照を照合する。get/listは既存ミラーのCAS同期を含み、未作成のIssueは未合成snapshotを返して自動importしない。旧linear-get --mappedはLocal不変のまま。
- listは共通Core field selectionと既存page/parserを再利用し、IssueごとのN+1読取を避ける。50件×最大10ページで全応答を検証し、跨page重複/循環cursor/上限超過を失敗にする。全応答検証後にWorkItem単位でCAS保存するため、後続保存の障害/競合時は先行ミラー更新が残り得る。一覧全体のrollback/跨system原子性を保証しない。filterは表示条件であり、host Team scopeが読取権限の境界。

外部read/writeの原子的CASや即時権限撤回、実API認証、本人認証、業務納品は別検証。空interfaceや未実装method、個別commandだけで共通Provider完成とは扱わない。

API仕様の確認元: [Linear GraphQL](https://linear.app/developers/graphql)、[Filtering](https://linear.app/developers/filtering)。GraphQLのHTTP200だけで成功とせず、既存queryLinearのbounded response/error/credential反射拒否を共用する。

## 共通updateの実consumer

`task update --provider local|linear --patch JSON --expected-version N --actor ID`を共通await consumerへ接続する。Core patchは閉じたtitle/objective/status/owner/priority/parentId/dependencies/labelsのみ。owner nullを解除として扱う。Localは既存changeTask/CAS、Linearはhuman Approval/claim/receiptを先に確定し、selected Core現在値照合後にミラーをCAS同期する。失敗はconfirmed receipt IDと回復操作を示し、再送禁止を保つ。

states/ownersの逆対応は一意だけ許可し、host labels名→UUIDを明示する。label名aliasが実サービス名と一致しなければCore同期は成功にしない。parent/dependenciesはLocal所有の明示metadataで外部承認digestには含めず、graph preflight後、外部six fieldsと同じLocal CAS/history transactionで保存する。relation-onlyはHTTP/外部Approvalなし。元成果物/createdAt/参照を保持する。Local actorは宣言値、本人認証/全重要Auditは残件。
