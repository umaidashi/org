# 全Memory scopeの保守的な明示・夜間整理

Notion03のpolicyはconservative extraction/nightly consolidation/scoped relevance。既存完全同値の整理・不変receipt・SQLite transactionを再利用し、意味推定engineを増やさない。Roomだけに限定された現selectorを、保存/Contextですでに扱うscopeへ接続する。

1. `memory consolidate --scope department:engineering`等の実CLI RED。global/company/department/project/agent/taskを明示指定し、active+validの完全同値metadataだけを整理。scope/type/content/期間/tags/entities/importance/confidenceが違うものとinactive/expired/未来を触らず、原本保持・理由付きinvalidate・再open/receipt再利用を確認する。
2. 共通Memory scope validatorをdomainへ置き、全callerでNUL/未知scopeを拒否。既存Roomのactiveチェックを保持。Agent/Task scopeは既存公開Readerで実在を照合。department/projectはhostが指定するopaque scopeであり、所属directoryを推定しない。
3. 保存engineの`authorize`callbackを実際のRoom/Agent/Task scope操作から使い、transaction内の再検証とsnapshot conflict/rollbackを維持。新store/DDL/抽象containerなし。Roomの既存APIをwrapperとして保ち、一般scopeをRoom IDとして誤解しない。
4. `daemon --memory-consolidation-scope SCOPE`（最大32、重複/NUL/未知を拒否）を連続モードだけで受理。旧--memory-consolidation-roomと旧Room receipt prefixを保持し、重複Room scope指定を拒否する。非Roomは独立したreserved nightly prefixにし、旧Room IDのhashと衝突させない。手動CLIは両reserved keyを拒否する。
5. 既存daily UTC/coalesce/no replay/時計巻戻り/再起動receipt保持を同じpolicyで全scopeへ適用。archived Roomはskip、不存在Agent/Taskは失敗を伝播。registry/authorityはstartup/poll/writeで公開Portを再照合する。現在の同DB transactionの保証以上の跨system原子性を主張しない。
6. 実daemonでnonRoom scope整理/非allowlist除外/旧Room互換/再起動no replayを確認し、SQLite faultによるinvalidate/receipt rollbackを全scopeでも検証する。RED/GREEN/全gate/実Jev/一回fresh review/Ponytail/証拠・ログ・Gitを継続する。
7. 意味conflictの推定、全source自動抽出、本人認証/全permission/実業務納品は別残件。完全同値整理をsemantic consolidationの成功に言い換えない。
