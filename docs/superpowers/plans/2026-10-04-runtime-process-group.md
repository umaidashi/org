# Runtime process groupの停止

目的：Runtimeが作った同一POSIX process groupの子孫が、timeout/cancel/出力量超過やdriver通常終了後に残らない。Bun runtimeを維持する。

1. 子driverが孫を起動する実subprocessテスト。PID記録後timeout/cancel/通常終了で孫が停止することをRED確認する。失敗時はfixtureをfinallyで掃除する。
2. Bun.spawnのdetachedを使用しgroup単位でSIGKILL。終了済groupのESRCHのみ許容。他の失敗は伝播する。child exit時にも残るgroupを停止する。
3. 全テスト・静的検査・実Jev・独立レビュー、結果を記録する。

Review Focus: argv/env/stdinと出力量上限を保持する。孫がstdoutを継承しても終了待ちがhangしない。daemon自身のSIGKILLや子孫のsetsidによるgroup離脱は今回の保証外で、後続Sandbox/監督processが必要。

根拠：インストール済bun-typesのdetached説明とBun1.3.4でPID=PGIDの実機確認。[Node POSIX detachedの定義](https://nodejs.org/api/child_process.html#optionsdetached)、[Bun互換性](https://bun.sh/docs/runtime/nodejs-compat)。
