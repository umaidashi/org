# 実Claude Max二Agentの最小一周

製品の新しいqueueやAdapterは作らない。既存opt-in自動delegate/ExecutionTask/human review/Memory policy/Coordinator再開を、両Agentとも実Claude Max OAuthで検証する。

## 手順・成功条件

1. 自作private DB/daemon、native tools無効のClaude driver、Chiefと直属専門Agentを登録。専門Agentはreviewed-tasks Memory opt-in。明示delegation Roomを設定。
2. 人間から、供給された算術だけを扱う小Taskを送る。Chief原本strictJSON→自動typed delegate→専門Agent ExecutionTask結果が42を含むことを原本Artifactで確認。
3. human結果approve→一episodic Memory（canonical review根拠）→typed decision→同Coordinator Sessionの再開を確認。Session runtime/provider継続と原本/Task/Memory参照を照合。
4. daemon再起動後に同原本adoptが同delegate、Task/Memory/decision件数不変。自作daemon/DBを削除しPASSだけ記録。
5. 実務Issue/コード実装/テスト/Draft PR、業務外部書込み、一般tool loopや隔離の完了とは扱わない。full local gate/実jevと独立レビューは記録変更にも適用する。

## Review Focus

両Agentが実driverで動いた証拠、結果approve前のArtifact検証、TaskReviewからのMemory参照、同Session再開とno duplicate。失敗はprivate scriptの誤りと製品不具合を分けて記録。
