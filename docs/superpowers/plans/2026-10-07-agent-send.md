# Agentへの明示送信CLI

Spec: [全体監査](../../completion-audit.md)、Notion 01/02/07/08、[全体要件](../../requirements.md)。既存Room/Message/activation/Session/Contextを再利用する。

## Task 1: agent sendを既存の対話経路へ接続

1. `org agent send AGENT_ID MESSAGE --room ROOM_ID --human HUMAN_ID [--json]`をnative Room wake-up e2eへ追加し、未対応commandのREDを確認する。参加human/対象Agentを明示する。曖昧な名前やRoomの自動選択、新しい会話保存先は作らない。
2. Agent存在とRoom/参加者/未archive/Messageを既存domainで検証し、human原本Messageに対象Agentだけのmentionsを付けるDI serviceを追加する。空/未知options/直接transportを保存前に拒否する。既存のdaemon activateRoomを使い、指定Agentだけの返信と同Session再利用を返す。
3. Runtime失敗でも保存済みMessageは残し、そのIDを非ゼロエラーで示す。修復後は既存room activateで同Messageを再処理し、成功済みの再activateは元返信を返す。新sourceを勝手に作り直さない。未知Agent/非参加者/archiveで書込み/Runtimeゼロ、参加coordinatorの暗黙起動なし、原本/再読取りをDI/nativeで確認する。
4. fast DI UT、型/lint/AST、全check、非空dry-run/実Jev、Ponytailと独立正しさreview、ログ/Git/main通常公開。実Claudeで今回の新verbを実行していない場合はnative fixtureと明記する。

Roomは明示必須、人間IDはローカル管理者の宣言であり本人認証ではない。hostの既存activation policy/Runtime設定を使う。新DDL/依存/Runtime engine/汎用retryを追加しない。RPC認証/外部実API/TaskProvider/Memory等の残件を維持する。
