# Sandbox完了後の権限再照合

現実callerを追った具体gap: runGrantedSandboxはcurrent Task owner/version/capabilityをsecret取得前後に検査するが、非同期Docker実行後は再検査せず返却する。Agentのcan_run_shell/read/writeが実行中にhuman Approvalで失効しても、Task version自体が不変なら成果物保存へ進む。

1. 既存DIのrun callback内でAgent capability/Task owner/versionを変え、結果が返らないことをRED。safe対照と既存前後lookup guardを維持。
2. runGrantedSandboxの共通境界でawait run→authorize→returnするだけの最小修正。呼出ごとのwrapper/新token/store/cancel engineは作らない。送信済み秘密・既に実行済みコードを回収できるとは主張しない。
3. 実CLI/実Dockerで開始後のhuman Approval失効、成果物/終端成功保存ゼロ、cleanup、権限不変の成功対照を確認。type/fulltest/実Jev/一回freshreview、docs/worklog/証拠/Git/main通常push。

Task stateとの保存原子性や未送信証明とは区別する。重要操作inventoryとresource permissions/実業務APIは未達として保持。
