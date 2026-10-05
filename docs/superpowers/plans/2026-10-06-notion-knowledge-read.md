# Notion knowledgeの最小read Adapter

Notion root/MVPを再取得しPhase6のNotion knowledge/docsを照合。公式[Markdown読取](https://developers.notion.com/reference/retrieve-page-markdown)と[versioning](https://developers.notion.com/reference/versioning)を確認。2026-03-11 APIのnative Markdownを使い、独自の再帰block rendererは作らない。

## 設計

`knowledge notion PAGE_ID --json`はlocal adminの明示読取。GET https://api.notion.com/v1/pages/UUID/markdownだけを呼ぶ。32hex/UUIDをcanonical UUIDへ正規化、URLや任意hostは受け付けない。requestとSecretStore.getSecretをDIし、CLI起動点では既存EnvironmentSecretStoreの固定actor/reference grantからNOTION_API_KEYを取得する。新しいSDK/抽象factory/configは追加しない。

10秒timeout、redirect拒否、既存boundedJsonで256KiB、200以外/通信/JSON障害は本文・credentialを漏らさず非ゼロ。object/page ID/markdown/truncated/unknown_block_idsを検査し、切詰めやunknown blockは成功にしない。credential文字列のresponse反射も拒否。戻り値はprovider/id/synthesized URL/native Markdown/content SHA256。追加のmetadata、編集version、title、意味的な完全性は保証しない。Notionへの書込/添付URL取得/自動retry/Runtimeへのcredential注入なし。

## 計画

1. DI UTで正規化/HTTP契約/identity/gap/secret/error/上限のRED、実CLI未対応を確認。
2. native Markdown read関数とCLI配線をGREEN。daemon/direct両経路と適切なclient timeoutを接続。
3. malformed CLI/無key非漏洩を実プロセス、成功HTTP fixtureはDI（外部APIと混同しない）。実Notion keyが設定されれば指定済み設計ページのreadのみを実証。
4. fullcheck/実jev/独立review一回・Important一fixpass・docs/Git/main push。Room原本への取込/Memory/Contextは次の小e2e。

## Review Focus

UUID/host固定、SecretStore lookup順、例外/response反射のcredential非漏洩、responseサイズ/unknown/truncated、daemon timeout、空本文と日本語。Notion接続済みアプリでの仕様fetchはKernel API実証とは区別する。
