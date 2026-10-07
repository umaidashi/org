# Codex native tool境界の検証

installed codex-cli0.160.1の対応版公式sourceと実効設定を確認。shared start/resumeへview_image/hooks/apps/plugins/multi_agent false、web_search disabled、legacy notify空配列を固定。

- flags不足/notify不足のUT RED→focused 8成功。legacy notifyはhooks featureとは独立して動くことを実機の一時markerで確認。
- fresh reviewer C0/I0/M1: marker shell引用不足。境界の実検証を壊すImportantへ再判定。空白path RED→位置引数で修正、実Codex start/resume 1成功24.01秒。再レビューなし。
- full512成功19skip0失敗531tests209files183.61秒はmarker fixture修正前。修正後static366files/実Jev2378subjects、missing/unsure/review/errors/degraded0。最後のcommit tree全検査はpre-pushで実行し作業ログへ追記する。
- 有効PNGのimage実験はassistantの利用可否応答のみ。JSONにtool itemがないことは実際のfile read不存在の証明にならない。source guard/実効設定以上のimage実行証明とはしない。
- image_generationはextension executor注入条件があり、standalone既定迂回の反例なし。推測flagを追加しない。Ponytail Lean already、既存複数flag loop再利用、新wrapper/dependencyなし。

[公式対応版spec](https://github.com/openai/codex/blob/rust-v0.160.1/codex-rs/core/src/tools/spec_plan.rs)、[legacy notify hook登録](https://github.com/openai/codex/blob/rust-v0.160.1/codex-rs/hooks/src/registry.rs)。任意版/managed config/MCP/全native tool/同UID本人隔離を保証せず、全体未達。
