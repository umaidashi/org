# Task実行履歴のAudit公開

- 目的：Runtime/Sandbox共通のrunning→waiting_approval/failedの原本を、actor・Task・Event・入出力参照・時刻・結果付きでaudit listから参照する。
- 既存の不変Task historyは状態と同じtransactionで保存されるため、別Audit table/書込を増やさず純粋projectionで再利用する。
- 実行を開始したownerをactorとし、結果はそのrunningのownerを保持する。Task snapshot参照が入力/結果のArtifact IDを保持する。承認待ちは実行成功であり人間の承認ではない。
- Eventは既存org:event:外部参照からのみ取得。外部由来でないTaskはnull。詳細なtool引数/資格情報/本人認証はこのprojectionで補完したと主張しない。
- RED：純粋Auditの開始/成功/失敗/人間review非混同と、実CLIで既存履歴の公開を確認。GREEN後に全check/実Jevを実行し、既存Approval Auditも維持する。
- ponytail: 全Task履歴の線形projection。計測で必要になれば所有Portの絞込を追加する。
