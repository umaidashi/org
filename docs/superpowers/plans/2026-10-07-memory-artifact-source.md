# Memoryのhash Artifact原本参照

Spec: Notion03 Artifacts source of truth、[全体監査](../../completion-audit.md)、[全体要件](../../requirements.md)。既存hash blob保存と`readSandboxArtifact`を再利用する。

## Task 1: hash ArtifactからMemory capture

1. 所有一時DBのArtifact directoryへ既存saveSandboxArtifactで原本を保存し、別CLIの`memory capture --source-artifact org://artifacts/HASH`→再読取りのREDを確認する。blob原本は変更しない。
2. 既存URI SourceRefへcanonical lowercase SHA-256 Artifact URIだけを加える。全source selectorの相互排他とparse-before-DBを維持する。任意URL/host file pathを受理しない。
3. captureMemoryへ最小の非同期Artifact読取関数をDIし、既存readSandboxArtifactのregular-file/no-follow/サイズ/hash検証を保存前にawaitする。capture/CLI/Applicationの全callerを更新してPromiseを待ち、finally cleanupと旧Message/TaskReview/Eventの拒否/互換を維持する。新BlobStore interfaceや汎用source frameworkは作らない。
4. DIでreader欠落/取得障害/保存障害を確認し、native CLIでmissing/corrupt/symlink/noncanonical原本拒否・保存ゼロ・再読取り・bytes/hash不変を確認する。fast UT/全check/非空dry-run/実Jev/Ponytail/独立review→証拠/ログ/Git/main通常公開。

今回はローカルhash blobの存在と整合性を証明する。Room Message型Artifactや外部URLの取得、意味の真実性、Artifact由来の自動候補抽出、Workflow/一般Decision/全scopeのprovenance・policy、共通Linear TaskProviderと権限/本人認証/実API/業務納品は残す。
