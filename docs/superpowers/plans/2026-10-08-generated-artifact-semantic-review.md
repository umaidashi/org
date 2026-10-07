# 実生成Artifactの意味レビュー

全体再照合の独立review Important。現在checkGeneratedCodeはDocker bun check内のJev dry-runまでで、生成ファイルはfinally削除され、リポジトリの実Jev対象にもならない。ユーザーの生成物レビュー要件に対する必須Next。

1. RED: 実生成code/testが現在host semantic runnerの対象・完全verdictとして記録されないことを確認。既存の実機一周と生成物gateの証拠を再利用する。
2. 既存runSemanticReview/validateSemanticReviewと所有temporary snapshotを再利用する最小変更。新engine/providerは作らない。秘密を持つhostレビュー工程で生成コードを実行しない。実行はnetworkなしDocker gateのまま。
3. レビュー対象は検証済み生成TS/testと公開coding/rule contextだけ。Notion原文・DB・生会話・.envをコピー/送信しない。APIキーは元rootの既存.envからrunnerが読込む。subject非ゼロ・対象file・missing/errors/degradedを確認し、キーなし/不完全判定をdry-run成功へ置換しない。
4. 最小UT/負例と実Claude生成→Docker静的/テスト→実Jev→local Git handoff→review/Memory/restartを確認。判定と証拠を公開可能な範囲で記録し、生成物temporary資源/owned container/imageを後片付けする。
5. 一fresh review/Ponytail・全check/実Jev・作業ログ/Git/main通常push。外部Linear/Notion実認証・指定業務受入/全体は別残件。
