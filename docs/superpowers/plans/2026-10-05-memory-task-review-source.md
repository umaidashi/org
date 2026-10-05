# MemoryのTaskReview根拠

- MessageだけだったMemory sourceRefsへ `{uri: org://tasks/TASK/reviews/REVIEW}` を追加する。legacy roomId/messageId JSON互換、未知/混在field/不正URI/重複を共有domainで拒否する。
- capture serviceは公開TaskReviewReader/getをDIし実Task/不変reviewの一致を検査してから保存する。SQLite所有者を跨いでSQLを読まない。CLI `--source-review URI` と従来room/messageは排他、DB作成前にURI検証。
- 最小UT RED→GREENと既存TaskReviewの実daemon e2eへMemory capture/reopen/レビュー原本不変を追加し、全check/実Jev/final review/ログ/main push。
- approved/rejected reviewはいずれも事実の根拠。内容の意味を自動保証せず、自動episodic extractionは次の小変更で接続する。Event/Workflow/外部Artifact sourceは後続。
