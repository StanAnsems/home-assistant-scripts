# Home battery, solarpanel and car charging automation

I wanted to create some automations that will make the charging of my car, home battery and solarpanel align.

Setup:
- Home Assistant
- Wallbox car charger (official integration)
- Hyundai Kona EV car (HACS Integration `kia_uvo` + a second integration as fallback)
- Zendure Solarflow 2400AC (HACS Integration)
- P1 smart power meter (official integration)
- Enphase solar panels (official integration)

Requirements:
- when solar production > 1500W, charge the car at minimum current (6A) — car has priority over home battery
- when the car is fully charged, home battery charges from remaining solar (smart mode)
- when car battery is below 40%, charge at full speed (32A)
- when the car is charging, don't discharge the home battery
- when the car stops charging, allow home battery to resume smart mode
- stop charging when EV battery > 50% and solar production is below 1000W (both when solar drops AND when EV crosses 50% while solar is already low)
- drop to 6A when EV battery crosses 50% and solar is still above 1500W (switch from grid-speed to solar-speed charging)
- also drop to 6A if EV is already >50% and charging at 32A when solar later climbs above 1500W (car started low, crossed 50% before solar rose)
- dagreis modus: when AC charge limit is set to 100%, always charge at full speed (32A) and never stop based on solar

## EV sensors with fallback

The automation does not read the Kona integration directly but two template sensors,
see [helpers/kona-ev-fallback-sensors.md](../../helpers/kona-ev-fallback-sensors.md):
- `sensor.kona_accu_niveau` — EV battery %: old integration → new integration → `0`
- `sensor.kona_laadlimiet` — AC charge limit %: old integration → new integration → `80`

When both integrations are invalid the battery reports 0%, so the car is treated as
low: it charges at **32A** and is never paused by the >50% rules.

## Wallbox behaviour

The Wallbox goes directly from **Ready → Charging** when a car connects (never via Paused).
The `auto_begint_laden` trigger fires immediately and decides what to do:
- EV <40% or limit 100% → keep charging at **32A**
- Solar >1500W → keep charging at **6A**
- No valid reason → **pause immediately**

The Wallbox only shows **Paused** when the automation has explicitly paused it. The `solar_hoog`, `auto_accu_laag` and `dagreis_modus` cases restart charging from this Paused state.

Automations:
- [Car charging unified](car-charging-unified.yml) — single automation replacing all previous files
- [Kia force update](kia-force-update.yml) — force Kia UVO data refresh once at connection (06:00–21:00 only)

The old separate automations are kept in [deprecated/](deprecated/) for reference only — disable them in HA, they conflict with the unified automation.

## Scenarios

The car is not at home on Monday, Wednesday and Thursday during daytime.
On other days the car is always connected to the charger.
Default AC charge limit is 80%. For a day trip the limit is manually set to 100% (dagreis modus).

### Scenario 1 — Sunny Tuesday, car at home all night, EV 70%, limit 80%

| Time | Trigger | Result |
|------|---------|--------|
| Previous evening | Car connects → auto-starts → `auto_begint_laden`: no solar, EV >40% | **Pause immediately** |
| 09:30 | Solar crosses 1500W, Wallbox Paused | Start **6A** |
| 09:30 | Wallbox → Charging | Home battery **off** |
| 16:30 | Solar drops below 1000W, EV 78% >50%, limit 80% | **Pause** charging |
| 16:30 | Wallbox → Paused | Home battery **smart** |

Car gets free solar energy. Home battery resumes smart mode and absorbs remaining solar.

### Scenario 2 — Sunny Wednesday, car not home, arrives 18:30, EV 55%

| Time | Trigger | Result |
|------|---------|--------|
| 09:30 | Solar crosses 1500W, Wallbox **Ready** | Nothing — car not connected |
| All day | — | Home battery charges freely in smart mode |
| 18:30 | Car connects → auto-starts → `auto_begint_laden`: EV 55%, solar ~300W | **Pause immediately** |
| 18:30 | Wallbox → Paused | Home battery **smart** |

Car is paused right away. Correct — no free solar available at 18:30.

### Scenario 3 — Sunny Wednesday, car arrives 13:00 while solar still high, EV 55%

