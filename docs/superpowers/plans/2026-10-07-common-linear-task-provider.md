# 共通非同期TaskProviderとLinear WorkItem

Spec: Notion root/04/08、[全体監査](../../completion-audit.md)、[全体要件](../../requirements.md)。04はCore共通create/get/update/list/addComment/linkArtifactとWorkItem/内部ExecutionTask分離を要求する。既存の個別Linear commandだけで共通Provider完成とは扱わない。

## Task 1: authorityとCore projectionを設計・検証

1. root/04/08を再取得し、既存Issueのみ扱う条件、外部writeのhuman Approval、不変履歴、内部ExecutionTaskのLocal所有を維持する。現TaskProvider全caller、Linear read/list/field mapping/import/refresh/承認engineを読む。
2. 外部WorkItem snapshotと内部Execution状態の所有者、共通非同期6操作、Local/Linearの具体Adapter、Core status/Agent owner/priority/labels対応、version/競合/未mappingの拒否を設計書へ保存する。CoreへLinear UUID/GraphQL modelを漏らさず、名前からAgentやstateを推定しない。host明示mappingとfixtureで検証し、実API認証がないことを隠さない。
3. 既存CLIの読取/同期経路を使う小さなRED→Core state/ownerを含む実HTTP fixture→再openを先に確認する。Local ExecutionTaskの状態/原本は変更しない。型だけの空Providerや未実装methodを完成扱いにしない。

## Task 2: 六操作を両Adapterで消費する

1. 実際の共通consumerとLocal/Linearの二Adapterを接続し、同じCore入力/結果のcontract testを実行する。同期Local storeを全面非同期化する前に必要な共通境界を限定する。
2. createは既存Linear Issueに対応するCore WorkItemの作成として実装し、新Issue mutationは行わない。get/listは明示scopeと完全なpageを照合する。update/comment/linkArtifactは既存Approval/claim/receipt/不明結果観測を再利用し、承認なしの外部writeを拒否する。
3. Core patchに必要な対応とunsupported入力の境界を明記する。未対応の要求は残件として実装し、throwだけのmethodや個別command wrapperだけで六操作完了としない。競合/権限/秘密取得中変更/保存障害/再open no replayを小さなDI/native e2eで維持する。

## Task 3: 実機と全体要件の照合

各検証単位でRED→GREEN→fast UT/全check/非空dry-run/実Jev/Ponytail/独立正しさreview→ログ/Git/main通常公開を行う。実Linear認証/業務Issue/repoが未設定ならfixtureの成果と区別し、独立した残件を進める。Memoryの全source候補抽出/全scope、resource permission/本人認証、限定Sandbox credential/Audit、安全なTask retry、残CLI/実API/業務納品は維持する。
