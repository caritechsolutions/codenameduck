# Tenant network checklist (per hotel)

What the hotel network must allow before Pro:Centric sets on CoopCentric work end to end.
Source for the LG/Netflix items: `docs/lg/netflix.md` (LG's SI document).

## Reverse proxy / DNS

- `<hotel>.caritech.net` resolves (from the hotel LAN) to the NPM front door; plain HTTP port 80
  reaches the coopcentric VM (HTTPS/redirects on the TV path are not verified — do not force SSL).
- The NPM proxy host has **Websockets Support** on (otherwise `/ws/tv` fails silently and sets
  fall back to 60 s polling).
- TV installation menu: Pro:Centric Mode `HTML`, Media Type `IP`, Server = the hostname, port 80.

## Outbound from the TV VLAN (firewall)

| Destination | Port | Why |
|---|---|---|
| `<hotel>.caritech.net` | 80/tcp | xait.xml, app, `/api/tv/*`, `/ws/tv` |
| `*.pool.ntp.org` | 123/udp | LG sets the clock from NTP; Netflix registration and launch fail with a wrong time |
| `https://GR.lgtvsdp.com/rest/sdp/v13.0/initservices` | 443/tcp | LG service platform — token registration (`application/register`) talks to it |
| Netflix / YouTube / Prime CDNs | 443/tcp | the apps themselves (LG/partner published lists) |
| IPTV multicast groups | udp | only when the lineup has multicast channels; IGMP snooping/querier on the TV VLAN |

## TV settings LG requires for Netflix

- **Time set** (NTP reachable, or set manually) — the set reports `service_country` at register and
  the admin drawer shows a `tv_error` when the country is "Others"/"ZZ".
- **Service country** must not be "Others": General > System > Location on the set
  (`configuration/servicecountry/get` on IDCAP). Change it before registering tokens.
- **Netflix hotel id** entered in the tenant's Settings (any code unique to the property); Netflix is
  hidden from the sets until it is.
- Licence files uploaded once by the superadmin (App licences) — `NETFLIX_*.lic` etc.

## After a change

Power-cycle one set and check its drawer: `service_country ok`, `apps_registration tokenResult:
true`, Netflix `activated` in Apps, then launch from the tile and with the remote's NETFLIX key.
