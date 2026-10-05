# Sandbox repo exportの暗黙Git fetch拒否

- ローカルpartial cloneの不足blobを読むとGitがhost側でremoteへlazy fetchする。Sandboxのnetwork noneではこの前処理を制約できない。
- 実Git/file transportだけのfixtureで不足blobを確認し、exportが成功してfetchするREDを確認する。外部ネットワーク/資格情報は使用しない。
- 共通Git呼出のnative環境でlazy fetchと全transportを禁止する。既存全caller/取消/完全repo exportの回帰、全check/実Jev/実Dockerを確認する。
- 独立final review後、結果と制約をログへ記録し通常main pushする。
