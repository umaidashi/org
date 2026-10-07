# Memory更新の重要操作Audit

08の重要操作棚卸しで未接続のcapture/supersede/invalidate/consolidateを対象にする。既存SQLite writer/transactionとcollectAuditを再利用し、新しい監査engineは作らない。

1. 実callerをmanual CLI、Room proposalの手動/自動抽出、Task review projection、夜間consolidationまで追う。SQLite adapterへ操作主体/clockをDIし、抽出Agentなど個別主体はwriter引数で上書きする。proposal/reviewの過去createdAtを実更新時刻として記録しない。trusted local-hostとCore自動処理を区別し、人間の本人認証を推測しない。
2. RED: 成功した更新が公開Auditへ出ない。SQLite transaction内に不変操作原本を追加。入力/出力は原本URI、本文/秘密値をAuditへコピーしない。既存データの主体を推測したbackfillなし。
3. createOnce/replayed consolidationのno-opはAuditを増やさない。失敗時はMemoryとAuditの両方rollback。supersede/invalidation/consolidationの原本と対応を検証。
4. 実CLI capture/supersede/invalidate/consolidate→audit/logs→再open、auto/review callerの主体/clockも検査。全check/実Jev/fresh一review/Ponytail/作業ログ/通常main push。

Session/他設定の監査、実業務Issueから納品、外部API認証は別残件。互換内部callerが明示主体を持たない場合は未知として扱い、human実行を捏造しない。
