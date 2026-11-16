# Scenario 2 — Shipment tracking (fictional)

You receive `scenario-2-shipments.csv` from a carrier feed. The tracking system needs one record per shipment in the shape of `scenario-2-destination.schema.json`.

- **shipmentId** is the shipment's own reference, not the printed label number.
- **shippedAt** is when the shipment left the warehouse, not the last scan.
- **deliveryState** and **destinationCountry** must use the destination's codes. The feed mixes languages.
- The records are customer data: they must not be sent to a cloud AI.