| Time | Trigger | Result |
|------|---------|--------|
| 13:00 | Car connects → auto-starts → `auto_begint_laden`: solar 2000W >1500W | Set **6A**, keep charging |
| 13:00 | Wallbox stays Charging | Home battery **off** |
| 16:30 | Solar drops below 1000W, EV ~62% >50%, limit 80% | **Pause** charging |
| 16:30 | Wallbox → Paused | Home battery **smart** |

### Scenario 4 — Monday evening, car arrives 18:30 with 38% EV

| Time | Trigger | Result |
|------|---------|--------|
| 18:30 | Car connects → auto-starts → `auto_begint_laden`: EV 38% <40% | Set **32A**, keep charging |
| 18:30 | Wallbox stays Charging | Home battery **off** |
| ~20:30 | EV crosses 50%, solar already <1000W, limit 80% | **Pause** charging |
| ~20:30 | Wallbox → Paused | Home battery **smart** |

Solar already dropped before the car arrived, so `solar_laag` won't re-fire when EV crosses 50%. The `ev_accu_half_vol` trigger handles this case instead.

**Variant — car arrives during the day with 38% EV, solar 2000W:**

| Time | Trigger | Result |
|------|---------|--------|
| 13:00 | Car connects, EV 38% <40% | Set **32A**, keep charging |
| 13:00 | Wallbox stays Charging | Home battery **off** |
| ~14:30 | EV crosses 50%, solar 2000W >1500W, limit 80% | Drop to **6A** |
| 16:30 | Solar drops below 1000W, EV ~55% >50%, limit 80% | **Pause** charging |
| 16:30 | Wallbox → Paused | Home battery **smart** |

### Scenario 5 — Cloudy day, car at home, EV 65%

Car connects → auto-starts → `auto_begint_laden`: no solar, EV >40% → **paused immediately**. Home battery stays in smart mode all day.

### Scenario 6 — Dagreis, limit set to 100% before connecting, sunny day

| Time | Trigger | Result |
|------|---------|--------|
| 09:00 | Car connects → auto-starts → `auto_begint_laden`: limit 100% | Set **32A**, keep charging |
| 09:00 | Wallbox stays Charging | Home battery **off** |
| 16:30 | Solar drops below 1000W, limit 100% | **Keeps charging** — stop condition blocked |
| ~18:00 | Car reaches 100% | Wallbox stops naturally |
| ~18:00 | Wallbox → Paused | Home battery **smart** |

### Scenario 7 — Dagreis, Wednesday/Thursday, car arrives evening, limit 100%

| Time | Trigger | Result |
|------|---------|--------|
| 18:30 | Car connects → auto-starts → `auto_begint_laden`: limit 100% | Set **32A**, keep charging |
| 18:30 | Wallbox stays Charging | Home battery **off** |
| ~03:00 | Car reaches 100% | Wallbox stops naturally |
| ~03:00 | Wallbox → Paused | Home battery **smart** |

Charges overnight to 100% regardless of solar or time.

### Scenario 8 — Dagreis, limit changed to 100% while car already charging at 6A

| Event | Trigger | Result |
|-------|---------|--------|
| Limit changed 80% → 100% | `dagreis_modus`, Wallbox Charging | Boost to **32A** (no pause/resume) |
| Solar drops below 1000W | `solar_laag`, limit 100% | **Keeps charging** — stop condition blocked |

Previously a gap — now handled by the `dagreis_modus` trigger.

### Scenario 9 — Dagreis, EV also below 40%, limit 100%

Car connects with 35% EV and limit 100%. EV low case (<40%) matches first in choose order → **32A**. Both cases give 32A anyway.

### Scenario 10 — Car arrives with EV <40%, crosses 50% before solar rises, then solar climbs

| Time | Trigger | Result |
|------|---------|--------|
| 07:00 | Car connects, EV 35% <40%, no/low solar | Set **32A**, keep charging |
| 09:00 | EV crosses 50%, solar still ~800W (<1500W) | No 6A drop yet — stays **32A** |
| 11:00 | Solar climbs above 1500W (2300W), EV 65% >50%, limit 80%, Wallbox Charging | Drop to **6A** |

Without the `solar_hoog` + `Charging` + EV>50% block, this case had no automation path — `ev_accu_half_vol` had already fired below the solar threshold, and `solar_hoog`'s other handler only resumes from Paused, not adjusts an already-Charging session.

