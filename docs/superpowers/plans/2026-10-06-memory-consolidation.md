# 保守的MemoryConsolidatorの最初のe2e

根拠: Notion MemoryのConsolidator Port/conservative policy/nightly consolidation。まず明示CLIから、同Roomの完全同値Memory整理を検証し、その後に夜間daemonを接続する。意味推論による削除・上書きはしない。

## 設計

`memory consolidate --scope room:ID --key KEY --at UTC_ISO`はactive Roomだけを対象に、activeかつ有効なMemoryをtype/content/confidence/validity/tags/entities/importanceの同値キーでまとめる。sourceRefs/原記録は保持。各groupの最も古いcreatedAt/IDをkeeperとし、残りの同値Memoryだけを理由付きinvalidateする。非同値metadataや別scope/typeは変更しない。inactive Keeperへの付替えをしない。

MemoryConsolidator PortはRoom/Provider/ConsolidationStoreをDI。純粋selectionとnative所有者のatomic commitを分ける。新しいSQLite consolidation receiptはkey/scope/at/keeper IDs/invalidated IDsだけを不変保存、candidate内容は追加複製しない。commit時にkeeper/obsoleteのcurrent snapshotを原本比較し、一変更でもずれていれば全rollback。同じkey/scopeの再実行は元receiptを返し、atを更新しない。keyの別scopeへの流用を拒否。途中storage失敗でreceiptもinvalidationsも残さない。既存原本Message/Memoryは削除・上書きしない。

## 計画

1. DI/pure UT RED: plan/service未module。同値metadata、scope/type/validity除外、deterministic keeper、key既存、active Room guards、時計/ID注入を確認。
2. native SQLite Portとimmutable receipt/schemaを実装。rollback・snapshot競合・REPLACE/UPDATE/DELETE拒否・再openを実DBで検証。
3. 実CLI RED→GREEN: duplicate作成→明示整理→原本保持/Context activeのみ→再実行同receipt→再open。fullcheck/実jev/独立最終review1回、文書・証拠・Git/main通常push。
4. Next（別branch）: explicit Room opt-inとdaily UTC slotをdaemonへ接続し、不変receipt/clock rollback/latest missed slot/restart no replayの小e2e。

全source根拠はkeeperだけへmergeせず、inactiveになったduplicate原本にも維持する。意味dedup/conflict推論、summary生成、global/company全自動処理は未完了。


独立review後のfix: MemoryConsolidationStore.commitConsolidationはauthorize callbackを必須DIとする。native AdapterはBEGIN IMMEDIATE後にcallbackでRoom公開Portを再照合する。RoomのSQLをMemoryへ複製しない。同じlocal DBのwriter lock下でarchiveの介入を防ぎ、選択後archive済みなら全rollbackする。外部Room/別DBの分散transactionは保証しない。
