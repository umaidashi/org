# 承認済みコードArtifactのlocal Git引渡し

既存実Claude二Agent/実Docker/生成物check proofへ、human result review後のlocal Git手順を結線する。新製品Adapter/Approval種別/remote publish abstractionは作らない。

fixtureだけのtemporary Git repoとfile-only bare remoteを作る。固定2ファイルをbranchへcommitし、main不変・差分path・各blob原本一致・bare remote head一致を確認。global/system Git設定とhooks/外部protocolは無効、生成コードはhostで実行しない。既存runProcessとexportSandboxRepoを再利用する。

1. 共有test helper export未実装RED、native Git小e2e GREEN。unsafe filenameは書込み前に拒否。
2. 既存実code proofでArtifactチェック→human review completed/Artifact binding→同Artifact再読取→local Git branch/commit/local bare pushへ接続。旧算術経路は維持。
3. 実Claude/Docker/生成物check＋local Git、全check/実jev、独立正しさ/安全性/Ponytail review一回、Git/main通常push。

Ruling: Task結果承認は外部publish Approvalではない。このproofはowned local fixtureへcommit/pushするだけ。実業務repo・GitHub Draft PR作成とpublish Approvalは未完了。業務対象が決まった時に具体的副作用へ接続する。
