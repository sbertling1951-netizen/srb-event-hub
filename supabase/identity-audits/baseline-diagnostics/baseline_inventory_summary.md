# Refreshed Baseline Ownership Inventory

## Status
PASS_WITH_REVIEW_ITEMS

## Linked object totals
- check_constraint: 22
- column: 778
- foreign_key: 76
- function: 12
- grant: 854
- index: 164
- policy: 169
- primary_key: 63
- publication_membership: 3
- rls_enabled: 64
- rls_forced: 64
- sequence: 2
- table: 64
- trigger: 12
- unique_constraint: 20

## Ownership classification totals
- BASELINE_OWNED: 1301
- RETAINED_MIGRATION_OWNED: 207
- ALTERED_BY_RETAINED_MIGRATION: 2
- SYSTEM_OR_EXTENSION_MANAGED: 857
- UNCERTAIN_REQUIRES_REVIEW: 0

## Inventory freshness result
The previous inventory was not merely stale; the current linked database still does not contain `person_role_instances`, so the linked database is behind the retained migration chain.

## person_role_instances result
Linked database contains table=`False`, columns=0, pk=0, fks=0, indexes=0, checks=0, rls_enabled=0, policies=0, triggers=0, grants=0.

## attendee_household_members_attendee_role_unique result
`attendee_household_members_attendee_role_unique` currently exists in the linked database as a unique index, while the validated baseline creates it as a unique constraint. No retained migration creates, drops, renames, or alters it. The prior unexpected difference came from comparison logic and representation mismatch rather than retained migration drift or baseline reconstruction error.

## Missing baseline objects
- public.copy_master_map_to_event(master_id uuid, event_id uuid)
- public.increment_attendee_login(p_attendee_id uuid)
- public.is_current_admin()
- public.is_super_admin(uid uuid)
- public.log_engagement_activity(p_event_id uuid, p_attendee_id uuid, p_activity_type text, p_details jsonb)
- public.member_is_registered_for_event(target_event_id uuid)
- public.record_photo_display(p_photo_id uuid)
- public.save_participant_identity(p_participant_id uuid, p_attendee_id uuid, p_event_id uuid, p_person_role text, p_sort_order integer, p_first_name text, p_last_name text, p_nickname text, p_email text, p_cell_phone text)
- public.set_updated_at()
- public.update_participant_email(p_participant_id uuid, p_email text)

## Missing retained objects
- index:public.person_role_instances:person_role_instances_attendee_id_idx
- index:public.person_role_instances:person_role_instances_attribution_method_idx
- index:public.person_role_instances:person_role_instances_event_id_idx
- index:public.person_role_instances:person_role_instances_household_member_id_idx
- index:public.person_role_instances:person_role_instances_person_id_idx
- index:public.person_role_instances:person_role_instances_role_idx
- index:public.person_role_instances:person_role_instances_tenant_id_idx
- policy:public.person_role_instances:deny_all_anonymous_person_role_instances
- policy:public.person_role_instances:deny_all_authenticated_person_role_instances
- policy:public.tenants:Active tenants are readable by browser roles
- rls_enabled:public.person_role_instances:person_role_instances
- table::person_role_instances
- trigger:public.person_role_instances:set_person_role_instances_updated_at

## Collision risks
- None

## Recommendation
LINKED_DATABASE_BEHIND_MIGRATIONS
