# rooms76

A Telegram bot that helps the people sharing an apartment coordinate the common items they buy, taking turns room by room.

## People and places

**Apartment**:
The shared home served by one bot instance.
_Avoid_: Flat, household, house

**Room**:
A bedroom in the Apartment; the unit that takes turns, whoever lives in it.
_Avoid_: Unit, bedroom

**Resident**:
A person with a current Stay in the Apartment; only Residents may use the bot.
_Avoid_: User, roommate, tenant, member

**Apartment Group**:
The one Telegram group linked to the Apartment, where the bot posts notifications.
_Avoid_: Chat, channel

**Stay**:
A Resident living in a Room from a move-in date until an optional move-out date, both days included; a Resident has at most one current Stay, and a Room may have several.
_Avoid_: Tenancy, occupancy, assignment

**Invite**:
A single-use, expiring link an Admin creates for a Room; whoever opens it becomes a Resident with a Stay in that Room.
_Avoid_: Invitation code, join request

**Occupied Room**:
A Room with at least one current Stay; only Occupied Rooms take turns.
_Avoid_: Active room

**Admin**:
A Resident who may admit and remove Residents, manage Rooms and Stays, set the Room Order and appoint other Admins; there is always at least one.
_Avoid_: Owner, moderator

**Operator**:
The person who runs the Apartment's bot instance (holds its bot token and hosting) and configures it when deploying it; setting up the Apartment itself in the bot is an Admin's job. Not necessarily a Resident or an Admin.
_Avoid_: Owner, host, maintainer, administrator

**Export**:
A file with all of the Apartment's data that the bot sends an Admin on request; importing it into a fresh instance carries the Apartment over, e.g. when the Operator changes.
_Avoid_: Backup, dump, snapshot

**Room Order**:
The single Apartment-wide ordering of Rooms, fixed at setup, that every Rotation follows.
_Avoid_: Turn order, chain

## Shopping

**Common Item**:
Something the Apartment buys collectively, described generically (e.g. "kitchen paper").
_Avoid_: Product, shopping item, article

**Product**:
A concrete good, a specific brand and pack, that covers exactly one Common Item; usually identified by its barcode, though it may have none.
_Avoid_: Item, SKU, article

**Agreed Product**:
The one Product of a Common Item that Residents have agreed everyone should buy, so every Purchase brings the same good; optional, and any Resident may set or change it.
_Avoid_: Default product, preferred product, brand

**Rotation**:
The Occupied Rooms taking part in buying one Common Item, each with its count of Purchases of that item.
_Avoid_: Chain, queue, schedule

**Rotation Start**:
The Room that made a Common Item's first Purchase; Room Order is counted from it when breaking ties.
_Avoid_: First buyer, origin

**Turn**:
The Room in a Rotation with the fewest Purchases, ties broken by Room Order counted from the Rotation Start; a Common Item nobody has bought yet has no Turn.
_Avoid_: Assignee, owner

**Out-of-turn Purchase**:
A Purchase by a Room that does not hold the Turn; it still counts, so that Room is skipped later.
_Avoid_: Extra purchase, gift

**Run Out**:
A Resident reporting that a Common Item is finished in the Apartment.
_Avoid_: Finished, empty, out of stock

**Purchase**:
A Resident recording that they bought a Common Item on behalf of their Room.
_Avoid_: Buy, restock

**Expected Duration**:
How long a Purchase of a Common Item usually lasts for the Residents currently taking part in its Rotation; starts from an optional rough guess and is then learned from Purchase history, scaled to how many Residents there are.
_Avoid_: Pace, lifetime, restock interval

**Urgency**:
How pressing it is to buy a Common Item, the same for every Room: Run Out, Due soon (most of its Expected Duration has passed since the last Purchase) or Not yet.
_Avoid_: Priority, status
