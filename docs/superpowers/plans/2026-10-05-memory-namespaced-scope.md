# 名前空間付きTask IDのMemory scope

- a2a:/schedule由来Task ID内のcolonを、scope suffixのvalidatorが拒否していた。
- Scopeの既知prefix/非空/空白拒否は維持し、suffixをID文字列としてそのまま受ける。Contextは既存の完全一致比較を再利用し、encode/別scope parserを追加しない。
- 最小UT RED→GREEN、実CLI capture→daemon Task RuntimeのContextで同Taskだけ選択、foreign Task除外を確認。全check/実Jev。
