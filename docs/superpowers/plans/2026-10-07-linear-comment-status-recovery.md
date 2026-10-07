# 承認済みLinearコメントのstatus-only回収

Spec: [全体要件](../../requirements.md)、[先行コメント契約](2026-10-07-approved-linear-existing-issue-comment.md)。Notion Task原則を2026-10-07に再取得。WorkItemと内部Executionを分離し、原本を書き換えない。

## 契約

`task observe-linear-comment WORKITEM --actor HUMAN --approval APPROVAL_ID` は、承認済み一回claim済みコメントUUIDを固定queryで読み、Issue UUID/URLと本文digestを照合して成功receiptを回収する。mutationは呼ばず、claim解除・再投稿・新Issue作成を行わない。

- pending/reject/別actor/Task/不正claimは秘密取得前に拒否。原本Approvalとclaimの完全一致を確認し、既存の成功receiptがあれば検証して返す（HTTPなし）。
- 現在のWorkItemは同じIssue UUID/URLであることを確認する。コメント操作はApprovalに固定した過去のversionであり、現在versionが進んだだけでは観測を禁止しない。Task原本/履歴を変更しない。
- 公式[Linear SDL](https://github.com/linear/linear/blob/master/packages/sdk/src/schema.graphql)で`comment(id: String): Comment!`を確認。共有HTTP制約・`linear:read` grantを使う。読取結果のid/body digest/issue.id/urlを、投稿時と共通の検証へ通す。
- 不在/変更済み本文/別Issue/不正応答/反射した資格情報/HTTP失敗は成功扱いにしない。元claimとunconfirmedを保持する。status-only再試行は可能だが再投稿不可。
- 成功は同じ`:created` receiptで不変保存。読取中に別の観測/投稿応答が成功を保存した場合は、原本と一致する既存receiptだけを返す。その他保存失敗は伝播し、後で読取から再試行可能。
- 新table/SDK/daemon background poll/general recovery frameworkを作らない。本人認証・Agent投稿・実Linear認証・実業務Draft PRは別残件。

## Task 1: native CLI RED

Interfaces: 既存CLI+HTTP fixture+実SQLite/Event原本。新CLI契約を後続実装へ渡す。

既存5fault native fixtureを拡張し、Mutation後に原本コメントを保持する。queryによる回収、並行観測、再open後HTTP不要、原本Task/claim/unconfirmed保持とAuditを検査する。unknown/receipt/terminal障害後もmutation counterは1。

Run: `bun --no-env-file test tests/linear-comment-cli.test.ts`
Expected: RED（未対応CLI）。実装後5 pass。

## Task 2: DIサービスとCLI GREEN

Interfaces: Approval/Get Task/Event list-publish/SecretStore/HTTP/時計の既存DI。Task 1のCLI契約、Task 3の原本Audit契約を満たす。

共有承認照合・response検証を既存二callerに適用し、観測の純粋判断とI/O順序を最小実装する。DB不要UTで承認/claim偽造の先行拒否、Task version進行、対象変更、response不正/通信失敗/保存失敗/並行winnerを検査する。

Run: `bun --no-env-file test tests/linear-comment.test.ts tests/linear-comment-cli.test.ts`
Expected: 全対象GREEN。型検査も成功。

## Task 3: Auditと最終gate

Interfaces: 既存created receiptのAudit投影を維持。必要な場合だけ回収済み因果順の既存処理を修正する。

unknown→createdの順序、本文非保存/秘密非漏洩、Task不変を検証。README・要件・MVP表・作業ログ・証拠を更新。`bun run check`・実Jev・一回fresh最終レビュー/Ponytailを実行。Critical/Importantのみ一回RED→GREEN fix pass。通常mainへ反映/push。

Expected: 全gate成功、対象件数を確認。全体目標は残件があるためactive。

## Review Focus

不明結果を「未投稿」へ読み替えないこと、既知receiptの偽造/別Approval拒否、並行publishの保存失敗を握りつぶさないこと、観測中のWorkItem対象変更、成功とunconfirmedの同時刻因果順、例外に本文/credentialが含まれないこと。過去のTask versionと現在versionの違いは読取を禁止する理由にしない。
