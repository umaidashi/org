# 共通非同期TaskProviderの実consumer

[全体計画](2026-10-07-common-linear-task-provider.md) Task2、[責任境界](../../task-provider-design.md)、Notion04/08を基準とする。Core六操作の全体目標を保持し、一つずつ実consumer/両Adapter/e2eで埋める。

1. 既存sync TaskProviderはLocal実行storeとして維持し、実際にawaitされる共通Core境界とCLI consumerを作る。LocalとLinearの双方を同じCore入力/結果で使う。まずget/list/createをTDDで接続し、まだ使わない残methodやthrow-only stubを作らない。共通六操作完成とは扱わない。
2. Linear getはhost scope/mappingで外部Core snapshotを読み、必要なLocal関係を合成する。listはhost Team scopeとbounded pageを照合し、切詰め/重複/未mapping/不正cursorを成功にしない。Localのfilter/persistenceと共通contractを実DB/実HTTP/別CLIで検証する。createは既存Issueに対応するCore WorkItemを作り、新Issueは作らない。
3. update/addComment/linkArtifactを同じconsumerへつなぐ。既存Approval/claim/receipt/unknown-result観測を再利用する。共通Core status/Agent owner/priority/labels/title/objectiveを外部入力へ変換するときはhostの明示対応だけを使い、曖昧な逆mappingを推測しない。現在のLinear updateはcontentと三つのUUID fieldを分け、Artifact writeは既存output原本を要求するため、これらの実際の境界を先にTDDで整える。未対応field/未承認writeを完成扱いにしない。
4. common consumerがLocal/Linear両実装を実際に消費するsix-operation contract/e2eを揃える。CoreへGraphQL/Linear UUID field modelを漏らさない。Local Execution状態/履歴と外部WorkItemの状態、credential/actor/Approvalを分離し、拒否・競合・不明結果の再送禁止・再openを維持する。
5. 各検証単位のRED/GREEN/fast UT/全check/非空dry-run/実Jev/Ponytail/独立reviewを公開ログ・Gitへ記録し、通常main公開する。実API/本人認証/実業務納品と他の全体残件は継続する。
