# 全体ゴールの再照合（2026-10-07）

全体は未達。現在の実装baselineは `9df2eb4`、490成功/14skip/0失敗、実Docker4成功と実Jev2303対象/欠損・エラー・劣化0まで観測済み。[最新証拠](verification/2026-10-07-sandbox-execution-audit/)と[時系列ログ](work-log.md)を参照。外部HTTP fixtureと実API認証、ローカル納品fixtureと指定業務への納品を混同しない。

## 原文と合意

root/00–10の12ページを再取得。全件成功・タイトルを照合、レスポンスの切詰め/未知block警告なし。fetch本文as-ofはroot/10が2026-10-07、00–09が2026-10-04で、独立した編集日時/Notion verificationの成功を表すものではない。公開済み保存snapshotは例示名を一般化してあるため、文字列完全一致を原文不変の判定に使わない。新しいraw本文や資格情報は保存・Jev送信しない。

全体目標は、NotionのKernelをTypeScriptで動かし、実CLI e2eを積み重ね、型/lint/AST/全テスト/実Jev/独立review/公開情報検査とGit記録を揃えること。09のMVPは、Eventで永続Agentが起動しMemoryを読み、Taskを作成/実行し、別Agent/n8nへ委譲する一周。ユーザーはこの一周だけに全体を縮めず、残件がある間の継続を指定している。検証は全てlocal、GHAは作らない。

## 現在の動作と未完了の扱い

