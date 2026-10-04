# 生成物のレビュー方法

## 必須のローカルゲート

`npm run check` は型検査、type-aware ESLint、format確認、ASTスキャン、テスト、jev-lint dry-runを実行する。APIキーがなくても必須ゲートを実行できる。すべてローカルで行い、GitHub Actionsは使わない。

| コマンド | 検査内容 |
|---|---|
| `npm run typecheck` | strict TypeScript |
| `npm run lint` | promise・unsafe操作・依存境界・空catch |
| `npm run format:check` | PrettierでTSと設定ファイルを確認 |
| `npm run lint:ast` | domainの副作用・infra importをASTで検出 |
| `npm test` | unit・実DB integration・別プロセスe2e・ASTルールのfixture |
| `npm run review:plan` | jev-lintの対象、ルール、送信予定、概算。外部送信なし |

型検査や静的解析の成功と、意味レビューの成功は別に記録する。ASTのfixtureは許可例・禁止例・文字列/コメント内の似た語を含み、文字列検索での誤検出を防ぐ。

## jev-lintの意味レビュー

Node 24以上。`TYPESAFE_API_KEY` または `TYPESAFEAI_API_KEY` を環境変数またはGit除外済みの `.env` に設定する。キーを共有設定ファイル、Git、作業ログへ書かない。`review:semantic` はNodeのenv-file機能で `.env` を読み、環境変数に設定済みの場合はそちらを優先する。

```sh
npm run review:plan
npm run review:semantic
```

実際のレビューでは、対象の `src/`、`tests/`、`scripts/` とproject ruleのcontextであるコーディング指針が外部APIへ送信される。Notionのsnapshot・検証ログ・資格情報・DBは対象にしない。実送信前にdry-runの対象と見積もりを確認する。

選ぶ規則は、関数名、コメント、catchでの失敗伝達、テスト名とassertの対応、失敗経路のテスト、およびこのKernelの判断/副作用の境界。project ruleは `docs/coding-guidelines.md` をcontextとして読み、指針の変更時にはキャッシュを失効させる。

`org-functional-core` はプロジェクトのラベル付きcorpusで未校正。閾値2.5、severity warningとして候補を出し、ブロッキング条件には使わない。既定ルールの確率も人間または独立Reviewerが確認する。lintの成功だけでマージしない。

実行結果は `docs/verification/` に記録する。verdictが欠ける・通信に失敗する・キーがない場合は未実施/不完全と記録し、正常な意味レビューとして扱わない。キャッシュの内容は送信対象コードを含むため自動コミットしない。

## 実行するタイミング

| タイミング | 実行者と検査 |
|---|---|
| 実装前 | Agentが対象テストのREDを確認 |
| 小さな変更後 | Agentが対象unit/integration/e2eを実行 |
| 検証単位の完了時 | Agentが `npm run check` と `npm run review:semantic`、指摘の判定・必要な修正・再検証 |
| pre-commit | Lefthookがステージ済みtreeで `check:static`（型・lint・format・AST） |
| pre-push | Lefthookが実際にpushされる各commitのtreeで全検査と実際のjev意味レビュー |

`npm run hooks:install` でLefthookのpre-commit/pre-pushを設定する。モデルへの送信をコミットごとに発生させず、Agentの区切りとpush前に行う。未校正のwarning候補は報告するがモデルだけでブロックせず、error指摘・通信失敗は非ゼロ終了としてpushを止める。

pre-commitはGit indexを一時ディレクトリへ展開し、未ステージの修正でチェックが通ることを防ぐ。pre-pushはGitの標準入力から全更新のlocal object IDを読み、HEAD以外のbranchも対象にする。削除のみの更新にはコード検査をしない。元のindex/worktreeは変更せず、一時検査treeは終了時に削除する。

依存パッケージはインストール済みのローカルnode_modulesを再利用する。package/lockfile変更時は先に `npm ci` を実行して一致させる。モデルのキャッシュと実行recordはGit除外した `.jev-lint/` に保存する。

pushせずにHEADのtreeを確認する場合は `npm run verify:head`。これは実際のネットワークpushを行わない。pre-pushでキーがない・通信に失敗する場合は未完了として停止する。

## 参考

- [Voicyの記事](https://tech-blog.voicy.jp/entry/2026/09/30/231259)
- [jev-lint README](https://github.com/mizchi/jev-lint)
- [jev-lintのルール・CLI仕様](https://github.com/mizchi/jev-lint/blob/main/docs/reference.md)
