# SessionとRuntime turnの接続

Notion02/06の独立Identityとstart/send/resume/stopを継続実装する。

- Session作成時とturn開始時に公開Agent/Room Portで登録/参加/非archive/runtimeを確認。
- runningを先にversion付き保存し、DI runtimeを呼ぶ。成功はprovider ID付きidle、失敗はfailedを保存する。外部エラー本文は原履歴へ保存しない。
- 同時turnを拒否。stopを先に保存してから注入cancelを呼び、遅い応答で停止状態を上書きしない。
- daemon再起動のrunningはinterruptedとしてfailedへ復旧する。既存provider IDは維持し次のturnで明示resumeする。
- DB-free UT RED→GREEN、SQLiteと実Bun fixture processをつないだ開始/再開/停止e2e、全suite/実jev/独立レビュー。

Fixture e2eは実Claude/Codexモデル成功とは扱わない。CLI/daemon API wiring、Room message/summary/Memoryによる再構築とTask連携は後続で継続する。
