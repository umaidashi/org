# 全体ゴールと残件の再照合

全体ゴールはNotionの明示要件をTSで動作させ、実CLI e2e/ローカルgate/実Jev・review・公開情報保護・Git記録を揃えること。Ponytail ultraに従い、旧監査が原文以上の自動化・意味推定・API認証・任意adapter・全platformを必須化していないか確認する。達成判定を先に決めて文言だけ消す作業にはしない。

1. root/00–09を再取得し、10が任意設計か必須納品か原文で確認。保存済みauthorityとの差異とfetchの検証status/切詰めを記録し、raw本文やcredentialを新しい公開証拠/Jevへ追加しない。
2. requirements/auditの残件一つずつ、原文の明示要求、今回合意した実務、現在の公開Port/実caller、直接検証/実機・fixture境界を照合。必須・現方式の制約・候補/将来・ユーザー情報依存を分け、根拠のない必須範囲拡大はRulingと費用を記録して戻す。
3. 特にMemoryの全source/全scope自動抽出・意味conflict、一般Task再実行、Agent permissions field/実行境界、認証、Sandbox credential/network分離、重要Audit、外部Adapter実認証/実業務Draft PRを調べる。「現在の限定経路でできる」と「全体でできる」の両方向の過大主張を避ける。
4. `.env`の必要keyは設定有無だけ再確認し、実業務Issue/変更先repoの既存返答と認可を確認。未回答の必要情報を推測しない。一方、設定なしでも実装・検証できる明示必須残件は継続する。
5. 根拠付きcompletion audit/requirements/Nextの設計・実装計画を保存し、一回fresh read-only reviewとPonytailで不要な実装提案/証拠不足を確認する。全体完成は全ての必要条件を満たすまで未達のまま。新source変更がなければ既存gateを狭いdocs変更のために追加重複実行せず、commit/push hookは現行規則通り。
