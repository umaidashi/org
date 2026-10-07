# GitHub Webhook local HTTP受信

全体未達。127.0.0.1へ明示repo/port pairだけをbindし、既存署名/importer/EventBus/Subscription/Taskを再利用。

- parser-red.txt: 新option拒否RED、既存8成功1失敗63ms。
- module-red.txt: 新moduleなしのimport失敗。個別拒否経路の観測REDとは扱わない。
- byte-red.txt: BOMを加えた本文へ元JSONの署名を流用して202、期待400でRED1失敗55ms。fatal UTF8/BOM保持decodeで修正。
- fast-unit.txt: HTTP byte/閉鎖後再照合/固定エラー/既存署名/daemon parser12成功56ms。
- native.txt: 実HTTP→Event→Subscription→Task一件、invalid signature/header/repo/oversize/BOM、重複/restart、listener stop/port occupied cleanup、既存daemon lifecycle9成功2files2.86秒。
- check.txt: 型/Oxlint/Oxfmt/AST362files、506成功14skip0失敗520tests206files182.60秒、dry-run2346subjects/excluded0/undeclared・idle・silent空。
- semantic.txt: 実Jev2346subjects141warnings、missing/unsure/review/errors/degraded0。parser/runDaemon一般failure-path warningは具体的反例なし、追加parser拒否群・bind障害cleanup・既存failure回帰と照合。未校正warningを完成の保証にしない。

Fresh reviewer C0/I0/M1を効果でImportantへ再判定し、raw byte署名契約を一回RED→GREEN修正。独立focused11成功57ms。再レビューなし。
Deferred minor: listener stop/drain重複を既存shutdown closureへ移すと約6行削減可能。現finally/受付停止の正しさは維持しているため延期。

外部GitHub hook登録/公開ingress/実配送、principal/resource全認可、限定credential、重要Audit全般、実業務/全体受け入れは未達。証拠は合成値のみ。
