# Linear応答のJSON escape付き資格情報反射拒否

Notion Securityのsecret redactionと既存get/list共通queryLinearを照合。公開用のquote/backslash付き偽credentialが、応答titleの復号後値へ残るケースを再現した。

## 受入条件と手順
1. quote/backslash付き偽キーをresponse title/description/未知field/cursorへ含め、get/list両方のDI UTでRED。native CLIもstdoutなし・sanitized error・DB未作成を確認。
2. JSON正規化した応答と資格情報を比較する既存GitHub webhookの方式を再利用し、queryLinearの一行だけ変更。個別callerへguardを増やさない。
3. 無関係のquote/backslash本文は保持。get/list/import/refreshとNotion/GitHub反射の既存targeted回帰を確認。
4. 全型・全テスト・非空lint/AST・実jev、独立正しさ/安全性/Ponytail最終review一回。Important一fixpass、再reviewなし。
5. 証拠・要件・作業ログをGit記録しmainへ通常push。

Ruling: credentialに現在許可されているprintable文字の範囲を狭めず、既存契約全体で反射を拒否する。一般の秘密探知/新redaction framework/依存は追加しない。native fixtureの総期限は個別CLI10秒・ready5秒より短い既定5秒を避け20秒とし、操作期限は維持する。
