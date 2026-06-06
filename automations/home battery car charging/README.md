# Home battery, solarpanel and car charging automation

I wanted to create some automations that will make the charging of my car, home battery and solarpanel align.

Setup:
- Home Assistant
- Wallbox car charger (official integration)
- Hyundai Kona EV car (HACS Integration)
- Zendure Solarflow 2400AC (HACS Integration)
- P1 smart power meter (official integration)
- Enphase solar panels (official integration)

Requirements:
- when solar production > 1500W, charge the car first at minimum current (6A) — car has priority over home battery
- when the car connects and solar is already above 1500W, start charging immediately at 6A
- when the car is fully charged, home battery charges from remaining solar (smart mode)
- when car battery is below 40% (including at the moment of connection), charge at full speed (32A)
- when the car is charging, don't discharge the home battery
- when the car stops charging, allow home battery to resume smart mode
- stop charging when EV battery > 50% and solar production is below 1000W (both when solar drops AND when EV crosses 50% while solar is already low)
- dagreis modus: when AC charge limit is set to 100%, always charge at full speed (32A) and never stop based on solar

Automations:
- [Car charging unified](car-charging-unified.yml) — single automation replacing all previous files
- [Kia force update](kia-force-update.yml) — force Kia UVO data refresh once at connection (06:00–21:00 only)

## Scenarios

The car is not at home on Monday, Wednesday and Thursday during daytime.
On other days the car is always connected to the charger.
Default AC charge limit is 80%. For a day trip the limit is manually set to 100% (dagreis modus).

### Scenario 1 — Sunny Tuesday, car at home, EV 70%, limit 80%

| Time | Trigger | Result |
|------|---------|--------|
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
| 18:30 | Car connects, EV 55%, limit 80%, solar ~300W | Nothing — no condition matches |

Car stays paused. Correct — no free solar available at 18:30.

### Scenario 3 — Sunny Wednesday, car arrives 13:00 while solar still high, EV 55%

| Time | Trigger | Result |
|------|---------|--------|
| 13:00 | Car connects, solar 2000W >1500W | Start **6A** |
| 13:00 | Wallbox → Charging | Home battery **off** |
| 16:30 | Solar drops below 1000W, EV ~62% >50%, limit 80% | **Pause** charging |
| 16:30 | Wallbox → Paused | Home battery **smart** |

### Scenario 4 — Monday evening, car arrives 18:30 with 38% EV

| Time | Trigger | Result |
|------|---------|--------|
| 18:30 | Car connects, EV 38% <40% | Start **32A** |
| 18:30 | Wallbox → Charging | Home battery **off** |
| ~20:30 | EV crosses 50%, solar already <1000W, limit 80% | **Pause** charging |
| ~20:30 | Wallbox → Paused | Home battery **smart** |

Solar already dropped before the car arrived, so `solar_laag` won't re-fire when EV crosses 50%. The `ev_accu_half_vol` trigger handles this case instead.

### Scenario 5 — Cloudy day, car at home, EV 65%

Solar never crosses 1500W, EV stays above 40%. No triggers fire. Car stays paused, home battery runs smart mode all day.

### Scenario 6 — Dagreis, limit set to 100% before connecting, sunny day

| Time | Trigger | Result |
|------|---------|--------|
| 09:00 | Car connects, limit 100% | Start **32A** |
| 09:00 | Wallbox → Charging | Home battery **off** |
| 16:30 | Solar drops below 1000W, limit 100% | **Keeps charging** — stop condition blocked |
| ~18:00 | Car reaches 100% | Wallbox stops naturally |
| ~18:00 | Wallbox → Paused | Home battery **smart** |

### Scenario 7 — Dagreis, Wednesday/Thursday, car arrives evening, limit 100%

| Time | Trigger | Result |
|------|---------|--------|
| 18:30 | Car connects, limit 100% | Start **32A** |
| 18:30 | Wallbox → Charging | Home battery **off** |
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

