# 同時刻Task Auditの順序

- 同Taskのversion9開始/version10成功が同ミリ秒になると、ID文字列sortで成功が先になるMinorを再現する。
- SQLite historyは数値version順であり、projectionもその順を保持する。同時刻・同Taskのtieだけはnative stable sortで入力順を維持する。
- 追加ordinal/schema/ID parserは不要。既存Approvalのrequest/decision/apply phase順と異時刻順は維持する。
- RED→GREENの最小UT、全checkと実Jevを確認する。
