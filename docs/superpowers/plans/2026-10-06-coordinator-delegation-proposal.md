# Coordinator原本から専門Agentへの委譲

根拠: 再取得したNotion Agent/組織/A2A仕様。人間の入力はCoordinatorだけを起動し、必要な専門Agentだけをtyped delegateで起動する。

## 設計

最初の経路はlocal adminの明示`a2a adopt ROOM --message ID`。参加CoordinatorのRuntime返信原本を厳密JSON `{version:1,tool:"a2a",type:"delegate",to:AgentID,payload:JsonValue}`として採用する。from/Room/Task/correlationはhostが原本・Roomから固定し、モデルには指定させない。64KiB上限、未知key・空to・self宛・human原本・既存typed A2A・coordinator不一致・archiveを拒否。can_read/can_write/can_delegateを必要とする。宛先はRoom参加AgentでreportsToがCoordinatorに一致する直属専門Agentに限定する。

不変typed MessageのmetadataにproposalRefを保存し、SHA256(Room,proposal)由来IDと原本時刻を使う。既存IDは原本から再構成したMessage完全一致を確認して返す。append競合も同一原本一致だけを回復し、別内容や通常storage failureを成功へ変換しない。native appendはRoom archiveを同一transactionで再検査する。capability/reporting変更の同時raceは現行A2A境界と同じ先行検査であり、本人認証/外部RPC保証とはしない。

既存の--wake-up typed delegate activationを再利用し、専門Agent ExecutionTask→成果物→human review→typed decisionの一周へ接続する。自動proposal採用や一般tool loopは後続。

## 計画

1. DBなしparser/service UTと実CLI未対応RED。
2. strict parser/原本拘束/権限/直属関係/安定ID/競合回復とCLI wiringをGREEN。
3. native daemon fixtureで人間Message→Coordinator Runtime返信→adopt→専門Agent Task結果→review、restart duplicateなしを確認。実Claude Maxは別private fixtureで原本生成を確認。
4. fullcheck/実jev/独立最終review一回、Important一fixpass、文書・証拠・ログ・Git/main push。

## Review Focus

原本差替え、Message全field一致、宛先/送信者偽装、権限不足、archive競合、storage失敗の誤回復、既存A2A replyToとの互換。業務外部書込みは行わない。
