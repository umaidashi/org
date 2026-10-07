# 承認済み成果物URLを既存Linear Issueへ関連付ける

Spec: [要件](../../requirements.md)、Notion 04 Task抽象化（2026-10-07再取得）。Core WorkItemと内部Executionを分離し、Local TaskProviderの原本を外部送信で書き換えない。

## 契約

`task request-linear-artifact WORKITEM --artifact ARTIFACT_ID --title TITLE --expected-version N --actor HUMAN --key KEY`と`task apply-linear-artifact WORKITEM --artifact ARTIFACT_ID --title TITLE --expected-version N --actor HUMAN --approval APPROVAL`。

- 対象は既存Linear WorkItemのoutputArtifactsに含まれる不変TaskArtifactだけ。URIを入力で差し替えず、公開可能なcanonical HTTPS URI（userinfo/query/hash/portなし）を読む。org://やfile://の内容をアップロードしない。URLの公開可否はhumanが承認し、Artifact内容の公開は本操作に含めない。
- ApprovalへIssue UUID/URL、WorkItem version、Artifact ID、URI/titleのdigestを固定。humanのみ、pending/reject/別actor/異なる入力/原本/versionでは秘密取得・HTTP前に拒否。requestOnceを使い、再要求で同じ原本を返す。
- 公式[Attachments](https://linear.app/developers/attachments)・[SDL](https://github.com/linear/linear/blob/master/packages/sdk/src/schema.graphql)でattachmentCreateのissueId/title/urlと返却success/attachment(id/title/url/issue.id)を確認。同Issue・同URLは新規作成だけでなく既存リンク更新にもなる。承認の効果はこのURLリンクの登録/表示title更新であり、metadata/commentBody/icon/subtitle等の入力は送らない。
- 共有Linear HTTPの資格情報/反射/timeout/redirect/JSON上限を使用し、取得後・HTTP前に対象を再照合。claimは元Approval IDを使った既存不変Eventで排他保存。URL単位の外部upsertを自動retry保証と扱わず、claim後の不明結果/receipt障害は再mutationしない。
- 成功は返却UUID・Issue ID・URI/titleと承認digestを検証してlinked receiptを保存。claim/unconfirmed/linkedは原本Approvalに照合してAuditへ投影し、title/URIの恣意的変更は受け付けない。原本Task/version/Artifactは変更しない。
- human本人認証、Agent投稿、実API認証、結果不明のstatus-only回収、外部Issue update、TaskProvider非同期交換の全機能は残件。これらを除外して全体完了を主張しない。

## Task 1: native CLI RED

Interfaces: 新request/apply CLI、既存Approval/Event/Task SQLite、owned HTTP fixture。

既存IssueとHTTPS output Artifactを実CLIで準備し、request→pending no mutation→human decide→並行apply→一回mutation→Audit→再open no replayと原本不変を確認。HTTP不明/claim保存/成功receipt保存障害も検証。

Run: `bun --no-env-file test tests/linear-artifact-cli.test.ts`
Expected: 未対応CLIによるRED。

## Task 2: Approval・DI service・CLI GREEN

Interfaces: Approval operation union/保存parser/Auditラベルと、公開Task get/artifacts・Approval get/requestOnce・Event list/publish・SecretStore・HTTP・時計。

まずpure ApprovalとDB不要DIテストのREDを確認。承認/claim共通処理とHTTPを既存コメントから再利用できるところだけ抽出し、不要なgeneric frameworkや新tableを作らない。closed operation/UUID/URI/title入力、欠落/別Task/input-only Artifact、pending/reject/actor/version/digest変更、credentials/response/claim/receipt障害を検査。

Run: `bun --no-env-file test tests/approval-domain.test.ts tests/linear-artifact.test.ts tests/linear-artifact-cli.test.ts tests/linear-comment.test.ts tests/linear-comment-cli.test.ts`
Expected: 新操作と既存コメントの全対象GREEN、型/static成功。

## Task 3: Audit・文書・最終gate

Interfaces: 不変Event→公開ReaderによるAudit、既存Approval request/decision因果順。

Audit原本/actor/Task/Approval/digest照合、偽造receipt拒否と同時刻因果順、本文非漏洩を確認。要件内の古い「comment未実装」記述も実証済み範囲に修正。README・作業ログ・証拠を更新。

Run: `bun run check`、dry-run後`bun run review:semantic`、一回fresh最終review/Ponytail。Critical/Importantは一回RED→GREEN fix pass。通常main反映/push。
Expected: 対象非空、全gate成功、全体目標active。

## Review Focus

同URLの既存Attachment更新を新規作成だけと誤称しないこと、別Task/input Artifact/非HTTPS/資格情報を含むURIの境界、API応答に別Issue/URI/title/UUIDがある場合、claim/receipt障害や並行実行後の再送禁止、既存コメントの生存する全caller、Artifactリンクと内容アップロードを混同しないこと。TaskProvider全体交換と実業務の受け入れは別途未完了を維持する。
