# 明示Roomだけの夜間Memory整理

根拠: Notion conservative/nightly policy。検証済みatomic Consolidatorを利用し、Runtime/外部APIを呼ばずhost opt-inでRoomごとdaily UTC一回だけ整理する。

## 設計

continuous daemonの`--memory-consolidation-room ID`（繰返し可、最大32、重複/空/過大/once/client mode拒否）がRoom allowlistを設定する。Runtime configは不要。最初のpollから現在UTC日の最終midnight slotを処理し、以降最初の翌日pollで一回。missed daysは現日だけにcoalesce。keyは固定prefix+Room SHA256+UTC日、receipt時刻は実際の最初のpoll時刻。再起動・同日poll・時計巻戻りは不変receiptとlatest keyで再整理しない。archived Roomは処理対象外、欠損/不正receipt/DB障害は既存daemon error境界へ伝播する。

MemoryConsolidationHistory Portのlatest prefix読取はPK範囲検索、scope listは公開receiptの閲覧。CLI`memory consolidations --scope room:ID --json`で原本参照/keeper/invalidated/時刻/keyを読める。Consolidatorは既存Room公開Port callbackをtransaction開始後にも使う。nightlyによる原本変更・意味dedup・根拠mergeはしない。更新された同日のMemoryは次のUTC日に整理する。

## 計画

1. RED: poll service未module、daemon flag/receipt list CLI未対応。UTでfirst/day boundary/coalesce/clock rollback/archived/error/explicit allowlistを最小DIで検証。
2. native history読取・schema範囲query、daemon parse/配線、receipt read CLIを実装。
3. 実daemonでtwo duplicate→opt-in start→one receipt/active→同日new duplicate保持→restart no replay、archived/非allowlist保持を検証。純粋clock DIで翌UTC日を確認し、時刻のOS変更や24h sleepはしない。
4. fullcheck/実jev/独立最終review1回・文書/証拠/Git/main通常push。一般semantic consolidationは未完了。
