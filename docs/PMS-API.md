# PMS API (Phase 3 Part C)

A small HTTP API on each tenant hostname so a booking-system bridge (Opera, Mews, a nightly
CSV job, …) can keep CoopCentric's local PMS in sync. The platform stays the source of truth
for occupancy: a room is occupied on date D by the reservation with
`checkin_date <= D < checkout_date` and status `booked` or `checked_in`.

## Authentication

Settings → **PMS API** → *Generate key*. The key is shown once and stored hashed. Send it as
`Authorization: Bearer <key>` (or `X-Api-Key: <key>`) on the tenant's own hostname — the
hostname selects the tenant, the key must belong to it. Without a valid key every call is `401`.
Every write is recorded in `pms_log` with `source = api` (Rooms page → log, or the journal).

## Endpoints

| Method | Path | Body / query | Result |
|---|---|---|---|
| `POST` | `/api/pms/reservations` | `{room, first_name?, last_name?, checkin, checkout, lang?, vip?, notes?}` | `201` reservation; `200` with the existing one when room, dates and names match (idempotent); `400` on overlap or bad dates |
| `PATCH` | `/api/pms/reservations/:id` | any of the fields above, or `{status: "checked_in" \| "checked_out" \| "cancelled"}` | updated reservation; `409` when it is already checked out / cancelled |
| `GET` | `/api/pms/reservations/:id` | | reservation |
| `GET` | `/api/pms/reservations` | `?from&to&status&room&q&arrivals&departures` | list |
| `GET` | `/api/pms/rooms` | `?date=YYYY-MM-DD` (default today, tenant time zone) | rooms with `occupied`, `checked_in`, `reservation` (on that date), `current` (checked-in guest) |

Field aliases accepted on input: `room` = `room_number`, `checkin` = `checkin_date`,
`checkout` = `checkout_date`. Dates are `YYYY-MM-DD` in the tenant's local calendar.

A reservation object:

```json
{ "id": 12, "room_number": "101", "first_name": "Jane", "last_name": "Doe", "guest": "Jane Doe",
  "checkin_date": "2026-09-20", "checkout_date": "2026-09-23", "nights": 3, "lang": "en", "vip": false,
  "notes": null, "source": "api", "status": "booked", "checked_in_at": null, "checked_out_at": null,
  "created_at": "2026-09-17T20:10:00.000Z", "updated_at": "2026-09-17T20:10:00.000Z" }
```

`status: "checked_in"` puts the guest on the room's TVs immediately (an early arrival moves
`checkin_date` to today). `status: "checked_out"` sends the LG checkout to the room's TVs
(guest app sign-ins wiped, renderer reloads) and makes the room vacant. Otherwise the scheduler
checks guests in at the tenant's check-in time and out at check-out time (Settings).

## Examples

```bash
HOST=hoteldemo.caritech.net
KEY=ccpms_...            # from Settings → PMS API

# new stay
curl -s -X POST "http://$HOST/api/pms/reservations" \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"room":"101","first_name":"Jane","last_name":"Doe","checkin":"2026-09-20","checkout":"2026-09-23","lang":"en"}'

# guest arrived early: check in now
curl -s -X PATCH "http://$HOST/api/pms/reservations/12" \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" -d '{"status":"checked_in"}'

# extend the stay
curl -s -X PATCH "http://$HOST/api/pms/reservations/12" \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" -d '{"checkout":"2026-09-24"}'

# check out (TVs get the checkout command)
curl -s -X PATCH "http://$HOST/api/pms/reservations/12" \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" -d '{"status":"checked_out"}'

# who is where today
curl -s "http://$HOST/api/pms/rooms" -H "Authorization: Bearer $KEY"
```

Errors are JSON `{"error": "..."}`: `400` validation (dates, overlap — the message names the
blocking reservation), `401` key, `404` unknown id, `409` state (already checked out/cancelled,
room still occupied for an early check-in).
