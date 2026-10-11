# EpicentraX Administrator Guide Draft

## Tenant and Event context

This first chapter explains how to choose the organization and Event you are
working on, inspect Tenant settings, add a Tenant type, and create an Event.
It is intended for administrators. Platform administration and ordinary
Tenant/Event administration have different permissions; a visible Tenant or
Event does not by itself grant permission to change it.

**Draft status:** source-reviewed on October 10, 2026 against main `2089faa`.
Pap has confirmed general application operation and full-card Tenant selection.
The complete steps, screenshots and Safari/iPhone/iPad acceptance worksheet
still need an authenticated walkthrough before publication as a verified guide.

## 1. Know which context you are changing

A **Tenant** is the organization that owns Events. An **Event** is a particular
rally, meeting or other experience belonging to that organization.

| Control or page | What it changes | What it means for your work |
| --- | --- | --- |
| Working tenant, near the top of Admin pages | The organization used by administrative Event tools | Event lists are limited to that Tenant; switching clears the working Event |
| Admin Working Event on the Admin Dashboard | The Event used by administrative Event tools | Check the displayed Working Event before editing attendees, Agenda or other Event data |
| A Tenant card on the Tenants page | The Tenant whose settings you are inspecting | Inspecting settings does not switch the working Tenant or Event |
| Owning Tenant on Add Event | The permanent owner of the new Event | Ownership cannot be transferred through this form after creation |

The Tenant resolved from an application hostname supplies presentation/branding.
Inspecting a Tenant card or choosing an Admin working Tenant does not create a
hostname mapping or change the website address.

## 2. Switch the working Tenant

1. Save unfinished work in every open Admin tab.
2. Find **Working tenant** near the top of an Admin page.
3. Choose the organization you want from the dropdown. Inactive choices are
   labeled **(Inactive)** where they are available under your authority.
4. Read the confirmation. To continue, choose **Switch tenant**. To stay in
   the current organization, cancel the confirmation.
5. The app returns to the Admin Dashboard. The working Event is cleared and
   open Admin tabs reload; previously unsaved work should not be relied on.
6. Check the working Tenant name, then select an Event for that Tenant.

The dropdown can be unavailable while context is loading. If the Tenant is
inactive, operational tools are unavailable. A Platform Administrator can
inspect its settings and use the Tenant recovery/activation controls. An
organization with no Events cannot supply an Event to the Event tools.

## 3. Select the working Event

1. Open the **Admin Dashboard**.
2. Confirm **Working tenant** names the correct organization.
3. Under **Admin Working Event**, choose an Event from **Select an event**.
4. Check the displayed **Working Event** and its status before opening an
   Event tool or changing records.

Only Events returned under your current authority and Tenant context can
appear. If switching fails, the Dashboard reports that it could not switch;
check the displayed context and retry only when the page is ready. Save
unfinished work before changing Events. Selecting an Event does not publish
it or change its lifecycle state.

## 4. Inspect and edit Tenant settings

The **Tenants** page is a Platform Administrator workspace. Its route is
`/admin/tenants`; a Tenant Administrator's authority within an organization
is not permission to use this Platform administration surface.

1. Open **Tenants**.
2. Click or tap anywhere on the desired Tenant card. The card's accessible
   name identifies it as **Inspect settings for [Tenant name]**.
3. Check the organization name, code, slug and Active/Inactive status shown
   in the details area. This selects settings to inspect, not the working
   Tenant for Event tools.
4. Edit the supported branding or operational fields. Use the field's help
   control when you need its meaning or limitations.
5. Add an optional **Change reason**, then choose **Save Metadata**.
6. Wait for the result. Review the displayed values before moving on.

**Cancel** discards the unsaved metadata draft after the form's discard
confirmation. Selecting another Tenant or opening Add Tenant while metadata
is dirty also asks before discarding it. Some actions remain disabled until
you save or cancel the draft. Saving metadata does not change immutable
organization code, slug or Tenant identity, and does not activate the Tenant.

### Tenant field reference

