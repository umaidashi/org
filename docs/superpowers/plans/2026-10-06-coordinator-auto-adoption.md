# 明示RoomのCoordinator返信を一回採用

既存のactivateRoomMessageとadoptDelegationProposalを再利用する。新しいqueue/receipt table/一般tool loopを作らない。

## 設計

continuous daemonの繰返し`--delegation-room ID`（最大32、unique/空白/NUL/長過ぎ拒否）は--wake-up/Runtime config必須。起動時にactive coordinator-policy Roomと明示Coordinatorを検査し、デフォルトoff。許可Roomの参加human原本をactivateした直後だけ、その人間へのCoordinator返信一件をnative Messageから再読込して採用する。typed A2A/結果/decision/通常Agent原本への返信は対象外で、連鎖しない。

Coordinator Contextへ現在の直属参加専門Agent ID/name/roleとstrict delegate JSON schemaを渡す。plain textまたはJSONだがtool!=a2aなら通常返信。JSON parse不能も通常本文のまま。tool=a2aなら厳密parser/既存権限/原本/直属対象/安定IDへ通し、無効要求はactivation failedへ伝播、黙って成功にしない。採用したdelegateは次のpollで既存activation/task/review経路へ接続する。

Runtime返信保存とadoptは別transaction。返信後・採用前crashはfailed wakeupとして保持し、手動room activateまたはa2a adoptで既存返信を回復する。採用後crashは既存stable delegate IDと冪等Taskで重複しない。自動retry/一般tool loopは完了としない。

## 計画

1. callback serviceとflag validationをDBなしRED確認。
2. 既存activateの結果直後へ小さいhookを接続。human原本/Coordinator reply/Room policyを読取再照合。
3. 実CLI fixtureの手動adoptを削除して自動delegate→専門Task→review→restartを検証、非opt-in/Agent source/非proposal除外をUT確認。
4. fullcheck/実jev/独立review一回、Important一fixpass、docs/Git/main通常push。

## Review Focus

非opt-in Room・非human source・別replyTo・Coordinator変更・typed A2A返信・権限失効・保存失敗の伝播・crashによる二重委譲。Contextはhost生成で資格情報を含めない。
