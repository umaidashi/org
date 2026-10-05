# 最小Docker SandboxとArtifact回収

Notion06のephemeral作業机を、小さなrun→artifact→destroyから実装する。既存runProcess/Taskの結果stage/Capabilityを再利用し、新規daemon/実行queueは作らない。

1. Sandbox.runの必要最小PortとDocker AdapterをDI/TDD。固定公式Bun1.3.4 image digest、network none/root readonly/cap-drop ALL/no-new-privileges/pids64/memory256m/cpu1/non-root、ホストmountなし、容量制限されたtmpfs workspace。資格情報なし。TS codeは固定管理配置commandのstdinからtmpfs fileへ配置、隔離tmpfsも設ける。Container内timeoutとhost timeout/cancel/output上限、finally force rmを保証。親SIGKILL時もcontainer内deadlineで有限終了する。
2. まず空workspaceと明示writableを検証、続いてGitのHEAD objectからtracked regular treeを作業copyへexportし元repoを書き換えない。既存.env/untracked/node_modules/Git履歴はmountしない。Slot/App追加envやcredentialsはこの変更で受け付けない。
3. Artifactは選択relative regular fileだけ、realpath containment/symlink拒否、個別/総量上限を適用してcontainer終了前に回収。privateで不変な内容hash blobへ保存しorg URIで参照する。保存先はdb.artifactsとしてGit除外する。stdout結果も同じArtifactへ保存できる。
4. 既存Task running→結果Artifact/waiting_approval→失敗CASを実際の2callerで共通化し、LLM経路回帰を保つ。sandbox run TASKはexecution ownerのcan_run_shell必須、repo読取はcan_read、writableはcan_write。Local admin操作として検証しAgent本人認証と混同しない。結果は自動承認しない。
5. 最小UT/実process contract/実Docker/実CLIでTS→ファイル成果物→Task明示レビュー、readonly/外部network拒否、timeout/cancel/destroy、repo原本/秘密情報非mount、Artifact escape拒否を確認。全check/実Jev/独立レビュー→commit/main。

Ruling: 初回はDockerだけ、credentials/networkは一律なし。親の異常死に対して即時killを保証せず実行中containerは内deadlineと--rmで有限cleanup、必要なら専用lifelineを追加する。costはdeadlineまでresourceが残り得ること。長期Sandbox再利用/create-get-exec専用API・選択credential injection・LLM tool接続は後続。前提imageを勝手に可変設定へ広げない。
Review Focus: ホストmount/secret/symlink/path traversal、image/argv/非root/networkの実制約、copy所有権、code/dataサイズ、finally cleanupの全failure path、parent crashの有限cleanup、TaskCAS/partial Artifact保存/停止drain、LLM回帰、Portで最小UT。

Ruling更新: Docker readonly rootfsではcpが拒否される実挙動を確認。ホストbind/cpを使わず、固定管理配置だけroot execのstdinでtmpfsへ書き、Agent codeは非root execする。容量制限はDocker native tmpfsで実施する。

Ruling更新: repoはnative Git commit/blob読取でHEADを固定しregular fileのみ最大2000件/8MiB、個別1MiBへ制限。symlink/submoduleを拒否し既知資格情報名を除外。選択fileはbase64 JSON bundleを単一既存Task Artifactへ保存し、encoded blob全体1MiB。costは大きなrepo/Artifactやsubmoduleの別対応が必要なこと。作成からstart前のSIGKILLはstopped containerを残す可能性があり、実行中の有限cleanupと区別する。

Final: 独立Reviewer Critical/Important/Minorなし。Sandbox7件と既存LLM Task2件を独立成功、実Docker PID1 SIGSTOP bypassが成立しないこと/deadline自動削除も確認。Rulingはone-shot Docker、daemon/credentials/tool後続、large repo/encoded blob制限、作成start間crashのstopped container残留。