| 領域 | 原文/合意と現在の証拠 | 判定・次の扱い |
|---|---|---|
| 永続Identity/Role・組織・A2A | 00/01。SQLite Agent/reporting、typed delegate/request/result等、Coordinator/mention policy、実Claude二Agent一周 | 必須経路は検証あり。完全A2A標準・汎用無制限tool loopは09がMVP外/将来とする |
| Room/Message/Session | 02。原本不変、複数Room/Session、両driverstart/resume/stop、明示rebuild+Room summary/Agent Memory | 検証あり。常時自動summary/全platform再実行を新たな完了条件にしない |
| Memory source/types | 03。4type、Message/TaskReview/Task実行返信、Workflow/Event/Artifact/確定Decisionの原本根拠をstrict candidateへ接続 | default保守的経路は検証あり。全履歴を無条件にLLMへ送る常時抽出は原文の明示要求ではない。全scope自動採用は現在できない制約として残す |
| Memory dedup/conflict/update | 03。完全同値dedup、metadata衝突先行拒否、明示supersedes/invalidate、原本保持 | 検証あり。本文の意味的矛盾・真偽自動推定は現方式の未対応。deterministic defaultから別LLM研究engineへの拡張を無条件必須化しない |
| Memory scope/Context/nightly | 03。7scope保存/検索/明示整理、host department/project grant、全reply経路、全scope明示nightly、再起動no replay | 検証あり。scopeは安定ID/host grantで所属directoryを推定しない。vector/rerank/別Memory presetは必要時の候補 |
| Task Core/Local/Linear | 04/09。共通非同期六操作、CAS、内部Execution分離、Core/Linear明示mapping、承認write/receipt/no resend | code/HTTP contractは検証あり。実Linear API認証・既存業務Issue受け入れは未実施。新Issueを作らない原文を維持する |
| Event/Subscription/Schedule | 05/07。Local bus、matching、冪等Task/Workflow、fixed interval、wake-up | 必須経路は検証あり。cron/calendar/別busは原文以上の拡張 |
| Webhook | 05/09。署名済みGitHub payloadをCLIから受理して一度publish/dispatchするnative contract | payload検証と常駐HTTP自動受信は別。後者/実Webhook配送は未達。public endpointの公開を勝手に行わない |
| Docker/Artifact/n8n | 06/09。one-shot隔離、repo export、run/回収/destroy、n8n invoke/status/cancel実機記録 | 検証あり。06の限定credential注入は未実装。network none/credential noneは現在の安全な既定で、任意network/万能credentialへ広げない |
| CLI/TUI/daemon | 07。全例示verbの実経路、actual PTY四領域/送信/終了、agent send、sandbox list、logs tail | 検証あり。例示の名前を安定ID/必須role/source/参加者flagへ置換する差はREADMEに明示。continuous stdout/follow/全container履歴は現方式外 |
| Agent permissions | 01/08。Agent domainにpermissions fieldなし、host resource scopeとcapabilityは別々の実行guard | 未達。fieldだけ追加して完了にしない。現実のread/write/tool resource境界を共通契約へ接続する設計が必要 |
| Capability | 08。Shell/外部service/委譲/Memory抽出でguard。Room/Session読取は参加/ownerを照合 | 全境界適用は未達。Session/Context経路でcan_readの明示取消が効くかを直接TDDで確認する。全enumに未提供のメール/支出等Adapterを作ることは要求しない |
| Credential/secret | 06/08。per-Agent cwd/選択env、SecretStore/Keychain actor/ref grant、service credential反射拒否 | 部分検証。configuredDriversは選択envを渡すがRuntime text/error/provider IDからの既知credential反射を検査しない。現在の実callerにある具体的なsecret redaction不足として最優先で扱う |
| Approval/Audit | 08。不可逆/外部write/permission変更承認、Task/Workflow/Linear/Decision/Sandbox原本Audit、actor/task/event/tool/ref/time/result/approval | 既存経路は検証あり。重要操作の全inventoryを改めて照合し、未記録操作を隠さない。内部docker setupを全て別tool/domainに増やすことは求めない |
| retry | 07/08。claim no replay、status-only観測、Local Artifact再stage、deferred delivery/A2A再処理 | 限定policyは検証あり。failed terminal Taskを無条件再送するgeneral retryは現在ない。原文が全例外の再実行を要求するとは読み替えず、必要な処理は元receipt/副作用証拠で安全性を判定する |
| 認証/物理隔離 | 08の実環境制約と07 local socket。0600/owner/PID/lease、membership/Task owner、per-Agent process env | OS同UIDの物理隔離/本人認証/Agent RPC principal認証の証明ではない。現在の制約として維持。10の未決定Role/org閲覧方針を01–09の確定schemaとして実装しない |
| 実サービス/指定業務 | 09 Phase6と既存合意。fixture/実Claude/Docker/n8n/local bare remote納品の証拠あり | `.env`設定有無のみ再確認: Linear/Notion CLI keysなし、Jev keyあり、ClaudeはMaxログイン。Notion connectorの実取得はできるがCLI REST認証とは別。既存業務Issue/変更先repoは未回答、任意Issue/外部writeを推測しない |
| Org Desk/Web | root/10。10自身が設計中・実装/issue作成対象外と明記、閲覧policy/更新閾値も未決定 | 今回の必須実装に増やさない。重いGUIは09のMVP外。文書の存在を実装完了とは主張しない |

## Rulings

- Ruling: 全scope常時抽出/意味矛盾推論/自動summary/全Adapter/全platformの証明を、原文以上の無条件必須にはしない — default保守的policyと候補/必要時の指定を尊重 — 判断が狭すぎれば別業務で必要になった機能を追加する必要がある。現方式の制約は削除しない。
- Ruling: permissions・限定credential注入・Webhook受信・既知secret反射は現在の実caller/原文に結び付く残件として維持 — enum/DI/fixtureの存在だけで代替しない — 見落とすとアクセス拒否/実配送/秘密保護を過大評価する。
- Ruling: local socketのOS所有者制約を人間/Agent principal認証へ言い換えない — 現在はtrusted local hostを操作主体としている — multi-user/remoteへ広げると追加認証が必要。未決定のDesk権限を先に固定しない。
- Ruling: 外部APIの実認証/実業務受け入れをfixtureやconnector取得で代替しない — keyと業務指定が未回答 — 原文/既存合意以上のwriteや新Issueを作成すると認可外の外部影響になる。独立した必須実装は止めない。

## Next

最初は既知credential反射のTDD。現在のRuntime設定/driver wrapperを再利用し、providerを独自実装しない。その後にcan_read/resource permissions、限定credential/実行制約、Webhook/重要Audit inventoryを小さな単位へ分ける。必要情報依存の実サービス受け入れは保留し、全体は未達のまま継続する。
