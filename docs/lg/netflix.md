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
