# コーディング指針

人間と生成エージェントが共通で使う実装の規則。最初に[Agentのリファレンス実装](reference-implementation.md)を読み、変更前に該当する規則と受け入れ条件を確認する。

## 構造と依存

**C01：業務の意味でモジュールを分ける。** `src/agents/`、今後の `tasks/`、`rooms/` などが単位。技術別の巨大なcontrollers/services/repositoriesに集約しない。最初から全領域の空のクラスを作らない。

**C02：判断と副作用を分ける。** `domain.ts` の関数は入力値から結果を作る。時間・乱数・DB・ネットワーク・環境変数・ログを直接参照しない。IDと現在時刻は呼び出し元で生成して渡す。純粋な判断に特別なDBセットアップを必要とさせない。

**C03：Portは実際に差し替える境界に置く。** `port.ts` はAgentRepositoryなどの必要最小限の操作を定義する。serviceはPortを呼んで処理を進め、具体的なSQLiteやSDKをimportしない。domainとPortは具体Adapterに依存しない。CLI・daemon等の起動点で配線する。

**C04：保存の所有者を守る。** モジュールのSQLite Adapterだけがそのモジュールのテーブルを操作する。別モジュールは公開Portやアプリケーション操作を使い、他モジュールのAdapterやSQLを直接呼ばない。横断トランザクションが必要になった場合は、書き込み所有者・rollback範囲を設計とintegration testに明記する。

## 型と入力

**C05：strict TypeScriptを維持する。** `any`、非null断言、根拠のない型断言で検証を省略しない。外部入力は境界で解析・検証する。型断言が必要なテストfixtureは、既知の入力またはassertで確認できるものに限定する。

**C06：状態は明示する。** TaskやExecutionの状態は文字列unionと純粋な遷移関数で表現する。網羅的なswitchを使う。型が違う成功・失敗の値を同じオブジェクトのoptional項目に混ぜない。

**C07：不変データを原本にする。** domainの入力・戻り値はreadonly。Message・Event・Decision・Execution履歴を都合よく書き換えない。Memory変更は新しいprojectionやsupersedesで表現する。

## トランザクションと障害

**C08：原子的に必要な変更は一つのトランザクションにする。** Taskの状態とその履歴、イベント受理と処理状態などは片方だけ残してはいけない。途中失敗のrollbackを実DBで検証する。SQL値は必ずbindする。

**C09：失敗を成功として返さない。** catchで空配列・0・undefinedへ握りつぶさない。Portは失敗を伝播または明示的な失敗型で返す。CLI境界はstderrと非ゼロ終了コードに変換する。DB・process・sandboxはfinallyまたは明示的なライフサイクルで解放する。

**C10：実行境界で安全性を実装する。** retry・timeout・cancel・idempotency・concurrency・権限はPromptに依存しない。外部副作用の再試行は重複防止の根拠を持つ。秘密情報はコード・検証ログ・意味レビュー入力に含めない。

## 名前・コメント・ログ

**C11：名前は動作を説明する。** create/register/list/assignなどを実際の副作用・戻り値と一致させる。pure/safe/idempotentといった保証は実装とテストで裏付ける。コメントは必要な理由・制約・根拠を説明する。

**C12：変更と検証を記録する。** `docs/work-log.md` へ依頼・承認・判断・変更・RED/GREEN・全体テスト結果・未検証項目を追記する。検証出力は `docs/verification/` に保存する。環境固有の失敗も隠さない。

## テストとレビュー

**C13：テストが先。** 振る舞いを壊す具体的な変更を想定し、変更前に失敗を確認する。実装後にそのテストと全テストを通す。構造を変えるだけのrefactorは既存テストを維持し、新しい振る舞いを混ぜない。

**C14：観測できる振る舞いを検証する。** 純粋な判断はunit、SQLiteやPort契約は実物を使うintegration、ユーザーの操作は別プロセスのCLI e2e。名前の主張に対応する値・状態・副作用をassertする。本文をgrepするテストや、実装と同じ関数から作った期待値は使わない。

**C15：空の検査は成功ではない。** テストとASTルールのfixtureが実行された件数を確認する。jev-lintは対象がmatchしたか、verdictが欠けていないかを読む。dry-runは送信予定の確認であり、意味レビューの成功ではない。

**C16：生成物も同じゲートを通す。** 手書き・生成の区別なく `npm run check` を実行する。Lefthookでcommit/pushの適切なタイミングにも検査する。すべてローカルで行う。モデルの意味レビューは補助情報として人間または独立Reviewerが判定する。未校正のモデル閾値を自動マージ条件にしない。

## 規則と自動検査の対応

| 規則 | 決定論的な検査 | 意味・設計レビュー |
|---|---|---|
| C01・C03・C04 | ESLintのrestricted imports、ASTのdomain importルール | モジュール境界・テーブル所有者・公開Portの設計 |
| C02 | ASTでdomain内の時計・乱数・process・fetch・dynamic importなどを拒否 | aliasや間接呼び出しの純粋性、jevのproject rule |
| C05・C06 | strict型検査、type-aware ESLint、promise・switch規則 | unknownの検証根拠、状態モデル |
| C07・C08・C09・C10 | unit/integration/e2e、空catch拒否、promise検査 | rollback範囲・再実行・権限・秘密情報 |
| C11・C14 | 実行するテスト | jevの名前・コメント・catch・テスト規則、独立レビュー |
| C12・C13・C15・C16 | 検証ログ、AST fixture gate、ローカルLefthook | RED→GREENの証拠、送信範囲とverdictの確認 |

ASTとlintだけで「完全に純粋」「仕様通り」を証明できるとは扱わない。制約はテスト・設計レビューと組み合わせる。新しい違反が見つかったら、再現fixtureを追加し、対応する指針を更新する。

## 参考

- [Voicyのリアーキテクト記事](https://tech-blog.voicy.jp/entry/2026/09/30/231259)：リファレンス実装と共有指針を整えて既存コードにも適用する考え方を参考にした。本書の具体的な規則はこのKernel向けに定めた。
- [jev-lint](https://github.com/mizchi/jev-lint)：型検査やlintで決定できない、宣言と動作の食い違いを補助レビューする。
