# Event・Subscription・Schedule重要操作Audit

Task単位の次。Notion08の8項目と実writerを照合。Event自体は不変だが公開監査の実writer metadataがなく、Subscription.enabledは更新可能、Schedule definitionは不変でもenabledの変更履歴はない。

1. RED: Event publish/publishOnce、Subscription登録/enable/disable、Schedule登録/enable/disableが重要操作Auditへ出ない。実CLIとSQLiteで確認。
2. Actor/実保存clock DI、metadataと変更の同transaction保存。Eventの不変原本URIは複製せず再利用。Subscription過去構成とenabled、Schedule enabled前後の原本は操作側に必要最小限保持し、可変現在値から過去を捏造しない。
3. publishOnce内publishのtransaction nestingを避け、既存SQLite transactionの所有者でまとめる。再publishOnce/同enabled値no-opは原本を増やさない。既存legacyの未知writerを推測しない。
4. mandatory Reader/collectAudit、実CLI/Core/GitHub ingestionその他実callerのwriterを照合。Task/Event関連は型と既存原本で分かる範囲を保持し、payloadの任意文字列からAgent/humanを認証した扱いにしない。
5. 原子rollback/immutability/reopen/no-op/同時刻順序と小CLI E2E。全check/実Jev/fresh一review/Ponytail/記録/main通常push。

公開HTTP ingress、実業務Issueと変更repo/実API認証、全体受入は別の未達。全read監査・全低水準tool trace・汎用新Audit engineは増設しない。
