# Memory抽出のRoom permission

既存Sessionの純粋Room policy guardをagents/domainへ移し、手動/自動の共有extractRoomMemoriesで開始前と根拠await後・保存前に再利用。

- 初期拒否RED: 2成功1失敗34ms。extractor/保存を呼ばない対照。
- 非同期失効RED: 2成功1失敗34ms。初期guardだけでは保存する反例。
- GREEN: 14成功0失敗3files80ms。Memory/Agent Room/Sessionの兄弟caller。
- 実CLI: 5成功0失敗3files3.83秒。過去proposal→human Approval deny→拒否/Memoryゼロ→restore→根拠付き採用/再open。既存Session nativeも再検査。
- fresh reviewer C0/I0/M0、Ponytail Lean/net0。独立code inspectionであり全gateは親が確認。fixpassなし/再レビューなし。

既読情報の回収、他writerとの完全原子性、外部API認証の証拠ではない。Memory更新Audit/実業務受入/全体は未達。

最終terminal0全check: 519成功21skip0失敗540tests212files185.24秒。type/Oxlint/Oxfmt369files/非空AST/dry-run成功。実Jev2406subjects147warnings、missing/unsure/review/errors/degraded0。変更source/test対象あり。failure-path warningは初期/非同期拒否・legacy/許可・実CLI対照と照合、具体的未対応反例なし。
