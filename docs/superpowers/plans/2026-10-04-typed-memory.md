# 根拠付きTyped Memoryの最小縦断

Notion03を再取得しsnapshotと一致を確認。元Messageを真実として保持し、明示captureでMemoryを作る。自動抽出/意味的conflictは後続と区別する。

semantic/episodic/procedural/relational、global/company/department/project/agent/room/task scope、confidence、Message source refsを検証。Memory本文/根拠は不変、status(active/superseded/invalidated)は追記イベントとreplacementから投影する。supersedeは同scope/typeのactiveだけで原記録を消さない。invalidateには理由を残す。原Messageを改変しない。

domain DB-free UT→PortとSQLiteの原子追加・不変trigger/rollback/再open→capture serviceのMessage参照検証→CLI capture/get/list/invalidate→Room Contextでglobal/company/agent/room/taskのactiveだけを選択する。件数/bytesを制限して対象外scopeを混ぜない。期間/tag/entity/full-text順位・自動extract/consolidateは後続。

各段階をRED→GREEN、全suite/実jev/独立レビュー、repoの検証と要件ログで確かめる。秘密をMemoryへ自動収集しない。CLI明示操作は現段階の管理操作で、Human認証/Permissionは別途実装対象。
