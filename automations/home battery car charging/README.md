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
- when car battery is below 40% I want to charge it
- when the home battery is at 100% and solar panel produce more then > 1500w charge the car
- when the car is charging don't discharge the home battery
- when the car stops charging allow discharge of home battery
- after 20:00 (lower rates) charge the car

Automations:
- Car charge turn off
- Car charge solar over production
- Car charge after 20:00
- Car charge low battery
- Stop home battery on car charging
- Start home battery on car charging finished

