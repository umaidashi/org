# 通常RuntimeのRoom成果物をCLIで読む

1. 実CLIの元返信復旧e2eにartifact-contentを追加し、Sandbox URI専用実装が通常Room URIを拒否するREDを確認する。
2. 既存Task artifact一覧による所属確認を維持し、Room URIを厳密解析。元RoomのTask ID、MessageのRoom一致を確認して不変contentを読む。外部URIや他TaskのRoomは拒否する。
3. 既存Room PortをDIで渡し、DB不要の不正URI/他Task/欠落原本UTを作る。既存Sandbox hash/integrity経路は変更しない。接続はfinallyで解放する。
4. 同DB/socket native e2eで内容/原本不変/Runtime一回、全check/実jev/独立Ponytail review、ログ・Git・通常main push。

新しいArtifact table/汎用URI registry/外部fetch/キャッシュは追加しない。
