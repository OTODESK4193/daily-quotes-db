#!/usr/bin/env python3
"""quotes_all.json から data.js を決定的に生成する。

使い方: python3 sync-data.py
入力: ../db/quotes_all.json
出力: ./data.js  (const QUOTES_DATA = [...] の形で全件を埋め込む)

再実行で必ず同じバイト列になるよう、タイムスタンプ等は埋め込まず、
キー順序を固定して出力する。
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "..", "db", "quotes_all.json")
DST = os.path.join(HERE, "data.js")


def main() -> int:
    with open(SRC, encoding="utf-8") as f:
        data = json.load(f)

    quotes = data["quotes"]
    version = data.get("version", "")

    body = json.dumps(quotes, ensure_ascii=False, sort_keys=True)
    header = (
        "// 今日の言葉 データ (db/quotes_all.json version %s, %d件)\n"
        "// このファイルは sync-data.py で生成されます。直接編集しないでください。\n"
        % (version, len(quotes))
    )
    out = header + "const QUOTES_DATA = " + body + ";\n"

    with open(DST, "w", encoding="utf-8") as f:
        f.write(out)

    print("wrote %s (%d quotes, %d bytes)" % (DST, len(quotes), len(out.encode("utf-8"))))
    return 0


if __name__ == "__main__":
    sys.exit(main())
