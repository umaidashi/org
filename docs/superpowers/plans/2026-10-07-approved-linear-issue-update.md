# 承認付き既存Linear Issueの明示更新

Spec: [要件](../../requirements.md)、Notion 04 Task抽象化（2026-10-07再取得）。外部WorkItemと内部Executionを分離し、Local Taskを外部mutationで変更しない。

契約: request/apply-linear-update WORKITEM --title TITLE --description MARKDOWN --expected-version N --actor HUMAN。requestはkey、applyはapprovalを受ける。title/descriptionを両方明示し、description空文字は明示削除。新Issue/status/owner/labelはこのsliceで送らない。

ApprovalへIssue UUID/URL・Local version・入力digestと、要求時にreadした外部Issueのbaseline digestを固定。pending/reject/別actor/入力/versionを秘密取得前に拒否。applyはclaim存在を最初に拒否し、linear:readでbaselineを再照合後にlinear:writeで一回claim/mutation。応答success/Issue identity/title/description/URLを照合しupdated原本を保存。claim後unknown/保存障害で再mutationしない。AuditはApproval/claim/receipt完全一致で投影し本文を出さない。

Ruling: 外部baseline読取とmutationは非原子的。公式issueUpdateに期待version条件を確認できないため、read時点の競合拒否を保証し、それ以降の他writerとの排他/CASを保証しない。判断が誤ればread後に他者編集を上書きし得るため、READMEで明記し実API受け入れは残す。

## Task 1: 承認原本RED→GREEN

Interfaces: Approval domain/SQLite、既存Linear target parser。
新closed operation linear_issue_updateを追加。baseDigestとinputDigest/Issue/version/humanを固定し、不正/余分field/別WorkItem/Agentを拒否。SQLite再open/requestOnceで原本維持。
Run: pure/SQLite Approval tests。
Expected: 新kind拒否のREDからGREEN、既存全操作維持。

## Task 2: native/DI RED→GREEN

Interfaces: Task get、Approval、Event、SecretStore、HTTP、clock、CLI。
実CLIでimport→request(read only)→pending no HTTP→human approve→並行apply一回mutation→Audit/reopen no replay。remote baseline変更/unknown/claim保存/receipt保存障害、入力/応答不正、資格情報反射をDIで確認。既存read/query/claim/receiptの二操作以上で使う処理を再利用。
Run: native/update DI、既存comment/Artifact、static。
Expected: 未対応CLI/サービスのREDからGREEN。

## Task 3: 証拠・全gate・review・公開

Run: bun run check、非空dry-run→実Jev、fresh最終review/Ponytail、一回Critical/Important TDD修正、通常main反映/push。
Expected: 全gate成功。結果不明のupdate読取回収・Agent操作・実API認証・TaskProvider全交換・実業務Draft PRは全体目標の残件を維持。

## Review Focus

baselineとtarget入力の混同、nullと空description、別Issue/URL/identifier/本文を持つmutation応答、credential取得中/HTTP中のLocal変更、外部read→writeの非原子的限界、並行claimと保存障害後再送禁止、既存全caller/Audit原本の維持、raw title/descriptionを公開ログやApprovalへ格納しないこと。
