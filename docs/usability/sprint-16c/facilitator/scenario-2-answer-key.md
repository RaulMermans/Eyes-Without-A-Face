# Scenario 2 answer key (facilitator only — do not show participants)

Seed `S16C-USABILITY-2026-11-16-logistics-r8`; source SHA-256 `0ccf7bca6779759b…`; 30 records, all transformable.

| Destination | Correct source | Trap |
| --- | --- | --- |
| shipmentId | consignment_no | label_id (unique code; its name shares the generic token “id”, so EYES may suggest it) |
| carrier | carrier_name | — |
| deliveryState | status (label created/creado → created, in transit/unterwegs → in_transit, delivered/entregado → delivered, exception/störung → exception) | — |
| destinationCountry | destination_country (Germany → DE, España → ES, Netherlands → NL, France → FR) | — |
| recipientEmail | recipient_email (lower-cased by EYES) | — |
| shippedAt | dispatch_time | last_scan_at (also a timestamp; shares the token “at”, so EYES may suggest it) |

Check a participant's transformed download: `node scripts/qa/s16c/check-usability-output.mjs <their transformed-records.json>`.