| Field | Required or optional | Meaning and important limits |
| --- | --- | --- |
| Organization code | Required on creation | Unique short organization alias. Not a membership number or permission grant; this form cannot change it later |
| Slug | Required on creation | Unique readable identifier; lowercase letters/numbers with single hyphens between words. Does not create a website address; this form cannot change it later |
| Organization name | Required | The full organization name, rather than one Event's name |
| Display name | Required | The shorter name shown in lists and branding previews; does not change identity or permissions |
| App title | Required | Application title used by supporting Tenant-aware presentation |
| App tagline | Optional | Short supporting phrase where the screen supports one |
| Logo URL | Optional | Direct image URL. Blank uses the platform default; selecting an image does not save the Tenant metadata by itself |
| Logo upload | Optional, after Tenant creation | PNG, JPEG or WebP up to 2 MB. Uploaded logos are public; Save applies the selected logo choice |
| Favicon URL | Optional | Currently stores an address only; it does not yet change the browser tab icon |
| Primary, secondary and accent colors | Optional | Brand colors, for example `#2457D6`; blank uses defaults. Application of the colors depends on the supporting screen |
| Tenant type | Optional | Organization classification. Does not activate the Tenant, grant permissions, hide tools or apply suggested setup defaults |
| Post-Event edit window (days) | Optional | Blank uses the platform's 60-day default. Enter 0–59 for a shorter Tenant default; Event policy can shorten it further. Historical correction follows its separate governed process |
| Reason / Change reason | Optional | Administrative context retained in audit history. Do not enter passwords or other secrets |

## 5. Add a Tenant

Platform Administrators can create a Tenant from the Tenants page.

1. Choose **Add Tenant**.
2. Enter **Organization code**, **Slug**, **Organization name**, **Display
   name** and **App title**.
3. Complete optional branding and operational fields as needed. Use the field
   reference above; Tenant type can remain **No Tenant type**.
4. Add an optional **Reason** for the administrative history.
5. Choose **Create Tenant** and wait for the result before trying again.
6. Inspect the new Tenant's details and status. Creation and activation are
   separate actions; complete its setup before enabling operational use.

If you cancel a changed creation form, it asks whether to discard the draft.
If creation reports a validation or duplicate-code/slug error, correct the
reported value and submit again. If a request's result is uncertain, first
check whether the Tenant appears in the list rather than creating it twice.

### Activate or deactivate

**Activate Tenant** or **Deactivate Tenant** opens a separate confirmation
form with an optional Reason. Save or cancel metadata edits before using it.
Deactivation freezes operational access while retaining Tenant, Event, Admin
and historical records. Reactivation is a separate reversible action; it
restores access under the existing authority/lifecycle rules. Deactivation
is not deletion and does not erase history.

## 6. Add a Tenant type

Use this when the shared classification list lacks an appropriate type.
This is a Platform Administrator action, available within the Tenant form.

1. Beside **Tenant type**, choose **Add tenant type**.
2. Enter a **Type name** of up to 100 characters.
3. Enter a unique **Type code** of up to 64 characters. Start with a lowercase
   letter; use lowercase letters, numbers and underscores, such as
   `community_group`. Spaces and hyphens are not allowed.
4. Optionally enter a **Reason** of up to 1,000 characters.
5. Choose **Create type**. A successful result adds the shared option and
   selects it in your Tenant draft.
6. Save the surrounding Tenant form with **Create Tenant** or **Save
   Metadata** to apply that selection to the Tenant.

**Create type saves the catalog entry immediately.** Canceling the surrounding
Tenant form afterward does not remove the new type. A type-creation error
leaves the surrounding draft available; correct the message and retry.
Classification-based setup suggestions are future work and are not applied
by selecting a type today.

## 7. Create an Event

Event creation requires Platform or Tenant Administrator authority for the
active owning Tenant. Having permission to edit one existing Event is not
necessarily permission to create another.

1. Select the intended **Working tenant**.
2. Open **Event Admin** and choose **Add Event** (`/admin/events/new`).
3. Confirm **Owning Tenant** before entering the other details. It becomes
   the permanent Event owner; the creation form cannot transfer it later.
4. Enter the required **Event Name**, **End Date** and **Event Timezone**.
   Choose the timezone where the Event takes place, not necessarily where
   you are using the app.
5. Complete the optional fields below. If a Start Date is supplied, the End
   Date must be on or after it.
6. Choose **Create Event** and wait for its result.
7. Normally the app opens Event Admin with the new Event set as the working
   Event. If coordinate lookup did not find a location, the app instead shows
   **Event created** with a notice and **Open Event Admin**. The Event is
   already created; use that button rather than submitting another copy.
8. Review the new Event's details and status before continuing setup.

A new Event starts **Draft**, **inactive**, and **hidden from Members**.
Creating or selecting it does not publish it. Event activation/publication
and detailed Event editing will be covered in the next chapter.

### Event creation field reference

