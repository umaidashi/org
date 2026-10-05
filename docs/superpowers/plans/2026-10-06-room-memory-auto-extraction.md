# 明示RoomのMemory候補自動採用

既存MemoryExtractor/原本根拠検証/createOnceを再利用し、`daemon --wake-up --runtime-config PATH --memory-extraction-room ID` の明示allowlistだけをactivate直後へつなぐ。新LLM呼出・queue・table・retry基盤は作らない。

human参加者の原本入力に対する同Room Runtime返信IDだけを選択し、typed A2Aを除外。普通の返信はそのまま、strict JSON tool=memoryを一件だけ採用（複数は書込前に拒否）。fixed room scope/参加Agent/read+write能力/過去同Room根拠/厳密型/boundsは既存extractRoomMemoriesへ委譲。結果/decision/Eventへの返信を自動採用せずloopを避ける。Contextに既存schemaの案内を追加し、Memory用途でない返信は普通のまま。

reply保存と候補採用は別step、batch全体transactionは保証しない。候補全体先行検証と各recordの原子保存/安定IDを保持し、途中storage障害はfailed wakeup、manual extractで回復できる。自動retry/全scope抽出/意味dedup推定は後続。legacy nonopt-in動作は維持。

1. hook/daemon flag未実装RED、DBなしUTで通常text/noAgentSource/foreignreply/multi/capability/evidence/replayを検証。
2. 同じCLI Room allowlist検証を再利用し、起動時active Room確認、既存Runtime Context/activateへGREEN。
3. native fixture Agent→自動採用→次Context→invalidate/restart no revival、non-optin原本のみを実CLI確認。
4. fullcheck/実jev/独立最終review一回・必要Important一fixpass・Git/main push。
