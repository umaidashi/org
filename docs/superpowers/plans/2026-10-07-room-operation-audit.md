# Room重要操作Audit

08の残る状態変更をRoom単位で進める。既存create/archive/append writerを追跡済み。Messageには不変原本とsender/createdAtがあるため、同じ内容の新監査原本を複製しない。Room作成/初回archiveには実行主体と不変状態履歴が不足。

1. RED: Room作成/初回archive/Message原本が公開Auditへ出ない。
2. Room作成・初回archiveを既存SQLite transactionへ接続し、不変の操作原本を保存。過去のRoom作成主体を推測したbackfillなし。既存archiveRoomのno-opは監査を増やさない。必要な入出力状態参照を同じ原本に結び、現在の可変Room行だけで過去の構成を証明しない。
3. Messageは既存immutable sender/time/referenceの投影を再利用し、本文をAuditへコピーしない。senderは明示された論理主体であり、人間本人の認証ではない。
4. trusted CLI local-host/Core自動callerの主体をDI。Task Roomの既知Task IDを維持。失敗rollback/immutability/no-op/reopen/同時刻順序を最小DIと実CLIで検査。
5. mandatory collectAudit Reader、全check/実Jev/fresh一review/Ponytail/作業ログ/main通常push。

Task手動CRUD/Event/Subscription/Scheduleの操作別監査と実業務API受入は次の残件。別の汎用監査engine/低水準read監査を新設しない。
