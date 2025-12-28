# Create a Home Efficiency % without EV charging

## Create daily Helpers - Utility meter
- Create a "Helper"
- Select "Utility meter"
- Select the proper Entity
- Select "Daily" for "Meter reset cycle"

## Create a Helper - Template - Sensor
- Create a "Helper"
- Select "template"
- Choose "Sensor"
- For the state add the following code:
```
{# solar daily production in Wh #}
{% set solar = states('sensor.solar_daily') | float(0) %}

{# battery discharge in kWh #}
{% set battery_discharge = states('sensor.battery_ontladen_daily') | float(0) * 1000 %}

{# battery charge in kWh #}
{% set battery_charge = states('sensor.battery_geladen_daily') | float(0) * 1000 %}

{# grid engergy usage in kWh #}
{% set grid_import = states('sensor.electricity_meter_energieverbruik_sum_daily') | float(0) * 1000 %}

{# grid energy production in kWh #}
{% set grid_export = states('sensor.electricity_meter_energieproductie_daily') | float(0) * 1000 %}

{# Home consumption (your original formula) #}
{% set home_consumption = (solar + battery_discharge + grid_import) - (grid_export + battery_charge) %}

{# Internal supply (solar used in house + battery discharge used) #}
{% set internal_supply = (solar + battery_discharge) - (grid_export + battery_charge) %}

{# EV daily charging in kWh #}
{% set ev = states('sensor.wallbox_daily') | float(0) * 1000 %}

{% set home_consumption_no_ev = home_consumption - ev %}
{% if home_consumption_no_ev > 0 %}
  {{ ((internal_supply / home_consumption_no_ev) * 100) | round(2) }}
{% else %}
  0
{% endif %}
```
- Set % as the Unit of Meassurment

