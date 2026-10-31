# The WMS benchmark (reference, pasted by William 2026-10-31)

William's ruling: "We won't do this entire list. This is just what
a basic WMS has. So we need to use this as a benchmark."
Witness's scope rule stands: per area, the high-level basic that
works — narrow claims, checked deeply.

A WMS (Warehouse Management System) tracks these things inside the warehouse.

**1. Inventory**
- Item (SKU) and description
- Quantity on hand
- Location (zone, aisle, rack, shelf, bin)
- Lot or batch number
- Serial number
- Expiration date
- Item status (available, on hold, damaged, quarantined)
- Unit of measure (each, case, pallet)
- Item size, weight, and cube (volume)
- Pallet or license plate number (LPN)

**2. Receiving**
- Purchase order (PO) and advance ship notice (ASN)
- Carrier and trailer or container number
- Dock door and appointment time
- Expected vs. received quantity
- Damages and shortages
- Receiving time and receiver name

**3. Putaway**
- Putaway task and assigned worker
- Suggested vs. actual location
- Putaway time

**4. Storage and location**
- Location capacity (weight, size, pallet count)
- Location type (pick, reserve, staging, bulk)
- Empty and full locations
- Slotting (which item belongs in which location)

**5. Order and pick**
- Customer order, lines, and quantities
- Order priority and ship date
- Wave (a batch of orders released together)
- Pick task, pick path, and picker
- Short picks (not enough stock)
- Pick confirmation by scan

**6. Pack and ship**
- Pack station and packer
- Carton type and weight
- Shipping label and tracking number
- Carrier and service level
- Bill of lading (BOL)
- Load and trailer assignment
- Ship confirmation and time

**7. Replenishment**
- Min and max levels per pick location
- Replenishment tasks (reserve to pick)

**8. Inventory control**
- Cycle counts (small, ongoing counts)
- Physical counts (full counts)
- Adjustments and reason codes
- Variance (system count vs. real count)
- Inventory moves and transfers

**9. Returns**
- Return authorization
- Return reason
- Item condition and disposition (restock, scrap, repair)

**10. Labor**
- Worker ID and shift
- Tasks done per hour
- Task start and end time
- Travel time and idle time
- Performance vs. standard

**11. Equipment**
- Forklifts, scanners, and conveyors
- Equipment assigned to worker
- Equipment tasks

**12. Yard and dock**
- Dock door schedule
- Trailer check-in and check-out
- Dwell time (how long a trailer sits)

**13. Value-added work**
- Kitting (combining items into one kit)
- Labeling and relabeling
- Light assembly
- Special handling instructions

**14. Quality and compliance**
- Holds and quarantine
- Recalls and lot trace
- Hazmat (dangerous goods) flags
- Temperature and storage rules
- Audit trail (who did what, and when)

**15. Reports and metrics**
- Inventory accuracy
- Order fill rate
- On-time shipping
- Dock-to-stock time
- Pick accuracy
- Space use
- Labor productivity

**Tip:** Most WMS data fits into a few main tables: items,
locations, inventory, orders, tasks, and users.
