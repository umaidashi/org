# 承認付き既存Linear Issueの選択field更新

Spec: [要件](../../requirements.md)、Notion 04 Task抽象化のstatus/owner/labelsと外部WorkItem/内部Execution分離。Coreの状態/Agent IDをLinear UUIDへ暗黙変換しない。

既存`request/apply-linear-update`へ`--fields JSON`を追加する。title/descriptionの旧モードと排他。許可するfieldはstateId、assigneeId（nullは解除）、labelIds（空配列は全解除）のみ。UUID・重複・型・上限・未知fieldをHTTP/DB前に検証してcanonical化する。新Issueを作らない。明示したfieldだけをIssueUpdateInputへ送信し、他のfieldは送らない。

既存linear_issue_update Approvalへoptional field maskを追加し、旧原本/digest/SQL schemaを維持。入力digestはcanonicalな選択field値、baseline digestはIssue identity/URLとそのfieldの現在値へ固定。旧title/descriptionのbaseline/input digestは変えない。要求/read前後Local version照合、一回claim、返却identity/field照合、保存障害後no replayとAuditを既存serviceで再利用する。不明結果のobserveも同mask/digestで別observed原本を保存する。

## Task 1: closed field契約RED→GREEN

Approval field maskとUUID/nullable assignee/set labels parserの最小UTを先に失敗させる。SQLite reopen/requestOnceと旧原本互換を検証。field maskの未知/空/重複/非正規順序を拒否。

## Task 2: native/DI RED→GREEN

既存native update e2eをcontent/fields両モードへ拡張。fields未対応CLIでRED、成功/unknown/stale baselineの各経路と並行apply一回/observe唯一原本/再open HTTPなし/Local原本不変をGREENへ。選択だけ送信し未指定title/descriptionを変更しない。DIで部分選択/解除/labels順序正規化、pending/入力変更/fieldmask変更/不正応答/不完全labels page/Local競合/保存障害/secret反射を確認。既存comment/Artifact/read callerを維持。

## Task 3: 全gate・review・公開

文書/作業ログ/証拠を更新し全check・非空dry-run・実Jev・Ponytail・独立最終reviewを実行。重要指摘があれば一回TDD修正。通常main反映/push。実API認証、Team参照の実サーバ整合性、human認証、自動双方向同期、TaskProvider全非同期交換、実業務Draft PRと他の全体未完了を残す。

Ruling: read/writeは非原子的baseline preflight。誤ると読取後の他writer更新を上書きし得る。選択だけ照合して未選択を送らないことで無関係fieldの更新は避けるが排他は保証しない。
Ruling: IDsはLinear Adapterの明示入力。Coreのstatus/owner/labelsを勝手に対応付けない。誤ると外部参照と内部状態が混同される。Server参照/Team検証は実認証受け入れで別途確認する。
