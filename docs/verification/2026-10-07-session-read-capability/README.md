# Session Contextのcan_read境界

全体未達。既定grantを広げず、shared sessionAgentでstart/send/resume/rebuild/Room/Task入力前とRuntime完了保存前を制約。

- red.txt: absent/legacy grantの作成Port呼出しとRuntime中read失効の応答採用を観測、既存3成功/追加2失敗34ms。
- mutation-red.txt: 完了前guardを除いた場合、grant/runtime/archive/participant変更の4ケースが失敗（40ms）。finallyでsource復元。
- fast-unit.txt: Session/manager/reconstruction13成功38ms。新しい失敗時も旧provider IDを維持。
- native.txt: 実CLIのlegacy開始拒否、明示read成功、human Approvalのread失効、resume/rebuild/Room activation/ExecutionTask拒否、counter不増/Task成果物ゼロ、再起動原本保持1成功2.57秒。
- semantic.txt: 実Jev2330subjects/141warnings、missing/unsure/review/errors/degraded0。変更serviceの抽象的failure-path/name warningは具体的欠陥を示さず、変更guard4ケースと既存recovery回帰・独立reviewを照合した。未校正warningを自動保証にしない。

Fresh reviewer C0/I0/M1、Ponytail Lean already。非同期後の安全境界/旧provider保持のテスト不足を効果でImportantへ再判定し、一回test fix passでmutation RED→GREEN。独立focused10成功43ms。再レビューなし、Deferred minorsなし。

trusted local host内のContext構築/保存返信再取得と、新Runtime入力送信の認可は区別する。principal/全resource permissions、送信済みContext回収/取消/外部副作用、限定credential、HTTP Webhook/実業務納品は未達。

最終check.txt: 型/Oxlint/Oxfmt/AST359files、502成功14skip0失敗516tests204files181.86秒、dry-run2330subjects/excluded0/undeclared・idle・silent空。terminal0観測後保存。
