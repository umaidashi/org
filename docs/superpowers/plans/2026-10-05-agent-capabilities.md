# Agent Capabilityと委譲境界

Notion08（再取得last edited 2026-10-04T01:51:58.336Z）のcan_delegateをCore境界で制約する。既存Agentのoptional capabilitiesをSQLite JSON列に保存し、旧JSONでは省略。未知/重複/不正型を拒否。作成時--capability複数指定を検証し、変更APIはまだ作らない。

1. 既存domain UTへcapability validation/copyをRED→GREEN。既存Adapterの保存時にも検証、legacy互換/再open/不正保存を実DB検証。
2. sendA2AMessageのdelegateは送信元can_delegate必須、保存前拒否。Room appendにreserved a2a metadataを直接渡す迂回も調べ、同じ制約を実行側で保証する。その他typeは維持。Capabilitiesは認証ではなくローカル管理者の設定。
3. 実daemon CLIで拒否/明示許可/再open、全検査・実Jev・独立レビュー→commit/push。

Ruling: 他のcan_*は既知値として保存するが、この変更で実装しない境界の権限保証は主張しない。新規/既存Agentのcapabilities省略はdelegate拒否。costは既存delegate送信に明示設定が必要になること。権限変更/専用Approval/Audit全般は後続。

Review Focus: unknown/type/duplicate validation、保存前拒否、旧schema/JSON互換、alias mutation、予約metadata迂回、local管理者設定とAgent認証の区別、権限拡張なし。
