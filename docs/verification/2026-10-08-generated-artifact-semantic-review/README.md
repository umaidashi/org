# 実生成Artifact意味レビュー

既存public scanner・semantic runnerを、所有Dockerでbun checkが成功した生成code/testへ接続。必要fileのsubjects欠落を拒否し、元.envをコピーせず生成codeをhost実行しない。

RED2成功1失敗31ms→GREEN4成功2files98ms。static374files。fresh review C0/I0/M0、独立4成功77ms、Ponytail net0。

実機初回6成功1skip1失敗118.10秒。Specialist生成testの誤ったsafe integer期待値により新gateへ到達前に失敗。negative explicit-any拒否成功。private debugは公開証拠に含めない。再実行と全gateは未確定、全体未達。

再生成の実一周 terminal0: 7成功1skip0失敗116.37秒。生成TS/test→Docker assertions/bun check→実Jev15subjects（domain2/test12、両file findings0、missing/unsure/review 0/errors/degraded空）→local Git handoff→human review/Memory/same provider restart成功。negative explicit-any拒否も成功。所有tmpはfinallyで削除、container/image cleanup assertion成功。全gate533成功21skip0失敗170.22秒、repo実Jev2440対象/不完全判定なし。実外部業務受入は残件。
