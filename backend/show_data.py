import sqlite3
con = sqlite3.connect("file:data/papertrail.db?mode=ro", uri=True)
for (name,) in con.execute("select name from sqlite_master where type='table' order by name").fetchall():
    print(f"{name:20} {con.execute(f'select count(*) from {name}').fetchone()[0]} rows")