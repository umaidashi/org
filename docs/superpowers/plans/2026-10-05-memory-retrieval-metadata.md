# Memory retrieval metadata

- Notion03のtype/tags/entity/recency/importanceを既存Memory原本とContextへ接続する。optional tags/entities/importance、未指定のlegacy JSON形を維持し、新table/index/providerなし。
- tag/entityは非空・最大128文字・各32件・重複拒否。importanceは0〜1。CLI capture --tag/--entity repeatableと--importance、list --type/--tag/--entityで明示filter。
- 共有pure selectorへ既存scope/期間/recencyを移す。Contextはsource Messageの文字列を検索入力とし、同scope内でtag/entityのliteral一致を先に、recency→importance→IDで選択する。scope外/期限切れを先に拒否、20件/64KiBの既存上限は維持。
- RED→GREEN最小UT/実CLI再open/実daemon Context、全check/実Jev/独立final review/ログ/main push。semantic retrieval/full-text/extraction/consolidationはこの小変更では未完了。