| Field | Required or optional | Meaning and important limits |
| --- | --- | --- |
| Owning Tenant | Required | Active organization you are authorized to create the Event for; permanent ownership |
| Event Name | Required | The Event's name |
| Location | Optional | Venue/address text used for location lookup |
| Event Code | Optional | Event reference code; comparisons ignore case and surrounding spaces. Distinct from Location Code |
| Location Code | Optional | Map location code, such as a Plus Code, used for coordinate lookup. It is not the Event Code or organization slug |
| Start Date | Optional | First Event date; cannot be after the End Date |
| End Date | Required | Last Event date |
| Event Timezone | Required | Timezone where the Event takes place |
| Latitude and Longitude | Optional pair | Enter both or leave both blank. Latitude must be −90 to 90; longitude −180 to 180. A manual pair takes precedence over location lookup |

Coordinate lookup is best effort. Not finding a location does not prevent
Event creation; the resulting notice explains how to add coordinates later.
If no active Tenant is available under your authority, the page explains
that instead of offering creation. For an uncertain request result, inspect
Event Admin for the created Event before retrying.

## 8. Common questions

**I clicked a Tenant card, but my Event tools still show another Tenant.**
The card inspects settings. Use **Working tenant**, confirm the switch, then
choose an **Admin Working Event** on the Dashboard.

**My chosen Tenant has no Event in the picker.**
Check that the Tenant is active and that you have the necessary authority.
It may not own an available Event. An authorized Platform/Tenant Administrator
can use Add Event; an Event-only administrator cannot assume that permission.

**A button is disabled.**
The page may be loading or saving, required fields may be missing, a value
may be invalid, or another metadata draft may need to be saved/canceled.
Read the field help and any status/error message before retrying.

**I canceled a Tenant draft, but the new Tenant type still exists.**
Type creation saves independently. Canceling the Tenant draft does not undo
that catalog action.

**My Favicon URL or brand colors do not change every screen.**
The favicon field is stored metadata only at present. Color use depends on
Tenant-aware presentation; the field does not promise a global theme change.

## 9. Keyboard and small-screen use

Use visible controls as well as the keyboard. The Tenant card can be focused
with Tab and activated as a button with Enter/Space. Confirmations and dialogs
have visible Cancel controls; do not dismiss a dirty Tenant draft without
reading its discard prompt. On a small screen, check that dialog fields and Save/Cancel controls are
reachable while scrolling; the device acceptance checks below are still pending.

For long edits, check the displayed Tenant/Event again before saving. Keep
other Admin tabs' work saved before switching Tenant. Do not assume layout
alone proves device acceptance; the draft checklist below tracks that work.

## 10. Publication acceptance checklist

- Platform account: inspect a Tenant without changing working context;
  create/cancel/edit a Tenant; create a type then cancel the enclosing draft;
  confirm inactive recovery and activation/deactivation behavior.
- Tenant-only account: choose an authorized working Tenant and Event; confirm
  Platform Tenant Administration is unavailable and Event creation is scoped.
- Event-only account: confirm current Event access without assuming creation
  or Platform administration authority.
- Multiple tabs: save/cancel drafts, confirm Tenant switch and cleared Event,
  account-bound selection and absence of stale context after reload.
- Event creation: required-field errors, date order, manual coordinate pair,
  successful lookup and successful creation with the coordinate notice.
- Safari desktop, iPhone and iPad: verify actual labels, focus, touch selection,
  dropdowns, dialog scrolling and reachable Save/Cancel controls.
- Capture sanitized screenshots and record the verified release/date. Do not
  include private records, account secrets or unrelated Tenant information.

## Maintainer sources

The user instructions above describe behavior; these links let future staff
verify it against the current implementation and accepted contracts.

- [Working Tenant control](../../components/admin/AdminTenantSwitcher.tsx) and
  [workspace provider](../../lib/AdminTenantWorkspaceProvider.tsx).
- [Admin Dashboard](../../app/admin/dashboard/pageContent.tsx).
- [Tenant administration](../../app/admin/tenants/page.tsx),
  [field help](../../components/admin/tenant/TenantFieldHelp.tsx), and
  [Tenant type form](../../components/admin/tenant/TenantTypeField.tsx).
- [Event creation](../../app/admin/events/new/page.tsx),
  [coordinate handling](../../lib/eventCoordinates.ts), and
  [governed creation migration](../../supabase/migrations/20261104000000_add_event_location_code.sql).
- [Event context contract](../architecture/ADR-006%20Event%20Context%20Architecture.md),
  [Tenant lifecycle contract](../architecture/ADR-014%20Tenant%20Lifecycle%20and%20Administration%20Contract.md),
  [administrative authority](../architecture/EPICENTRAX_ADMINISTRATIVE_AUTHORITY_FOUNDATION_ARCHITECTURE.md),
  and [UI standard](../architecture/EPICENTRAX_CENTRAL_UI_STANDARD_BLUEPRINT.md).
- [Documentation audit and remaining chapter plan](../ai-context/EPICENTRAX_DOCUMENTATION_AUDIT.md).
