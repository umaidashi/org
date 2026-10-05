# Memoryの有効期間とContext

- Notion03を再取得しoptional validFrom/validUntilを照合。型はUTC epoch milliseconds、CLIはミリ秒付きUTC ISOを受ける。
- 入力をsafe整数/Date範囲/from<untilで検証し、既存JSON原本へoptional fieldsを保存する。期間なしlegacyは従来どおり。期間切れで原本を書換えない。
- 現在有効なactive MemoryだけをContextに含める。fromはinclusive、untilはexclusive。時刻は既存返信identityから受け、domainはambient時計を読まない。
- `memory list --at ISO`で同じ判定を明示確認できる。指定なしlist/getは原本statusを表示し、監査のため期限切れも残す。
- 最小UT RED→GREEN、SQLite再openとlegacy互換、実CLI期間指定、実daemon Contextで未来/期限切れ除外を確認。全check/実Jev。
- 自動extraction/dedup/conflict/tags/entity/relevanceは次の小変更。新provider/schema/timerを追加しない。
