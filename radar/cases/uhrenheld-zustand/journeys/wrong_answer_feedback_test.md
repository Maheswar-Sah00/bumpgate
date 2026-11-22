---
mode: testing
max_steps: 25
---

# An invalid or wrong time is blocked or explained kindly

## Switch off the time limit
Click "Profil" in the bottom navigation.
In the "Einstellungen" section, untick the "Zeitdruck" checkbox.
Click "Karte" in the bottom navigation.

## Open a clock-reading task
In the station "Uhr ablesen", click "Stufe 1".
If the question says "Stelle die Uhr auf ... ein.", click "← Karte" and click "Stufe 1" under "Uhr ablesen" again.
Repeat until the question reads "Wie spät ist es? Lies die Uhr genau ab."
Verify the "Prüfen" button is disabled while the "Stunde" and "Minute" fields are empty.

## Try an impossible minute
Type 3 into the "Stunde" field and 75 into the "Minute" field.
Verify the "Prüfen" button is still disabled, because a minute above 59 is not accepted.

## Submit a wrong time
Clear the "Minute" field and type 1 instead, so the answer is 3:01 (level 1 clocks only show 5-minute steps, so this is always wrong).
Click "Prüfen".
Verify the feedback box shows the text "Fast! So geht es:", a line starting with "Richtige Antwort:" and a "Weiter →" button.
