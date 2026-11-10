-- The game's first tables, written by `xcore add database`: an example to change before the game is published.
-- xgames.fun applies each migration once, in name order, before the version that brings it goes live; `xcore dev`
-- does the same on this machine. Once this one is published, never change it: put the next change in
-- 0002_<what>.sql (ALTER TABLE players ADD COLUMN …).
CREATE TABLE players (
  id TEXT PRIMARY KEY,                -- the player's id: env.GF.verifyPlayer's sub (withPlayer in gf-db.js), never the wallet
  gold INTEGER NOT NULL DEFAULT 0,
  runs INTEGER NOT NULL DEFAULT 3,    -- runs left today
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);
