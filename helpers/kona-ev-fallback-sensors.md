# Kona EV sensors with fallback between two integrations

The car charging automation reads the EV battery level and AC charge limit from these
two template sensors, not directly from an integration. Each sensor uses:

1. the old integration (`kia_uvo`) when its value is valid
2. otherwise the new integration
3. otherwise a fallback value

A value is valid when it is a number between 0 and 100 (`unknown` / `unavailable` are not).

## Create a Helper - Template - Sensor: "Kona accu niveau"
- Create a "Helper"
- Select "template"
- Choose "Sensor"
- Name: `Kona accu niveau` (entity id becomes `sensor.kona_accu_niveau`)
- For the state add the following code:
```
{% set oud = states('sensor.kona_ev_battery_level') %}
{% set nieuw = states('sensor.kona_electric_battery_level') %}
{% if oud | is_number and oud | float >= 0 and oud | float <= 100 %}
  {{ oud | float }}
{% elif nieuw | is_number and nieuw | float >= 0 and nieuw | float <= 100 %}
  {{ nieuw | float }}
{% else %}
  {# Both integrations invalid: report 0% so the automation treats the battery as low and starts charging #}
  0
{% endif %}
```
- Set % as the Unit of Meassurment
- Device class: Battery, State class: Measurement

## Create a Helper - Template - Sensor: "Kona laadlimiet"
- Create a "Helper"
- Select "template"
- Choose "Sensor"
- Name: `Kona laadlimiet` (entity id becomes `sensor.kona_laadlimiet`)
- For the state add the following code:
```
{% set oud = states('number.kona_ac_charging_limit') %}
{% set nieuw = states('number.kona_electric_ac_charging_limit') %}
{% if oud | is_number and oud | float >= 0 and oud | float <= 100 %}
  {{ oud | float }}
{% elif nieuw | is_number and nieuw | float >= 0 and nieuw | float <= 100 %}
  {{ nieuw | float }}
{% else %}
  {# Both integrations invalid: assume the default limit (80%), so no dagreis modus #}
  80
{% endif %}
```
- Set % as the Unit of Meassurment
- State class: Measurement

## New integration entity ids
`sensor.kona_electric_battery_level` and `number.kona_electric_ac_charging_limit` are the
entity ids of the new integration. Check them in Settings → Devices & services → (new
integration) → KONA Electric and change them in both templates if they differ.
