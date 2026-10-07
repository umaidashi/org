# 実Claude MaxによるLinear承認・再開の受け入れ

Spec: [全体要件](../../requirements.md)。native driver fixtureで確認した経路を実Claude Maxで確認する。Linear HTTPは固定fixtureを維持し、実Linear認証とは区別する。

## Task 1: 既存e2eの実Runtime opt-in

1. `tests/runtime-linear-approval-cli.test.ts`のfixture/setup/assertを再利用し、明示opt-inでcontent/fieldsのresumeを実Claude driverで実行する。APIキーを要求せず、既存Maxログインと明示PATH/HOME/USER/LOGNAMEだけを使う。新しいテストframework/fixtureの複製は作らない。
2. opt-in指定なのに実Runtimeを選択できない状態をREDで確認する。provider Session、提案のclosed入力、human操作承認、再起動、並行再開一回、receipt Artifact、人間結果reviewを確認する。固定driverのturn counterを実Runtimeの証拠に使わず、Session/Message履歴で再呼出しなしを確かめる。
3. Runtime専用120秒境界と投影待機に合わせて子CLI/test timeoutを限定調整する。通常の高速nativeケースのtimeoutは維持する。原本出力や認証情報を公開証拠に保存せず、件数・状態・判定のみ記録する。
4. focused実機、型/lint/AST、全check、非空dry-runと実Jev、Ponytailと独立正しさreview、ログ/Git/main通常公開を行う。

実Linear/Notion CLI認証、本人認証、既存業務Issueから実Draft PRへの納品は別の未達項目として維持する。実機の生成失敗は成功に読み替えず、具体的な入力/境界の原因を調べる。
