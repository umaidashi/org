# daemonのdurable自動wake-up

manual Room activationは実Maxまで検証済み。同じ操作をdaemon pollingへ結線する。Runtime設定を渡したdaemonに--wake-upを明示し、既存DBの未処理Messageも対象とする。

1. WakeupJournalをDI。SQLite所有のimmutable intentとimmutable terminal resultを別tableに保存し、原本をJOINしてrunning/completed/failedを投影。Message単位のintent UNIQUE、BEGIN IMMEDIATEでclaim二重拒否、結果の参照/二重確定/UPDATE/DELETE/REPLACEを拒否。原子保存のrollback/reopenを実DB TDD。
2. pollRoomWakeupsはRoom/Message/Sessionを読む。人間発言・明示mention・A2Aだけを候補とし、selectActivationAgentsで絞る。busy Sessionは未claimのまま次pollへ延期。claimを永続化してから既存activate callbackを呼び、成功replyIDsか失敗のgeneric errorを確定する。一つの失敗で他Messageを止めず、次poll/再起動で確定intentを再実行しない。起動時未確定intentはfailedへ確定（自動で副作用を再試行しない）。manual activateでの再試行は既存返信再利用を保つ。
3. daemon --wake-upはcontinuous/runtime-config必須。既存daemonは自動起動しない。wakeupsのGET/CLIで履歴投影を取得。async tickの重複実行を抑止し、stopはRuntime cancel→tick drain→DB close。実daemon fixtureで自動coordinator/mention、失敗no retry、restart no replay、停止中turnのdrain/recoveryを確認。全ゲート/実Jev/独立レビュー→commit。

Ruling: intentはMessage単位（all policy複数Agentは一つの処理）。部分成功後の失敗はmanual activateで残りを再試行し、既存返信を再利用する。無制限retryや新rule engineは作らない。自動再試行policyとper-Agent receiptは必要なretry要件を実装する次段階で扱う。誤りのcostは一部Agent失敗後にmanual操作が必要なこと。

ponytail ceiling: local single-worker scans Room histories; cursor/indexは実測の履歴量/throughputが必要になったら追加。exactly-once provider effectsは保証しない。失敗/中断原記録は保持し、自動で再実行して隠さない。Notion Schedulerの定期schedule/Task retryは別に残る。
