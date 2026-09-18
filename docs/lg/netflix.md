# LG Pro:Centric — Netflix and other licensed apps (extract of LG's SI documentation)

Source: LG Pro:Centric developer portal, "Netflix" page (retrieved 2026-09-17). Verbatim facts
kept; examples condensed. Applies to Pro:Centric Smart TV/STB with webOS 5.0 or later, IDCAP.

## Process
- Contact the local LG sales engineer. SIs must sign a contract to use Netflix; on completion LG
  issues a **token** for Netflix registration via the LG business portal.
- Tokens are **per SI partner**, not per property — one token is used for all installations.
- Caritech's licence bundle (issued 2026-09-17) contains one `.lic` file per product:
  NETFLIX, AMAZON, AirPlay, GOOGLE CAST. Each file is a single base64 string = the token.
  **Never commit these files.** They are entered once in the platform's superadmin Activation
  panel and stored in the database.

## Table 1 — application requirements
| Application | ID | Requirement |
|---|---|---|
| Amazon Prime Video (webOS 5.0 STB-6500 only) | `amazon` | authorization token |
| Netflix | `netflix` | authorization token, launch-method parameter, property-name parameter |

Controlled apps do not appear in `application/list` until the token is registered.

## Register the token
```js
idcap.request("idcap://application/register", {
  parameters: { tokenList: [ { id: "netflix", token: "<token>" } ] },
  onSuccess, onFailure });
```
Result event (asynchronous):
```js
document.addEventListener("idcap::application_registration_result_received", function (p) {
  // p.id, p.tokenResult (bool), p.errorMessage
});
```
Preconditions if registration fails:
- TV time must be set (General > System > Time).
- LG Service Country must not be "Others" (General > System > Location), settable via
  `idcap://configuration/servicecountry/set`.
- Firewall must allow `*.pool.ntp.org` and `https://GR.lgtvsdp.com/rest/sdp/v13.0/initservices`.

## Launch Netflix — required parameters
```js
idcap.request("idcap://application/launch", {
  parameters: {
    id: "netflix",
    params: { reason: "<launch type>", params: { hotel_id: "<unique property id>", launcher_version: "1.0" } },
    noSplash: false
  } });
```
| Launch method | `params` |
|---|---|
| On-screen icon / menu | `{ "reason": "launcher", "params": { hotel_id, launcher_version } }` |
| Hot key while TV ON (NORMAL) | `{ "reason": "hotKey", "params": { hotel_id, launcher_version } }` |
| Hot key while TV OFF (WARM) | `{ "reason": "boot", "params": { reason: "netflix", hotel_id, launcher_version } }` |

Determine NORMAL vs WARM with `idcap://power/powermode/get`.

- `hotel_id`: any code traceable to one property (e.g. a billing ID). The SI must keep the
  mapping; untraceable codes can lead to revocation of the SI token, affecting all properties.
- `launcher_version`: currently always `"1.0"`.

## Licence obligations
- Clear guest credentials at checkout (`idcap://tv/checkout/request`).
- Provide a Netflix hot key on the remote.
- Netflix does not support 1366x768 panels on webOS 5.0+ STBs; use 720p/1080i/1080p.

## application/list fields (as returned)
`title`, `appId`, `iconPath`, `version`, `installed`, `type`.

## register/status — replies observed on the 43UM670H0UA (2026-09-18, not in LG's document)

`idcap://application/register/status { id }` answers for a controlled app even while it is
**absent from `application/list`** (they only appear once registered), so status must be asked
by app id, never derived from the list. Observed shapes:

| Reply | Meaning |
|---|---|
| `{ auth: true, auth_status: "authSuccess" }` | token registered, app activated |
| `{ auth: false, auth_status: "authNeeded" }` | not activated → register the token |
| `{ auth_status: "notRequired" }` | the app needs no token (YouTube, browser, …) |
| onFailure `IDCAP_RESULT_FAILURE` | the id is unknown to the set (e.g. `airplay`) |

CoopCentric treats only `auth === true` as authorised; any other value, a failed query or no
reply for a licensed id means the token is registered (one `application/register` per token,
waiting for its `application_registration_result_received`, whose `tokenResult` is the string
`"success"` or `"fail"`). **Re-registering an already authorised app resets its sign-in** on
the set — the reason registration is driven by this status and nothing else.

### Power-off finding (2026-09-18)

A power-off/on by itself does **not** sign Netflix out. The sign-in was lost on every reboot
only because the renderer re-registered the token at each boot (B3d/B3e): re-registering an
already authorised app resets its state. With registration driven by `register/status`
(`auth === true` → leave the app alone) the sign-in survives reboots. Status words seen so far:
`authNeeded` (register the token), `authSuccess` (activated), `notRequired` (no token for this
app). LG's checkout (`tv/checkout/request`) is what signs the guest out — Part C uses it at
check-out.

## Licence failure handling (D4, 2026-09-18)

A `tokenResult: "fail"` for a token marks the licence row failed (model, time, message) and the
token is **withheld for a backoff window** — 1 h after the first failure, doubling per consecutive
failure, capped at 24 h — then offered again. A `"success"` clears the failure; editing the app
id or replacing the file clears it at once. Reason: a "fail" during a power cut or an offline test
must not switch Netflix off for good (that is what happened after the Part D offline tests: the
server kept `status_ids` but sent no `tokenList`). The sets see the reason in
`activation.withheld` and report it in `tv_apps_registration_reason`.

Local origin of the remote-deploy bundle on the 43UM670H0UA (webOS 8.3): `http://127.0.0.1:8051`
— the set serves the unzipped app from a loopback HTTP server. Port stability across boots is
still to be verified (TV test plan D4 step 15).
