# Room rule_basedの最小native契約

Notion Room仕様を再取得し、rule_based enumとRoom/Session/Memory分離を確認した。ルール形式は仕様にないため最小契約を決める: Room作成時にactivationRules [{agentId,metadata:{key:scalar}}]を固定保存する。人間Messageのmetadataが全キーで文字列/数値/boolean/null完全一致したとき、参加Agentだけを選ぶ。複数一致は重複排除。明示mention/A2Aが優先し、Agentの通常返信から暗黙起動しない。

任意コード/regex/LLMによるルール評価は不要。ルールは1..32、条件1..16、キー64字・文字列1024字上限、未知field/参加者外/非scalar/非finite/reserved mentions・a2aを拒否。他policyのルール混入も拒否。rule_basedの旧Roomでルールなしは既存fail-closedを維持する。

RED: pure target判定と実CLI --activation-rules未対応。GREEN: pure validate/match→SQLite再open→Room targets→daemon native Runtime返信・再起動no replay。型/全test/lint/AST/実Jevとbranch最終レビュー。raw Notionは新たに保存しない。
