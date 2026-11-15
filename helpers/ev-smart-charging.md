# EV Smart Charging (price planner for the Kona)

Preparation for the end of net metering (saldering, 1 Jan 2027) and a dynamic energy
contract. [EV Smart Charging](https://github.com/jonasbkarlsson/ev_smart_charging) (HACS)
picks the cheapest hours to reach a target SOC before the departure time.

It does **not** control the Wallbox. It only exposes `sensor.ev_smart_charging_charging`
(`on` / `off`). Until the switch to a dynamic contract it runs in **shadow mode**: it
plans, but `car-charging-unified.yml` keeps controlling the charger unchanged. Solar
charging always stays in `car-charging-unified.yml`.

## Strategy

- Night (cheap hours before 07:00): charge to the **night target (50%)**
- Day: solar tops up to the car's AC charge limit (existing solar logic)
- Dagreis (AC charge limit 100%): planner target becomes 100%
- Below 20%: charge immediately, regardless of price
- Price below €0.00: charge immediately

## 1. Price source

The core **Nord Pool** integration ("Meterkast Nord Pool NL", area NL, EUR) is already
installed. EV Smart Charging does not support it natively, so a trigger template converts
the 15-minute prices into the generic price-sensor format:
[nordpool-prijs-ev-smart-charging.yaml](nordpool-prijs-ev-smart-charging.yaml).

- Add the `template:` block to `configuration.yaml` (trigger templates with actions
  cannot be created in the UI) and restart / reload template entities.
- Result: `sensor.ev_smart_charging_prijs` (EUR/kWh) with attributes `prices_today`
  and `prices_tomorrow` (96 quarter-hours each; tomorrow is `[]` until Nord Pool
  publishes, around 13:00).
- The config entry id is looked up with `config_entry_id(...)`, so nothing is hardcoded.

These are spot prices excluding tax, supplier margin and VAT. Those are the same every
quarter-hour, so ranking the cheapest hours on spot price gives the same result as
all-in prices. Only the "low price charging" level (€0.00) is compared to the spot price.

## 2. Install EV Smart Charging

Install via HACS. Version **2.6.1 or newer** is required for HA 2026.11 and later.

## 3. Create a Helper - Number: "EV Night target"
- Create a "Helper"
- Choose "Number"
- Name: `EV Night target` (entity id becomes `input_number.ev_night_target`)
- Minimum `0`, maximum `100`, step `5`, unit `%`, display mode: input field
- Set the value to `50`

## 4. Create a Helper - Template - Sensor: "EV Charge target"
- Create a "Helper"
- Select "template"
- Choose "Sensor"
- Name: `EV Charge target` (entity id becomes `sensor.ev_charge_target`)
- For the state add the following code:
```
{% set limiet = states('sensor.kona_laadlimiet') | float(80) %}
{% set nachtdoel = states('input_number.ev_night_target') | float(50) %}
{% if limiet >= 100 %}
  {# Dagreis modus: plan to 100% #}
  100
{% else %}
  {# Night target, never above the car's own AC charge limit #}
  {{ [nachtdoel, limiet] | min }}
{% endif %}
```
- Set % as the Unit of Meassurment
- Device class: none (not Battery — this is a target, not a battery level)
- State class: Measurement

## 5. Configure EV Smart Charging

Add the integration (Settings → Devices & services → Add integration → EV Smart
Charging) and keep the name `EV Smart Charging`, so the entity ids match the automation.

| Setting | Value |
|---|---|
| Electricity price entity | `sensor.ev_smart_charging_prijs` (Nord Pool template) |
| EV SOC entity | `sensor.kona_accu_niveau` (fallback sensor, see [kona-ev-fallback-sensors.md](kona-ev-fallback-sensors.md)) |
| EV target SOC entity | `sensor.ev_charge_target` |
| Charger control entity | **empty** (the automation controls the Wallbox) |
| Charging state entity | **empty** |
| Charge completion time | `07:00` |
| Charging speed | `15` %/h (11 kW, ~10% loss, 64 kWh battery) |
| Minimum EV SOC | `40` |
| Low SOC charging | on, level `20` |
| Low price charging | on, level `0` |
| Apply price limit / Opportunistic | off |
| Continuous charging preferred | off (cheapest separate hours) |
| Keep charger on | off |
| Smart charging activated | on |

`switch.ev_smart_charging_ev_connected` is kept in sync with the Wallbox by
[ev-smart-charging-aangesloten.yml](../automations/home%20battery%20car%20charging/ev-smart-charging-aangesloten.yml).

## 6. Shadow mode

Leave `car-charging-unified.yml` unchanged. Watch for a few weeks:
- `sensor.ev_smart_charging_status` — what the planner is doing
- `sensor.ev_smart_charging_charging` — when it would charge
- attribute `charging_schedule` — the planned hours

When switching to a dynamic contract, `car-charging-unified.yml` gets the planner sensor
as an input for grid charging (32A); solar charging (6A) and dagreis stay as they are.

## Known limitations
- The SOC must be recent when the planner runs. `kia-force-update.yml` does not refresh
  between 21:00 and 06:00, so a car connected late in the evening is planned on the last
  known SOC.
- Settings changes have no effect once automatic charging has started.
