# Memory全文検索

- SQLite標準FTS5 trigramで日本語を含むliteral substring検索を追加する。原本JSONを読むexternal-content view、index/insert trigger/初回rebuildは同native immediate transaction。新server/Vector DB/依存なし。
- MemoryProvider.search公開Portと`memory search QUERY`（scope/type/tag/entity/at filter）。searchは現在active/期間内だけ返す。get/listは原本保持。queryは3〜1024 Unicode文字、FTS syntaxはliteral phraseへescapeしboolean/path操作に解釈しない。
- RED→GREEN実SQLite（旧DB初回backfill/2Adapter/再open/原本不変/FTS書込失敗rollback）、実CLI検索→失効除外、全check/実Jev/独立final review/ログ/main push。
- 本文のliteral検索。自然言語の語分解/semantic rerank/自動Context full-text queryは後続。既存Contextのscope/tag選択を壊さない。
