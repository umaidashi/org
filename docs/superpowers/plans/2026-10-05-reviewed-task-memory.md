# 承認済みTaskの保守的episodic projection

- Agent登録時のopt-in memoryPolicy `reviewed-tasks` / `none`を保存する。既存Agent未指定はnone相当、登録後policy変更APIや無制限Memory toolは追加しない。
- MemoryProvider.createOnceは決定的IDの同原本だけを再利用し、invalidated/superseded projectionも保持する。異内容はconflict、原本/index追記は既存transaction。
- 既存--wake-up pollで、policy有効の元ownerのapproved TaskReviewを読む。reviewと前後Task履歴を純粋に照合し、レビューの事実をJSONのepisodic Memoryへ投影する。Task scope、confidence=1は記録存在の確度で結果内容の真実性ではない。title/objectiveは当時snapshot。
- shared review evidence validatorを既存A2Aと新projectionで再利用する。Task/Review/Memoryの原本所有者を守り、失敗時はMemory通知だけ再試行、Task/Artifact/Reviewを再実行しない。
- 最小UT RED→GREEN（none/reject/証拠conflict/cancel/no replay/invalidation保持）、実daemon review→Memory→再open/再起動/原本不変。全check/実Jev/final review/ログ/main push。
- ponytail: 全Task reviewの線形poll。計測で重くなったら既存journal/cursorへ移す。LLM semantic extraction/dedup/conflict/nightly consolidationは後続。
