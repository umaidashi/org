# TypeScript Kernel 継続実装計画

ユーザーのTypeScript指定と継続実装の指示を既存設計への変更・実行承認として適用する。Pythonの初期設計は履歴として保持し、現在の目標は `docs/requirements.md` とNotionの設計に従う。

## 第一の検証単位：Agent CLI移行

- [x] package/lockfile、strict TypeScript、Node標準test runnerを設定する。
- [x] 既存9件と同じ別プロセスe2eをTSで書き、CLI未実装時の失敗を記録する。
- [x] Agent型・SQLite保存・CLIをTSに実装する。Python版SQLiteの列・名前・UUID・UTC作成日時を維持する。
- [x] 再起動相当の別プロセスから永続データを読む。重複・空値・保存失敗・Unicode・既定パスを検証する。
- [x] unit/integrationで入力検証・既存DB互換性・保存失敗を検証する。
- [x] npmのbinから実際に起動してcreate→listを確認する。
- [x] Pythonの製品コード・テスト・manifestを除去し、READMEをTS向けに更新する。過去のログは保存する。
- [x] 型検査・全テスト・ローカルLefthook・独立レビューと検証結果を記録してコミットする。

## 第二の検証単位：Taskの作成・割当・取得・状態履歴

- [ ] WorkItem/ExecutionTask、TaskProviderの型を作る前に、作成→割当→状態遷移→別プロセス取得の失敗e2eを書く。
- [ ] SQLite、依存関係・親・Agent参照、状態遷移と不変履歴を実装する。
- [ ] CLIにtask create/list/get/assign/updateを加える。
- [ ] unitで不正遷移・依存未完了・循環を拒否する。integrationでrollbackと履歴の整合性を確認する。
- [ ] Agent e2eを含む全テストを実行して記録する。

## 全体の追跡

次の各検証単位は `docs/requirements.md` の未完了領域から選び、Notionと照合した受け入れ条件・RED→GREEN・全テスト結果を同じリポジトリに残す。全項目を実際の証拠で完了と判定するまで全体目標は継続する。

## 技術上の判断

jev-lint導入のためNode 24以上を使用する。TypeScript、標準 `node:sqlite` と `node:test` を使う。SQLite境界はAdapter内に置き、Coreの型やPortにNodeのDB型を漏らさない。CLIとテスト起動は既知のExperimentalWarningだけを抑制し、製品エラーはstderrに残す。公式資料： https://nodejs.org/download/release/v22.22.3/docs/api/sqlite.html
