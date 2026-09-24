# Member Event Roster Visibility

**Status:** Accepted product rule (Pap, September 23, 2026); implementation
and production application require their own validation and release gates.

## Decision

An authorized member of an Event may see the names of all current attendee
registrations in that Event, including their own registration. Roster
visibility does not require either the viewer or the listed attendee to
share optional information. Turning optional sharing off does not remove
the attendee's name or revoke their ability to view the roster.

This replaces the Member Attendee Locator's former name-consent and
reciprocal "share to see" rules. It is an explicit Event product policy,
not a blanket waiver of privacy based on attendance or public visibility.

## Authority and sources

The Event owns its operational roster. The existing governed Member
identity resolver establishes the viewer's Event access on each request,
including authenticated and Temporary Event Access paths. Event and Tenant
boundaries, invalid-session handling, and inactive/cancelled registration
rules remain enforced by the database. No browser-supplied attendee identity
is authority to read the roster, and no direct table grant is introduced.

`attendees` remains the source for registration names and eligibility.
The initial implementation retains the existing Pilot-name projection,
one row per eligible registration (active/registered and not inactive).
It does not expand this projection into a separate Co-Pilot or household
directory, expose member numbers or cities, or change Event lifecycle gates.

`attendee_sharing_preferences` remains the source for optional field
permissions. Email, phone, campsite location, and coach make/model are
returned only when that attendee's respective field is explicitly shared.
Absent or false preferences return NULL. Street addresses and other fields
outside the existing contract remain absent. Campsite labels continue to
derive from governed parking occupancy. Masking happens before data leaves
the database, including data used for search.

## Preservation and delivery

This decision does not change the separately governed Coach Map roster.
It does not rewrite preferences, history, imported consent, or the meaning
of historical records. The existing `name` preference remains relevant to
the separate `get_event_participant_map_roster` contract; it no longer
controls this Member roster. The retired anonymous attendee roster remains
absent. Pap deferred map changes until after Saint George.

Import consent handling and any reconciliation of optional sharing remain
separate work. A complete Member name roster needs no manufactured consent
or bulk enabling of sharing. Existing explicit choices must be preserved.

Validation must cover names with absent/false preferences, a viewer who
shares nothing, individual optional-field masking, own-row inclusion,
invalid and cross-Event callers, expired/revoked temporary credentials,
inactive/cancelled targets, and unchanged preference/history bytes. Use a
forward migration, never edit an applied migration. Local synthetic proof
does not establish production counts or deployed behavior.
