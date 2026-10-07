# Linear Artifact不明結果の読取回収

Spec: [要件](../../requirements.md)、Notion 04 Task抽象化（2026-10-07再取得）。既存WorkItem/output Artifactと不変Approval/Eventを原本にする。

契約: `task observe-linear-artifact WORKITEM --title TITLE --actor HUMAN --approval ID`。承認済みArtifact ID/URI/title digestと既存claimを照合してからlinear:readで対象IssueのURL完全一致attachmentsを照会する。Issue/URI/title/UUIDを検証し、元linked receiptを保存。mutationは行わない。保存済みlinked原本は再照会せず返す。Task version進行は許可し、Issue mapping/output Artifact原本は維持を要求する。

Ruling: 対象Issue内のURL eq filterとfirst:2/pageInfoで唯一の結果を確認する。global URL検索の先頭ページだけでは別Issueに埋もれるため使わない。判断が誤れば正しい結果を拒否/別Issueを採用し得るため、固定queryとresponse境界を検証する。

## Task 1: native CLI RED

Interfaces: 既存Artifact HTTP/SQLite fixture、新observe CLI。
既存4ケースへ回収を追加する。unknown/receipt障害は一回query、既知成功はqueryゼロ。再openの原本一致、mutation一回、Task/Artifact不変、Audit成功を検査する。
Run: `bun --no-env-file test tests/linear-artifact-cli.test.ts`
Expected: 未対応CLIでRED。

## Task 2: DI serviceとCLI GREEN

Interfaces: Task get/artifacts、Approval get、Event list/publish、SecretStore、HTTP、clock。
DB不要テストでpending/reject/別actor/title/claim/原本、ゼロ/複数/不完全page/不正Issue/URI/title/UUID、保存障害・並行winner・Task進行を検査。既存applyのAttachment検証/linked保存を実際の二経路で共有し、別table/frameworkを作らない。
Run: 対象UT/native、型/static。
Expected: 新旧GREEN。

## Task 3: 文書・gate・最終review・公開

Interfaces: README/要件/証拠/作業ログ、既存Audit projection。
Run: `bun run check`、非空dry-run後実Jev、fresh最終review/Ponytail。Critical/Importantだけ一回RED→GREEN fix。承認済み通常main反映/push。
Expected: 全gate成功、全体目標active。実API認証/Agent/実業務Draft PRは残件。

## Review Focus

承認原本とclaim/linked原本の偽造、title入力での別意図回収、同URL別Issue/多件/不完全page、Task version進行とmapping変更、read資格情報取得後/HTTP中の原本変更、apply/observe競合winner、保存障害後の再mutation禁止、履歴照会を現在の外部監視/操作起源証明と誤称しないこと。
