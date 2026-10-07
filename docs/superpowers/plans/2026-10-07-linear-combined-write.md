# Linear contentとfieldsの一回の承認付き更新

[共通write計画](2026-10-07-core-provider-writes.md)の次の前提。Core patchにはtitle/objectiveとstatus/owner/priority/labelsが共存するため、現在のcontentかfieldsの排他だけでは共通updateを満たさない。

1. 既存native update fixtureへcombined modeを加え、fieldsにtitle/description/priorityとID fieldを一緒に渡すREDを確認する。success/unknown/staleを維持し、mutationは一回、digestは選択した全値を固定することを検証する。
2. shared field maskへtitle/descriptionを末尾追加し、旧mask順序と旧content modeのdigest/基準を維持する。fields内contentは既存content入力と同じbyte上限・NUL・空title拒否を用いる。top-level contentとfieldsの混在は禁止のまま、fields内の複合patchを許可する。
3. basic Issue selectionは既にtitle/descriptionを含むため、追加selectionで重複させない。選択したcontentだけをcanonical responseへ含め、input/baseline/output digest・receipt観測に接続する。descriptionのnullと空文字はfields modeでは空本文へ正規化し、legacy content modeの既存contractを変更しない。この意味をREADME/設計へ明記する。
4. Task-bound proposalとdaemon promptにも同じfield parserを使う。未選択値変更は不要な競合にせず、選択content/priority変更、承認入力変更、返却mismatch、保存失敗/不明結果の再送禁止・観測、古い承認の互換をDI/native/reopenで検証する。
5. 全gate/実Jev/Ponytail/独立reviewを行い、判定と証拠を公開ログ/Gitへ保存する。次にCoreの明示逆mappingと共通update consumerへ接続する。これだけで共通六操作・実API・他の全体残件は完成にしない。
