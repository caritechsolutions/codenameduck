-- D4b: "Hide TV's own OSD" per group. LG draws its channel-change banner over the portal at boot;
-- mode 'banner' writes Installer Menu item 107 BANNER_SELECT (banner_select = the value written,
-- 0/1 per LG's "selects the type of banner displayed during channel change"), 'osd_lock' also
-- holds property osd_lock="1" while the portal is in front, 'off' leaves the set alone.
ALTER TABLE groups ADD COLUMN hide_tv_osd TEXT NOT NULL DEFAULT 'banner' CHECK (hide_tv_osd IN ('off', 'banner', 'osd_lock'));
ALTER TABLE groups ADD COLUMN banner_select INTEGER NOT NULL DEFAULT 1 CHECK (banner_select IN (0, 1));
