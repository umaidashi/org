# Scoped MemoryRetrieverとbounded ContextBuilder

Notion MemoryのMemoryRetriever/ContextBuilder Portと全文検索retrievalへ接続する最小変更。ユーザーの自律継続指示を優先し確認待ちは挟まない。Memory抽出の副作用や自動consolidationはこの変更へ混ぜない。

## 設計

MemoryRetriever.retrieve({scopes,at,query})をPortにし、Providerのlist/searchを受け取るlocal Adapterを実装。明示scopesと有効期間を先行適用し、既存tags/entity・recency・importance順を維持する。全文一致はそれら同順位の最後のtie-breaker（stable ID前）。queryはsource Message本文のliteral phrase、3..1024Unicode文字/NULなしの場合のみSQLite FTSへ渡し、短文/巨大本文は全文検索を行わず既存scoped selectionを使う。search実障害は伝播し握りつぶさない。Adapterが返すscope外/失効Memoryを再フィルタし漏洩を防ぐ。vector/意味rerankは追加しない。

ContextBuilder.build({instruction,room,messages,sourceMessageId,memories})を純粋Portにする。既存最大30Messages/20Memories/64KiB、入力Messageまでのみ、omitted件数、source保持、上限時memoryから削る契約を移す。roomruntimeはMessage/session/参加者/冪等reply検証とRuntime/保存の副作用を担当し、Builderを差替えDI可能にする。

## 計画

1. 新規DBなしUT RED: Retriever未moduleとscope/validity/short-query/no swallow/全文tie。Builderは30/20/64KiB/未来除外/oversize source拒否/入力不変をUT。
2. 実装し既存Room runtime全UTをGREEN。query validationは既存memorySearchPhraseと同契約、optional searchなしの既存Provider DI互換を保持。
3. 実SQLite FTSとnative daemon/Runtime Context e2eで同順位fulltext hit先行・scope外/失効除外・次Room応答を検証。
4. 全check・実jev・独立最終review1回・文書/作業ログ/証拠・Git/main通常push。全体ゴールはconsolidation/外部業務等が残る。
