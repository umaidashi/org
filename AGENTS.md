# 開発の進め方

- 小さな動作を実装し、実際のCLIを使う小さなe2eを確かめながら積み重ねる。
- 依頼、承認、設計上の決定、変更内容、実行した検証と結果、未完了事項は `docs/work-log.md` に時系列で追記する。
- 設計書と実装計画はリポジトリ内に保存し、作業ログからリンクする。
- コード、テスト、文書、作業ログをGitに記録する。検証の成功は実行結果を確認してから記載する。
- 秘密情報や認証情報をログ・Gitへ記録しない。作業ログは判断と結果の記録であり、内部の思考過程は含めない。
- 現在の実装言語はTypeScript。Python版の初期記録は履歴として保持する。
- 全体目標と未完了項目は `docs/requirements.md` に照合し、狭いテストだけで全体完了を主張しない。
- 変更前に失敗するテストを確認し、変更後に型検査・全テストを実行してデグレを確認する。
- 実装前に `docs/coding-guidelines.md` と `docs/reference-implementation.md` を読む。最初のリファレンスは実際にテストされる `src/agents/`。
- 生成物にも `bun run check` を適用し、結果を記録する。lint/ASTが空実行していないことを確認する。
- jev-lintは `docs/quality-review.md` に従う。dry-runは実レビュー完了ではない。API送信対象に秘密情報やNotionのsnapshotを含めない。
- 各変更で `ponytail:ponytail-review` により不要な実装・既存処理の重複を確認し、削減候補と判定を作業ログに残す。正しさ・安全性のレビューも別途維持する。
- 検査はまず全てローカルで行う。GHAは作らない。Lefthookのpre-commitはステージ済みtree、pre-pushはpush対象のcommitを検査する。タイミングは `docs/quality-review.md` に従う。
