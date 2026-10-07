# 既存Linear WorkItemへの承認済みコメント

## 最初の外部書込み

既存のLocal WorkItemに対応するLinear Issueへ、明示human Approvalと完全一致するコメントを一回だけ投稿する。Core Taskの同期Portや既存WorkItem原本をAPI待ちのために変更せず、非同期の外部操作serviceとして接続する。新Issue作成、任意GraphQL入力、自動同期、Agent自律投稿はこの最初のsliceに追加しない。これらを除いたことを全体完了の根拠にしない。

- 入力は既存WorkItem ID、expectedVersion、コメント本文、human actor、Approval ID。一度選んだ外部Issue IDと本文digestをApprovalへ固定する。元Issue URL/WorkItem kind/versionを保存・実行前に照合する。
- Approvalは既存requestOnce/decide/getを使い、未承認/reject/別actor/別本文/別Task versionではcredential lookup/HTTPを行わない。本文をApproval/Auditに重複保存せず参照/digestを使う。
- HTTPは現在のLinear固定endpoint/timeout/上限/redirect禁止/資格情報反射拒否を共有する。公式schemaでcommentCreateの入力/返却ID/Issue照合を確認してから実装する。SDK追加や汎用GraphQL clientは不要。
- 外部呼出し前に既存EventBusで排他的な一回claimを不変保存し、成功結果も参照receiptへ保存。通信不明/receipt保存障害で自動再POSTしない。失敗を成功や空値へ変えない。credential取得失敗などclaim前に判定できるものは先に拒否する。
- local CLIのhuman actorは現在の他Approval同様、信頼するローカルhostが明示するIdentityであり本人認証ではない。Agent投稿/capability/専用scopeは別sliceで追加し、未完了を保持する。

## TDD / 検証手順

1. 既存Approval/Task/HTTP/Auditの全callerと保存契約を読み、CLIの未対応REDを確認。鍵なし・固定HTTP fixtureを使い、外部業務Issueを変更しない。
2. Approvalの具体operationを追加し、pure validation/SQLite不変原本を検証。DB不要DIで未承認・異なるactor/本文/対象/versionを拒否、lookup/postゼロを確認。
3. async serviceと固定Linear mutation、既存Event claim/receipt、CLI request/applyを配線。unknownとclaim/receipt保存失敗、同時apply/restart no replayを実SQLite/実CLIで検証。本文/credentialをerrorへ漏らさない。
4. Auditの原本参照を公開Readerで接続し、型・全check・実Jev・一回の独立final review/Ponytail判定を記録。Important/Criticalは一回のTDD fix pass。
5. code/test/design/work-log/evidenceをGitへ保存し、通常main push。実サービスは既存対象指定とnative資格情報が揃った後に実測し、fixtureを実サービス成功と扱わない。

[Phase6不足の根拠](../../mvp-acceptance.md)。更新・Artifact連携・Agent委譲・実認証・実業務Draft PRなど、全体の残件は[要件](../../requirements.md)を維持する。
