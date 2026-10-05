# Room要約を新Claude Sessionへ引継ぐ

Notion Room/Sessionの再構築要件を実機で確認する。既存strict Memory抽出/自動採用/30件Context/Session stopと自動fresh startを再利用し、製品コード・新要約store・定期LLMは追加しない。

既存実Memory proofの後でhumanが供給した2factsのsemantic Room要約を依頼し、実Claude返信原本→自動Memory採用/根拠照合を確認。Sessionをstopし、31件の通常Agent Messageで原本を直近30件から外す。新human requestでfresh Kernel/provider Sessionが要約Memoryを使うこと、原本/Memory/restart不変を確認する。

Ruling: 明示human依頼の要約生成/自動採用だけ。常時圧縮・定期summary・意味dedup/conflictは未完了。既存製品の組合せの証拠追加で、未実装APIを仮造したREDは作らない。既存native Memory/invalidation回帰を維持する。

1. 既存proofを延長し、通常native/型/lint/ASTを確認。
2. 実Maxで要約からfresh Sessionと再起動まで、全check/実jevを確認。
3. 正しさ/安全性/Ponytail独立最終review一回、重要指摘一fixpass、Git/main通常push。
