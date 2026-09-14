# What to test on the real TV, per Phase 2 step

Each step ends with something Richard checks on the 43UM670H0UA (hoteldemo). Deploy with

```
curl -fsSL https://raw.githubusercontent.com/caritechsolutions/codenameduck/<branch>/install.sh | sudo COOPCENTRIC_BRANCH=<branch> bash
```

then power-cycle the TV (dev-mode xait 0/0 reloads the app on every power cycle).

## Step 2 — admin, live push, heartbeats

Server side, once, after the install finishes:

1. `sudo journalctl -u coopcentric | grep -A2 'INITIAL SUPERADMIN'` — the generated `admin`
   password is printed exactly once, on the first boot with an empty users table.
2. Open `http://hoteldemo.caritech.net/admin`, log in as `admin`.

On the TV / in admin:

1. **Sets** lists the 43UM670H0UA as *online · live* (green dot, "live" = WebSocket connected),
   with the room-on-TV shown as `[TV]<serial>` and flagged "factory default", and room = "no room".
2. Delete the junk set `TEST0001` from its drawer (Danger zone → Delete).
3. **Groups** → New group "Standard rooms". **Layouts** → New layout "Standard room"
   (starter JSON). In the layout editor, change the welcome text, click **Save & publish**.
4. Open the set's drawer, set Room = 204, Group = Standard rooms, Save. Within a second the TV
   must switch from the "not yet assigned" screen to the layout: "Welcome to hoteldemo",
   "Room 204", clock. (Video/channel_list zones are still placeholders until step 3.)
5. In the drawer, the commands table shows `set_property → acked`. Power-cycle the TV: it should
   now report room 204 in the "Room on TV" line (LG property written by the renderer).
6. Edit the layout text again and Save & publish → TV redraws immediately without a power cycle.
7. Dashboard: online count 1, "1 live". Unplug the TV's network for 4 minutes → it turns offline
   (red) and appears in "Offline sets"; plug back in → online again within ~60 s (poll) or
   immediately (WebSocket reconnect).
8. "Reboot TV" and "Reload app" buttons in the drawer: reboot must reboot the set; reload must
   reload the app. Both should show `acked` in the commands table.
