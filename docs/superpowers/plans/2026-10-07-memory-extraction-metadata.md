# Memory候補の検索metadata接続

Notion Memoryのscope/type/tags・entity/recency/importance/全文検索順と、既存のMemoryInput・Retriever・ContextBuilderを照合する。

## 受入条件
- strict JSON候補のoptional tags/entities/importanceを既存domain制約で検証し、原本参照付きRoom Memoryへコピーする。
- 旧候補は互換。scope/validity等の未許可field、誤型・重複・上限違反を保存前に拒否する。
- 同type/contentのmetadata不一致は曖昧な上書きや別active生成をせず、明示supersedesを要求する。全候補検証後だけ書込み。失効した同内容を新metadataで復活させない。
- native CLIの別プロセス再読取でmetadata/根拠と原本を確認する。

## 実装・検証順
1. 既存DI UTとnative CLI fixtureへmetadataを加えてREDを確認。
2. 既存Extractor型/JSON境界/serviceだけ変更。新Port/依存/DB migrationなし。
3. metadata不一致/invalid候補後の書込みゼロをDIで確認。既存retrieval/contextテストを実行。
4. 全check、実jev、正しさ・安全性とPonytailの独立最終reviewを一回。一Important fix pass、再reviewなし。
5. 証拠・README・要件・作業ログをGitへ記録し、mainへ通常push。

Ruling: metadata不一致は明示置換を要求する保守的契約。誤っている場合、同内容へのmetadata追加にsupersedesの操作が必要となる。意味推論/vector/新summary storeは追加しない。
