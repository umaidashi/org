# 既存Linear Issueのread

MVP Phase6のLinear TaskProviderを段階実装する最初の境界。Notion rootの新Issue禁止を守り、mutationは一切呼ばない。

公式[GraphQL](https://linear.app/developers/graphql)の既存Issue queryを使う。`task linear-get ISSUE_ID --json`。UUIDまたは大文字TEAM-数字を受け付け、固定POST https://api.linear.app/graphqlへvariablesを渡す。Personal API keyはBearerなしAuthorization、固定actor/referenceのEnvironmentSecretStoreからLINEAR_API_KEYを取得。DIのrequest/secret、10秒timeout/redirect拒否/既存boundedJson256KiB、GraphQL errorsをHTTP200でも拒否、応答のid/identifier/title/nullable description/urlを検証し、秘密反射/例外漏洩を拒否する。新SDK/TaskProvider同期API変更は不要。戻り値は外部原本DTO、まだlocal WorkItem同期や外部writeを保証しない。

1. DBなし契約/入力/GraphQL部分失敗/identity/秘密非漏洩UTと実CLI未対応RED。
2. readerと既存task CLI分岐へGREEN。direct/daemonともDBなしread、40秒client timeout。
3. HTTP fixtureの実CLI e2eとmissing-key/不正入力拒否、全check/実jev/独立review/Git/main push。
4. 次の小e2eで既存Issue→local WorkItemを接続する。実API成功はkey設定後のみ。
