# Session重要操作Audit

作成/Runtime開始・成功・失敗/stop/rebuildの新規操作を、状態とsession_historyと同じSQLite transactionに不変原本として保存。mandatory Readerで公開Auditへ接続。生promptは複製せず、shared Runtime入力の参照生成をDIで渡し、実daemon entrypointでSHA-256。互換内部callerの参照生成未設定はSession version参照であり、生入力のdigest証明ではない。

- 初期RED0成功1失敗47ms→GREEN11成功83ms。
- 同時刻13操作の公開順序RED1成功1失敗63ms→固定長数値ID/causal keyで順序保持。共通sort/phase仕様を変更しない。
- Task Room作成のTask ID欠落RED3成功1失敗78ms→create/rebuildへ既知Task関連とsystem/runtime-manager主体。RuntimeはAgent、stop/recoveryはadapter Core/内部未指定。人間本人の認証ではない。
- 初期native4成功7.28秒、Task-context修正後8成功7.67秒。実CLIのdigest/Task Actor/stop/restart/rebuild/ref/reopen。
- fresh reviewer Important1/Critical0/Minor0、Ponytail Lean/net0。Task別ログからstop/recovery終端が落ちる実反例。review RED4成功1失敗76ms→同writerが直前の不変操作原本のTask関連を引継ぎ、GREEN17成功4files108ms。実CLI含む9成功3files7.19秒。一fixpass/再レビューなし。
- storage障害で作成/遷移/rebuildが全rollback、no-op stop不増、不変replace/update/delete、reopen、legacy原本への偽backfillなしを確認。

changing-tree-checkは523成功21skip1失敗、before-review-fix-checkは変更中のdaemonでTask終端assert2失敗。コード変更中に始めた検査のため最終treeの成功証拠に使わない。最終検査はverified-checkを別保存する。

人間認証/外部provider内部実行/別process権限原子性はdeclined to judge。既読情報回収/Context本文真偽も新保証ではない。Room/Task/Event/Subscription/Scheduleと実業務API受入/全体は未達。

- 最終固定tree terminal0: 525成功21skip0失敗546tests214files186.89秒。type/Oxlint/Oxfmt371files/非空AST/dry-run成功。実Jev2421subjects146warnings、missing/unsure/review/errors/degraded0。変更source/test対象あり。抽象failure-path候補を拒否/rollback/CAS/Task-filtered terminal/no-op/reopen/nativeで照合し、具体未対応反例なし。
- Notion root/08をconnectorで再fetch成功、前回content bodyと一致。raw本文の新公開・Jev送信なし。verification/独立編集時刻の証明へ言い換えない。
