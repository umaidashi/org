# Linear既存Issueの限定一覧読取

TaskProviderの未完了listを固定read-only GraphQLへ小さく接続。`task linear-list --team TEAM_KEY [--limit 1..50] [--after CURSOR] --json`。Team指定必須、default20、一ページだけ、pageInfoを返し自動全件scan/DB作成/外部mutationなし。既存readerのHTTP/SecretStore/boundedJson/Issue DTO出典検証を共有しSDK依存を追加しない。

Ruling: 外部TaskProvider全機能の完了とは扱わずlist/read import/refreshのbridge。GraphQL partial errors、別Team identifier/不正URL/重複ID/件数超過/不正pageInfo/secret reflectionを拒否。cursorは可視ASCII1..2048、next pageはCLIへ明示入力。同じafterを返すhasNextPageは拒否。実API keyは未設定のためHTTP fixtureと区別。

1. DI list export/CLI未実装RED。
2. 既存固定request/parserを再利用し一ページのbounds/identity/errorをGREEN。
3. actual CLI direct/daemon HTTP fixture/noDB、全check/実jev/独立review一回、Important一fixpass、Git/main push。

Review Focus: GraphQL schemaは公式Linear SDK/Developer Docsを参照、過大/partial errorは結果を公開しない、pagination終端と件数の整合、read-only source URL/Team identity、資格情報はAPI対象固定・値を例外に含めない。

参照: [公式pagination](https://linear.app/developers/pagination)、[filtering](https://linear.app/developers/filtering)、[公式SDK schema](https://github.com/linear/linear/blob/master/packages/sdk/src/schema.graphql)。
