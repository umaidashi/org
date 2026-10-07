# Linear更新の不明結果を再送せず読取確認する

Spec: [要件](../../requirements.md)。既存Issue更新で一回claim後に送信結果が不明でもmutationを再送しない。今回の対象はread-onlyの明示確認であり、自動同期・新Issue・別field更新を追加しない。

契約: `task observe-linear-update WORKITEM --actor HUMAN --approval ID`。承認原本のIssue/入力digestと同じ既存claimを必要とする。Local versionの進行は許容するがWorkItem identity/元externalRefは変えない。固定Issue queryで取得したUUID/identifier/workspace/URLとtitle/description digestを照合し、読取後もLocal mappingを再検証する。本文/資格情報を原本へ保存しない。

既知のupdated成功原本は厳密に照合してHTTPなしで返す。不明結果は別IDの`linear.update.observed`原本へ、同じApproval/claim/current Issue URL/outputDigestを保存し、Audit resultをobservedにする。これは現在の内容との一致を示し、当該mutationが変更したことを証明しない。既知のobserved原本再利用は保存時点の証拠であり再pollではない。現在値不一致・欠損・HTTP/保存失敗では証拠を追加せず再mutationしない。

## Task 1: DI/native RED→GREEN

実CLIで未知結果を作り、未対応observe操作の失敗を確認する。既存Approval/claim/query/verified receipt helperを再利用して最小実装。pending/rejected/別actor/別WorkItem/claim不一致/本文不一致/不正URL/資格情報反射を拒否。version進行、Local mappingのHTTP待機中変更、保存障害、並行確認の唯一winner、再open後HTTPなしを検証する。既存成功とobservedを混同しないAuditを検証。

## Task 2: 文書・全gate・独立review・公開

Task/TaskProviderの総称を実装済みtitle/descriptionと未完status/owner/labelsなどへ明確化する。README/受け入れ/証拠/作業ログを更新。全checkと実Jev、Ponytail-review、独立最終reviewを行い重要指摘のみ一回TDD修正。通常main反映/pushを行う。実API/auth/本人認証/実業務Draft PRと全体の他の残件は別に維持。
