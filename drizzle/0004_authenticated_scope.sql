-- Fixed-search-path helpers read only the server-verified identity or locked invite.
CREATE SCHEMA smiley_private;
REVOKE ALL ON SCHEMA smiley_private FROM PUBLIC;
GRANT USAGE ON SCHEMA smiley_private TO smiley_app;

CREATE FUNCTION smiley_private.own_user_id() RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT user_id FROM public.users WHERE auth_user_id=nullif(current_setting('app.auth_user_id',true),'')
$$;
CREATE FUNCTION smiley_private.own_hospital_id() RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT hospital_id FROM public.users WHERE auth_user_id=nullif(current_setting('app.auth_user_id',true),'')
$$;
CREATE FUNCTION smiley_private.own_staff_id() RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT staff_id FROM public.users WHERE auth_user_id=nullif(current_setting('app.auth_user_id',true),'')
$$;
CREATE FUNCTION smiley_private.is_platform_profile(target_user bigint, target_staff bigint DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS(SELECT 1 FROM public.users u JOIN public.user_roles ur ON ur.user_id=u.user_id AND ur.hospital_id=u.hospital_id
    JOIN public.roles r ON r.role_id=ur.role_id
    WHERE (u.user_id=target_user OR u.staff_id=target_staff) AND r.role_code='SUPER_ADMIN')
$$;
CREATE FUNCTION smiley_private.invite_allows(tenant bigint, branch bigint DEFAULT NULL, role bigint DEFAULT NULL, mail text DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS(SELECT 1 FROM public.staff_invitations i
    WHERE i.id=nullif(current_setting('app.accepting_invitation_id',true),'')
    AND i.token_hash=nullif(current_setting('app.invitation_token_hash',true),'')
    AND i.status='PENDING' AND i.expires_at>now() AND i.hospital_id=tenant
    AND (branch IS NULL OR i.branch_id=branch) AND (role IS NULL OR i.role_id=role)
    AND (mail IS NULL OR i.email=mail))
$$;
-- Locking also reads terminal/expired token rows for controlled lifecycle errors.
-- This helper permits no state change; acceptance still uses the strict policy.
CREATE FUNCTION smiley_private.lock_invitation(hashed_token text)
RETURNS SETOF public.staff_invitations
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT i.* FROM public.staff_invitations i
  WHERE hashed_token ~ '^[0-9a-f]{64}$'
    AND hashed_token=nullif(current_setting('app.invitation_token_hash',true),'')
    AND i.token_hash=hashed_token
  FOR UPDATE
$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA smiley_private FROM PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA smiley_private TO smiley_app;

CREATE FUNCTION smiley_private.in_hospital(tenant bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog, public, smiley_private AS $$
 SELECT tenant = nullif(current_setting('app.hospital_id',true),'')::bigint
 AND EXISTS(SELECT 1 FROM public.users u JOIN public.staff s ON s.staff_id=u.staff_id
 JOIN public.hospitals h ON h.hospital_id=u.hospital_id
 WHERE u.auth_user_id=nullif(current_setting('app.auth_user_id',true),'') AND u.hospital_id=tenant
 AND u.user_id=nullif(current_setting('app.user_id',true),'')::bigint
 AND u.status='ACTIVE' AND s.status='ACTIVE' AND h.status='ACTIVE'
 AND (EXISTS(SELECT 1 FROM public.user_roles ur JOIN public.roles r USING(role_id)
 WHERE ur.user_id=u.user_id AND r.role_code='HOSPITAL_ADMIN' AND r.status='ACTIVE')
 OR EXISTS(SELECT 1 FROM public.user_branch_memberships m JOIN public.roles r USING(role_id)
 JOIN public.branches b ON b.branch_id=m.branch_id AND b.hospital_id=m.hospital_id
 WHERE m.user_id=u.user_id AND m.hospital_id=tenant AND m.status='ACTIVE' AND b.status='ACTIVE' AND r.status='ACTIVE'
 AND r.role_code IN ('INSURANCE_EXECUTIVE','TPA_EXECUTIVE','CLAIM_VERIFIER','BILLING_OFFICER','FINANCE_OFFICER','REPORT_USER','DOCTOR','RECEPTIONIST'))))
 AND NOT EXISTS(SELECT 1 FROM public.user_roles ur JOIN public.roles r USING(role_id)
 WHERE ur.user_id=smiley_private.own_user_id() AND r.role_code='SUPER_ADMIN' AND r.status='ACTIVE')
$$;
CREATE FUNCTION smiley_private.in_branch(tenant bigint, branch bigint, writing boolean DEFAULT false) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog, public, smiley_private AS $$
 SELECT smiley_private.in_hospital(tenant) AND
   branch = ANY(coalesce(string_to_array(nullif(current_setting(CASE WHEN writing THEN 'app.write_branch_ids' ELSE 'app.branch_ids' END,true),''),',')::bigint[],ARRAY[]::bigint[]))
 AND EXISTS(SELECT 1 FROM public.branches b WHERE b.hospital_id=tenant AND b.branch_id=branch AND b.status='ACTIVE')
 AND (EXISTS(SELECT 1 FROM public.user_roles ur JOIN public.roles r USING(role_id)
 WHERE ur.user_id=smiley_private.own_user_id() AND r.role_code='HOSPITAL_ADMIN' AND r.status='ACTIVE')
 OR EXISTS(SELECT 1 FROM public.user_branch_memberships m JOIN public.roles r USING(role_id)
 WHERE m.user_id=smiley_private.own_user_id() AND m.hospital_id=tenant AND m.branch_id=branch
 AND m.status='ACTIVE' AND r.status='ACTIVE' AND
 ((NOT writing AND r.role_code IN ('INSURANCE_EXECUTIVE','TPA_EXECUTIVE','CLAIM_VERIFIER','BILLING_OFFICER','FINANCE_OFFICER','REPORT_USER','DOCTOR','RECEPTIONIST'))
 OR r.role_code IN ('INSURANCE_EXECUTIVE','TPA_EXECUTIVE','CLAIM_VERIFIER')
 OR (current_setting('app.can_register',true)='true' AND current_setting('app.permission',true)='patient:write' AND r.role_code='RECEPTIONIST'))))
$$;
CREATE FUNCTION smiley_private.hospital_admin(tenant bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog, public, smiley_private AS $$
 SELECT smiley_private.in_hospital(tenant) AND current_setting('app.is_hospital_admin',true)='true'
 AND EXISTS(SELECT 1 FROM public.user_roles ur JOIN public.roles r USING(role_id)
 WHERE ur.user_id=smiley_private.own_user_id() AND r.role_code='HOSPITAL_ADMIN' AND r.status='ACTIVE')
$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA smiley_private FROM PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA smiley_private TO smiley_app;

-- Share locks serialize an assignment with the implemented staff-deactivation path.
CREATE FUNCTION smiley_private.lock_case_owner(target_user bigint, target_branch bigint) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog, public, smiley_private AS $$
DECLARE candidate bigint;
BEGIN
 IF NOT smiley_private.in_branch(nullif(current_setting('app.hospital_id',true),'')::bigint,target_branch,true) THEN RETURN false; END IF;
 SELECT u.user_id INTO candidate FROM public.users u JOIN public.staff s ON s.staff_id=u.staff_id AND s.hospital_id=u.hospital_id
 WHERE u.user_id=target_user AND u.hospital_id=nullif(current_setting('app.hospital_id',true),'')::bigint
 AND u.status='ACTIVE' AND s.status='ACTIVE'
 AND EXISTS(SELECT 1 FROM public.user_roles ur JOIN public.roles r USING(role_id) WHERE ur.user_id=u.user_id AND r.status='ACTIVE'
 AND (r.role_code='HOSPITAL_ADMIN' OR (r.role_code IN ('INSURANCE_EXECUTIVE','TPA_EXECUTIVE','CLAIM_VERIFIER')
 AND EXISTS(SELECT 1 FROM public.user_branch_memberships m WHERE m.user_id=u.user_id AND m.role_id=r.role_id
 AND m.hospital_id=u.hospital_id AND m.branch_id=target_branch AND m.status='ACTIVE'))))
 AND NOT EXISTS(SELECT 1 FROM public.user_roles ur JOIN public.roles r USING(role_id) WHERE ur.user_id=u.user_id AND r.role_code='SUPER_ADMIN')
 FOR SHARE OF u,s;
 RETURN candidate IS NOT NULL;
END
$$;
REVOKE ALL ON FUNCTION smiley_private.lock_case_owner(bigint,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION smiley_private.lock_case_owner(bigint,bigint) TO smiley_app;


ALTER TABLE public."hospitals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."hospitals" FORCE ROW LEVEL SECURITY;
CREATE POLICY migration_cli ON public."hospitals" FOR ALL TO smiley_migrator USING (true) WITH CHECK (true);
CREATE POLICY metadata_read ON public."hospitals" FOR SELECT TO smiley_app USING (hospital_id=smiley_private.own_hospital_id() OR smiley_private.invite_allows(hospital_id) OR EXISTS(SELECT 1 FROM public.user_roles ur JOIN public.roles r USING(role_id) WHERE ur.user_id=smiley_private.own_user_id() AND r.role_code='SUPER_ADMIN' AND r.status='ACTIVE'));
CREATE POLICY hospital_update ON public."hospitals" FOR UPDATE TO smiley_app USING (smiley_private.hospital_admin(hospital_id)) WITH CHECK (smiley_private.hospital_admin(hospital_id));

ALTER TABLE public."departments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."departments" FORCE ROW LEVEL SECURITY;
CREATE POLICY migration_cli ON public."departments" FOR ALL TO smiley_migrator USING (true) WITH CHECK (true);
CREATE POLICY scoped_read ON public."departments" FOR SELECT TO smiley_app USING (smiley_private.in_hospital(hospital_id));

ALTER TABLE public."roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."roles" FORCE ROW LEVEL SECURITY;
CREATE POLICY migration_cli ON public."roles" FOR ALL TO smiley_migrator USING (true) WITH CHECK (true);
CREATE POLICY catalog_read ON public."roles" FOR SELECT TO smiley_app USING (true);

ALTER TABLE public."permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."permissions" FORCE ROW LEVEL SECURITY;
CREATE POLICY migration_cli ON public."permissions" FOR ALL TO smiley_migrator USING (true) WITH CHECK (true);
CREATE POLICY catalog_read ON public."permissions" FOR SELECT TO smiley_app USING (true);

ALTER TABLE public."role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."role_permissions" FORCE ROW LEVEL SECURITY;
CREATE POLICY migration_cli ON public."role_permissions" FOR ALL TO smiley_migrator USING (true) WITH CHECK (true);
CREATE POLICY catalog_read ON public."role_permissions" FOR SELECT TO smiley_app USING (true);

ALTER TABLE public."staff" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."staff" FORCE ROW LEVEL SECURITY;
CREATE POLICY migration_cli ON public."staff" FOR ALL TO smiley_migrator USING (true) WITH CHECK (true);
CREATE POLICY staff_read ON public."staff" FOR SELECT TO smiley_app USING (staff_id=smiley_private.own_staff_id() OR smiley_private.in_hospital(hospital_id) OR smiley_private.invite_allows(hospital_id,NULL,NULL,email));
CREATE POLICY staff_insert ON public."staff" FOR INSERT TO smiley_app WITH CHECK (smiley_private.hospital_admin(hospital_id) OR (smiley_private.invite_allows(hospital_id,NULL,NULL,email) AND status='ACTIVE'));
CREATE POLICY staff_update ON public."staff" FOR UPDATE TO smiley_app USING (smiley_private.hospital_admin(hospital_id) AND NOT smiley_private.is_platform_profile(NULL,staff_id)) WITH CHECK (smiley_private.hospital_admin(hospital_id) AND NOT smiley_private.is_platform_profile(NULL,staff_id));

ALTER TABLE public."users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."users" FORCE ROW LEVEL SECURITY;
CREATE POLICY migration_cli ON public."users" FOR ALL TO smiley_migrator USING (true) WITH CHECK (true);
CREATE POLICY identity_read ON public."users" FOR SELECT TO smiley_app USING (auth_user_id=nullif(current_setting('app.auth_user_id',true),'') OR smiley_private.in_hospital(hospital_id));
CREATE POLICY identity_insert ON public."users" FOR INSERT TO smiley_app WITH CHECK ((smiley_private.invite_allows(hospital_id,NULL,NULL,email) AND auth_user_id=nullif(current_setting('app.auth_user_id',true),'') AND EXISTS(SELECT 1 FROM auth_user a WHERE a.id=auth_user_id AND a.email=users.email)) AND status='ACTIVE');
CREATE POLICY identity_update ON public."users" FOR UPDATE TO smiley_app USING (smiley_private.hospital_admin(hospital_id) AND NOT smiley_private.is_platform_profile(user_id)) WITH CHECK (smiley_private.hospital_admin(hospital_id) AND NOT smiley_private.is_platform_profile(user_id));

ALTER TABLE public."user_roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."user_roles" FORCE ROW LEVEL SECURITY;
CREATE POLICY migration_cli ON public."user_roles" FOR ALL TO smiley_migrator USING (true) WITH CHECK (true);
CREATE POLICY grants_read ON public."user_roles" FOR SELECT TO smiley_app USING (user_id=smiley_private.own_user_id() OR smiley_private.in_hospital(hospital_id));
CREATE POLICY grants_insert ON public."user_roles" FOR INSERT TO smiley_app WITH CHECK ((smiley_private.hospital_admin(hospital_id) AND EXISTS(SELECT 1 FROM public.roles r WHERE r.role_id=user_roles.role_id AND r.role_code<>'SUPER_ADMIN') AND NOT smiley_private.is_platform_profile(user_id)) OR ((smiley_private.invite_allows(hospital_id,NULL,role_id) AND user_id=smiley_private.own_user_id()) AND EXISTS(SELECT 1 FROM public.roles r WHERE r.role_id=user_roles.role_id AND r.role_code<>'SUPER_ADMIN')));
CREATE POLICY grants_update ON public."user_roles" FOR UPDATE TO smiley_app USING (smiley_private.hospital_admin(hospital_id) AND EXISTS(SELECT 1 FROM public.roles r WHERE r.role_id=user_roles.role_id AND r.role_code<>'SUPER_ADMIN') AND NOT smiley_private.is_platform_profile(user_id)) WITH CHECK (smiley_private.hospital_admin(hospital_id) AND EXISTS(SELECT 1 FROM public.roles r WHERE r.role_id=user_roles.role_id AND r.role_code<>'SUPER_ADMIN') AND NOT smiley_private.is_platform_profile(user_id));
CREATE POLICY grants_delete ON public."user_roles" FOR DELETE TO smiley_app USING (smiley_private.hospital_admin(hospital_id) AND EXISTS(SELECT 1 FROM public.roles r WHERE r.role_id=user_roles.role_id AND r.role_code<>'SUPER_ADMIN') AND NOT smiley_private.is_platform_profile(user_id));

ALTER TABLE public."patients" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."patients" FORCE ROW LEVEL SECURITY;
CREATE POLICY migration_cli ON public."patients" FOR ALL TO smiley_migrator USING (true) WITH CHECK (true);
CREATE POLICY registry_read ON public."patients" FOR SELECT TO smiley_app USING (smiley_private.in_hospital(hospital_id));
CREATE POLICY registry_insert ON public."patients" FOR INSERT TO smiley_app WITH CHECK (smiley_private.in_hospital(hospital_id) AND current_setting('app.can_register',true)='true' AND EXISTS(SELECT 1 FROM unnest(coalesce(string_to_array(nullif(current_setting('app.write_branch_ids',true),''),',')::bigint[],ARRAY[]::bigint[])) AS grant_id WHERE smiley_private.in_branch(hospital_id,grant_id,true)));
CREATE POLICY registry_update ON public."patients" FOR UPDATE TO smiley_app USING (smiley_private.in_hospital(hospital_id) AND current_setting('app.can_register',true)='true' AND EXISTS(SELECT 1 FROM unnest(coalesce(string_to_array(nullif(current_setting('app.write_branch_ids',true),''),',')::bigint[],ARRAY[]::bigint[])) AS grant_id WHERE smiley_private.in_branch(hospital_id,grant_id,true))) WITH CHECK (smiley_private.in_hospital(hospital_id) AND current_setting('app.can_register',true)='true' AND EXISTS(SELECT 1 FROM unnest(coalesce(string_to_array(nullif(current_setting('app.write_branch_ids',true),''),',')::bigint[],ARRAY[]::bigint[])) AS grant_id WHERE smiley_private.in_branch(hospital_id,grant_id,true)));

ALTER TABLE public."patient_documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."patient_documents" FORCE ROW LEVEL SECURITY;
CREATE POLICY migration_cli ON public."patient_documents" FOR ALL TO smiley_migrator USING (true) WITH CHECK (true);
CREATE POLICY scoped_read ON public."patient_documents" FOR SELECT TO smiley_app USING (smiley_private.in_hospital(hospital_id));

ALTER TABLE public."insurance_categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."insurance_categories" FORCE ROW LEVEL SECURITY;
CREATE POLICY migration_cli ON public."insurance_categories" FOR ALL TO smiley_migrator USING (true) WITH CHECK (true);
CREATE POLICY catalog_read ON public."insurance_categories" FOR SELECT TO smiley_app USING (true);

ALTER TABLE public."insurance_subcategories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."insurance_subcategories" FORCE ROW LEVEL SECURITY;
CREATE POLICY migration_cli ON public."insurance_subcategories" FOR ALL TO smiley_migrator USING (true) WITH CHECK (true);
CREATE POLICY catalog_read ON public."insurance_subcategories" FOR SELECT TO smiley_app USING (true);

ALTER TABLE public."insurance_companies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."insurance_companies" FORCE ROW LEVEL SECURITY;
CREATE POLICY migration_cli ON public."insurance_companies" FOR ALL TO smiley_migrator USING (true) WITH CHECK (true);
CREATE POLICY catalog_read ON public."insurance_companies" FOR SELECT TO smiley_app USING (true);

ALTER TABLE public."tpas" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."tpas" FORCE ROW LEVEL SECURITY;
CREATE POLICY migration_cli ON public."tpas" FOR ALL TO smiley_migrator USING (true) WITH CHECK (true);
CREATE POLICY catalog_read ON public."tpas" FOR SELECT TO smiley_app USING (true);

ALTER TABLE public."insurance_company_tpas" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."insurance_company_tpas" FORCE ROW LEVEL SECURITY;
CREATE POLICY migration_cli ON public."insurance_company_tpas" FOR ALL TO smiley_migrator USING (true) WITH CHECK (true);
CREATE POLICY catalog_read ON public."insurance_company_tpas" FOR SELECT TO smiley_app USING (true);

ALTER TABLE public."insurance_policies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."insurance_policies" FORCE ROW LEVEL SECURITY;
CREATE POLICY migration_cli ON public."insurance_policies" FOR ALL TO smiley_migrator USING (true) WITH CHECK (true);
CREATE POLICY catalog_read ON public."insurance_policies" FOR SELECT TO smiley_app USING (true);

ALTER TABLE public."patient_insurance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."patient_insurance" FORCE ROW LEVEL SECURITY;
CREATE POLICY migration_cli ON public."patient_insurance" FOR ALL TO smiley_migrator USING (true) WITH CHECK (true);
CREATE POLICY registry_read ON public."patient_insurance" FOR SELECT TO smiley_app USING (smiley_private.in_hospital(hospital_id));
CREATE POLICY registry_insert ON public."patient_insurance" FOR INSERT TO smiley_app WITH CHECK (smiley_private.in_hospital(hospital_id) AND current_setting('app.can_register',true)='true' AND EXISTS(SELECT 1 FROM unnest(coalesce(string_to_array(nullif(current_setting('app.write_branch_ids',true),''),',')::bigint[],ARRAY[]::bigint[])) AS grant_id WHERE smiley_private.in_branch(hospital_id,grant_id,true)));
CREATE POLICY registry_update ON public."patient_insurance" FOR UPDATE TO smiley_app USING (smiley_private.in_hospital(hospital_id) AND current_setting('app.can_register',true)='true' AND EXISTS(SELECT 1 FROM unnest(coalesce(string_to_array(nullif(current_setting('app.write_branch_ids',true),''),',')::bigint[],ARRAY[]::bigint[])) AS grant_id WHERE smiley_private.in_branch(hospital_id,grant_id,true))) WITH CHECK (smiley_private.in_hospital(hospital_id) AND current_setting('app.can_register',true)='true' AND EXISTS(SELECT 1 FROM unnest(coalesce(string_to_array(nullif(current_setting('app.write_branch_ids',true),''),',')::bigint[],ARRAY[]::bigint[])) AS grant_id WHERE smiley_private.in_branch(hospital_id,grant_id,true)));

ALTER TABLE public."appointments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."appointments" FORCE ROW LEVEL SECURITY;
CREATE POLICY migration_cli ON public."appointments" FOR ALL TO smiley_migrator USING (true) WITH CHECK (true);
CREATE POLICY scoped_read ON public."appointments" FOR SELECT TO smiley_app USING (smiley_private.in_branch(hospital_id,branch_id));

ALTER TABLE public."encounters" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."encounters" FORCE ROW LEVEL SECURITY;
CREATE POLICY migration_cli ON public."encounters" FOR ALL TO smiley_migrator USING (true) WITH CHECK (true);
CREATE POLICY scoped_read ON public."encounters" FOR SELECT TO smiley_app USING (smiley_private.in_branch(hospital_id,branch_id));
CREATE POLICY scoped_insert ON public."encounters" FOR INSERT TO smiley_app WITH CHECK (smiley_private.in_branch(hospital_id,branch_id,true) AND current_setting('app.can_register',true)='true');
CREATE POLICY scoped_update ON public."encounters" FOR UPDATE TO smiley_app USING (smiley_private.in_branch(hospital_id,branch_id,true) AND current_setting('app.can_register',true)='true') WITH CHECK (smiley_private.in_branch(hospital_id,branch_id,true) AND current_setting('app.can_register',true)='true');

ALTER TABLE public."treatment_services" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."treatment_services" FORCE ROW LEVEL SECURITY;
CREATE POLICY migration_cli ON public."treatment_services" FOR ALL TO smiley_migrator USING (true) WITH CHECK (true);
CREATE POLICY catalog_read ON public."treatment_services" FOR SELECT TO smiley_app USING (true);

ALTER TABLE public."encounter_services" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."encounter_services" FORCE ROW LEVEL SECURITY;
CREATE POLICY migration_cli ON public."encounter_services" FOR ALL TO smiley_migrator USING (true) WITH CHECK (true);
CREATE POLICY scoped_read ON public."encounter_services" FOR SELECT TO smiley_app USING (smiley_private.in_branch(hospital_id,branch_id));

ALTER TABLE public."claims" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."claims" FORCE ROW LEVEL SECURITY;
CREATE POLICY migration_cli ON public."claims" FOR ALL TO smiley_migrator USING (true) WITH CHECK (true);
CREATE POLICY scoped_read ON public."claims" FOR SELECT TO smiley_app USING (smiley_private.in_branch(hospital_id,branch_id));
CREATE POLICY scoped_insert ON public."claims" FOR INSERT TO smiley_app WITH CHECK (smiley_private.in_branch(hospital_id,branch_id,true) AND (smiley_private.hospital_admin(hospital_id) OR current_setting('app.permission',true) IN ('case:write','case:act','document:write')));
CREATE POLICY scoped_update ON public."claims" FOR UPDATE TO smiley_app USING (smiley_private.in_branch(hospital_id,branch_id,true) AND (smiley_private.hospital_admin(hospital_id) OR current_setting('app.permission',true) IN ('case:write','case:act','document:write'))) WITH CHECK (smiley_private.in_branch(hospital_id,branch_id,true) AND (smiley_private.hospital_admin(hospital_id) OR current_setting('app.permission',true) IN ('case:write','case:act','document:write')));

ALTER TABLE public."eligibility_checks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."eligibility_checks" FORCE ROW LEVEL SECURITY;
CREATE POLICY migration_cli ON public."eligibility_checks" FOR ALL TO smiley_migrator USING (true) WITH CHECK (true);
CREATE POLICY scoped_read ON public."eligibility_checks" FOR SELECT TO smiley_app USING (smiley_private.in_branch(hospital_id,branch_id));

ALTER TABLE public."pre_authorizations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."pre_authorizations" FORCE ROW LEVEL SECURITY;
CREATE POLICY migration_cli ON public."pre_authorizations" FOR ALL TO smiley_migrator USING (true) WITH CHECK (true);
CREATE POLICY scoped_read ON public."pre_authorizations" FOR SELECT TO smiley_app USING (smiley_private.in_branch(hospital_id,branch_id));

ALTER TABLE public."claim_documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."claim_documents" FORCE ROW LEVEL SECURITY;
CREATE POLICY migration_cli ON public."claim_documents" FOR ALL TO smiley_migrator USING (true) WITH CHECK (true);
CREATE POLICY scoped_read ON public."claim_documents" FOR SELECT TO smiley_app USING (smiley_private.in_branch(hospital_id,branch_id));
CREATE POLICY scoped_insert ON public."claim_documents" FOR INSERT TO smiley_app WITH CHECK (smiley_private.in_branch(hospital_id,branch_id,true) AND (smiley_private.hospital_admin(hospital_id) OR current_setting('app.permission',true)='document:write'));
CREATE POLICY scoped_update ON public."claim_documents" FOR UPDATE TO smiley_app USING (smiley_private.in_branch(hospital_id,branch_id,true) AND (smiley_private.hospital_admin(hospital_id) OR current_setting('app.permission',true)='document:write')) WITH CHECK (smiley_private.in_branch(hospital_id,branch_id,true) AND (smiley_private.hospital_admin(hospital_id) OR current_setting('app.permission',true)='document:write'));

ALTER TABLE public."claim_submissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."claim_submissions" FORCE ROW LEVEL SECURITY;
CREATE POLICY migration_cli ON public."claim_submissions" FOR ALL TO smiley_migrator USING (true) WITH CHECK (true);
CREATE POLICY scoped_read ON public."claim_submissions" FOR SELECT TO smiley_app USING (smiley_private.in_branch(hospital_id,branch_id));

ALTER TABLE public."claim_queries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."claim_queries" FORCE ROW LEVEL SECURITY;
CREATE POLICY migration_cli ON public."claim_queries" FOR ALL TO smiley_migrator USING (true) WITH CHECK (true);
CREATE POLICY scoped_read ON public."claim_queries" FOR SELECT TO smiley_app USING (smiley_private.in_branch(hospital_id,branch_id));
CREATE POLICY scoped_insert ON public."claim_queries" FOR INSERT TO smiley_app WITH CHECK (smiley_private.in_branch(hospital_id,branch_id,true) AND (smiley_private.hospital_admin(hospital_id) OR current_setting('app.permission',true) IN ('case:write','case:act')));
CREATE POLICY scoped_update ON public."claim_queries" FOR UPDATE TO smiley_app USING (smiley_private.in_branch(hospital_id,branch_id,true) AND (smiley_private.hospital_admin(hospital_id) OR current_setting('app.permission',true) IN ('case:write','case:act'))) WITH CHECK (smiley_private.in_branch(hospital_id,branch_id,true) AND (smiley_private.hospital_admin(hospital_id) OR current_setting('app.permission',true) IN ('case:write','case:act')));

ALTER TABLE public."claim_decisions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."claim_decisions" FORCE ROW LEVEL SECURITY;
CREATE POLICY migration_cli ON public."claim_decisions" FOR ALL TO smiley_migrator USING (true) WITH CHECK (true);
CREATE POLICY scoped_read ON public."claim_decisions" FOR SELECT TO smiley_app USING (smiley_private.in_branch(hospital_id,branch_id));

ALTER TABLE public."settlements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."settlements" FORCE ROW LEVEL SECURITY;
CREATE POLICY migration_cli ON public."settlements" FOR ALL TO smiley_migrator USING (true) WITH CHECK (true);
CREATE POLICY scoped_read ON public."settlements" FOR SELECT TO smiley_app USING (smiley_private.in_branch(hospital_id,branch_id));

ALTER TABLE public."invoices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."invoices" FORCE ROW LEVEL SECURITY;
CREATE POLICY migration_cli ON public."invoices" FOR ALL TO smiley_migrator USING (true) WITH CHECK (true);
CREATE POLICY scoped_read ON public."invoices" FOR SELECT TO smiley_app USING (smiley_private.in_branch(hospital_id,branch_id));

ALTER TABLE public."invoice_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."invoice_items" FORCE ROW LEVEL SECURITY;
CREATE POLICY migration_cli ON public."invoice_items" FOR ALL TO smiley_migrator USING (true) WITH CHECK (true);
CREATE POLICY scoped_read ON public."invoice_items" FOR SELECT TO smiley_app USING (smiley_private.in_branch(hospital_id,branch_id));

ALTER TABLE public."payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."payments" FORCE ROW LEVEL SECURITY;
CREATE POLICY migration_cli ON public."payments" FOR ALL TO smiley_migrator USING (true) WITH CHECK (true);
CREATE POLICY scoped_read ON public."payments" FOR SELECT TO smiley_app USING (smiley_private.in_branch(hospital_id,branch_id));

ALTER TABLE public."notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."notifications" FORCE ROW LEVEL SECURITY;
CREATE POLICY migration_cli ON public."notifications" FOR ALL TO smiley_migrator USING (true) WITH CHECK (true);
CREATE POLICY scoped_read ON public."notifications" FOR SELECT TO smiley_app USING (smiley_private.in_hospital(hospital_id) AND (branch_id IS NULL OR smiley_private.in_branch(hospital_id,branch_id)));

ALTER TABLE public."workflow_definitions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."workflow_definitions" FORCE ROW LEVEL SECURITY;
CREATE POLICY migration_cli ON public."workflow_definitions" FOR ALL TO smiley_migrator USING (true) WITH CHECK (true);
CREATE POLICY catalog_read ON public."workflow_definitions" FOR SELECT TO smiley_app USING (true);

ALTER TABLE public."workflow_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."workflow_runs" FORCE ROW LEVEL SECURITY;
CREATE POLICY migration_cli ON public."workflow_runs" FOR ALL TO smiley_migrator USING (true) WITH CHECK (true);
CREATE POLICY scoped_read ON public."workflow_runs" FOR SELECT TO smiley_app USING (smiley_private.in_hospital(hospital_id));

ALTER TABLE public."ai_agent_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ai_agent_runs" FORCE ROW LEVEL SECURITY;
CREATE POLICY migration_cli ON public."ai_agent_runs" FOR ALL TO smiley_migrator USING (true) WITH CHECK (true);
CREATE POLICY scoped_read ON public."ai_agent_runs" FOR SELECT TO smiley_app USING (smiley_private.in_hospital(hospital_id));

ALTER TABLE public."audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."audit_logs" FORCE ROW LEVEL SECURITY;
CREATE POLICY migration_cli ON public."audit_logs" FOR ALL TO smiley_migrator USING (true) WITH CHECK (true);
CREATE POLICY log_read ON public."audit_logs" FOR SELECT TO smiley_app USING (smiley_private.in_hospital(hospital_id) AND (smiley_private.hospital_admin(hospital_id) OR user_id=smiley_private.own_user_id() OR (smiley_private.in_branch(hospital_id,branch_id))));
CREATE POLICY log_append ON public."audit_logs" FOR INSERT TO smiley_app WITH CHECK (smiley_private.in_hospital(hospital_id) AND user_id=smiley_private.own_user_id() AND ((branch_id IS NOT NULL AND smiley_private.in_branch(hospital_id,branch_id,true)) OR (branch_id IS NULL AND (smiley_private.hospital_admin(hospital_id) OR current_setting('app.can_register',true)='true'))));

ALTER TABLE public."login_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."login_logs" FORCE ROW LEVEL SECURITY;
CREATE POLICY migration_cli ON public."login_logs" FOR ALL TO smiley_migrator USING (true) WITH CHECK (true);
CREATE POLICY log_read ON public."login_logs" FOR SELECT TO smiley_app USING (smiley_private.in_hospital(hospital_id) AND (smiley_private.hospital_admin(hospital_id) OR user_id=smiley_private.own_user_id() OR (smiley_private.in_branch(hospital_id,branch_id))));
CREATE POLICY log_append ON public."login_logs" FOR INSERT TO smiley_app WITH CHECK (smiley_private.in_hospital(hospital_id) AND user_id=smiley_private.own_user_id() AND ((branch_id IS NOT NULL AND smiley_private.in_branch(hospital_id,branch_id,true)) OR (branch_id IS NULL AND (smiley_private.hospital_admin(hospital_id) OR current_setting('app.can_register',true)='true'))));

ALTER TABLE public."coverage_rules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."coverage_rules" FORCE ROW LEVEL SECURITY;
CREATE POLICY migration_cli ON public."coverage_rules" FOR ALL TO smiley_migrator USING (true) WITH CHECK (true);
CREATE POLICY catalog_read ON public."coverage_rules" FOR SELECT TO smiley_app USING (true);

ALTER TABLE public."corporate_accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."corporate_accounts" FORCE ROW LEVEL SECURITY;
CREATE POLICY migration_cli ON public."corporate_accounts" FOR ALL TO smiley_migrator USING (true) WITH CHECK (true);
CREATE POLICY scoped_read ON public."corporate_accounts" FOR SELECT TO smiley_app USING (smiley_private.in_hospital(hospital_id));

ALTER TABLE public."government_schemes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."government_schemes" FORCE ROW LEVEL SECURITY;
CREATE POLICY migration_cli ON public."government_schemes" FOR ALL TO smiley_migrator USING (true) WITH CHECK (true);
CREATE POLICY catalog_read ON public."government_schemes" FOR SELECT TO smiley_app USING (true);

ALTER TABLE public."claim_government_scheme" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."claim_government_scheme" FORCE ROW LEVEL SECURITY;
CREATE POLICY migration_cli ON public."claim_government_scheme" FOR ALL TO smiley_migrator USING (true) WITH CHECK (true);
CREATE POLICY scoped_read ON public."claim_government_scheme" FOR SELECT TO smiley_app USING (smiley_private.in_branch(hospital_id,branch_id));

ALTER TABLE public."branches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."branches" FORCE ROW LEVEL SECURITY;
CREATE POLICY migration_cli ON public."branches" FOR ALL TO smiley_migrator USING (true) WITH CHECK (true);
CREATE POLICY metadata_read ON public."branches" FOR SELECT TO smiley_app USING (hospital_id=smiley_private.own_hospital_id() OR smiley_private.invite_allows(hospital_id));
CREATE POLICY branch_insert ON public."branches" FOR INSERT TO smiley_app WITH CHECK (smiley_private.hospital_admin(hospital_id));
CREATE POLICY branch_update ON public."branches" FOR UPDATE TO smiley_app USING (smiley_private.hospital_admin(hospital_id)) WITH CHECK (smiley_private.hospital_admin(hospital_id));

ALTER TABLE public."user_branch_memberships" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."user_branch_memberships" FORCE ROW LEVEL SECURITY;
CREATE POLICY migration_cli ON public."user_branch_memberships" FOR ALL TO smiley_migrator USING (true) WITH CHECK (true);
CREATE POLICY grants_read ON public."user_branch_memberships" FOR SELECT TO smiley_app USING (user_id=smiley_private.own_user_id() OR smiley_private.in_hospital(hospital_id));
CREATE POLICY grants_insert ON public."user_branch_memberships" FOR INSERT TO smiley_app WITH CHECK ((smiley_private.hospital_admin(hospital_id) AND EXISTS(SELECT 1 FROM public.roles r WHERE r.role_id=user_branch_memberships.role_id AND r.role_code<>'SUPER_ADMIN') AND NOT smiley_private.is_platform_profile(user_id)) OR ((smiley_private.invite_allows(hospital_id,branch_id,role_id) AND user_id=smiley_private.own_user_id()) AND EXISTS(SELECT 1 FROM public.roles r WHERE r.role_id=user_branch_memberships.role_id AND r.role_code<>'SUPER_ADMIN')));
CREATE POLICY grants_update ON public."user_branch_memberships" FOR UPDATE TO smiley_app USING (smiley_private.hospital_admin(hospital_id) AND EXISTS(SELECT 1 FROM public.roles r WHERE r.role_id=user_branch_memberships.role_id AND r.role_code<>'SUPER_ADMIN') AND NOT smiley_private.is_platform_profile(user_id)) WITH CHECK (smiley_private.hospital_admin(hospital_id) AND EXISTS(SELECT 1 FROM public.roles r WHERE r.role_id=user_branch_memberships.role_id AND r.role_code<>'SUPER_ADMIN') AND NOT smiley_private.is_platform_profile(user_id));
CREATE POLICY grants_delete ON public."user_branch_memberships" FOR DELETE TO smiley_app USING (smiley_private.hospital_admin(hospital_id) AND EXISTS(SELECT 1 FROM public.roles r WHERE r.role_id=user_branch_memberships.role_id AND r.role_code<>'SUPER_ADMIN') AND NOT smiley_private.is_platform_profile(user_id));

ALTER TABLE public."staff_invitations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."staff_invitations" FORCE ROW LEVEL SECURITY;
CREATE POLICY migration_cli ON public."staff_invitations" FOR ALL TO smiley_migrator USING (true) WITH CHECK (true);
CREATE POLICY invite_read ON public."staff_invitations" FOR SELECT TO smiley_app USING (smiley_private.hospital_admin(hospital_id) OR (token_hash=nullif(current_setting('app.invitation_token_hash',true),'')));
CREATE POLICY invite_insert ON public."staff_invitations" FOR INSERT TO smiley_app WITH CHECK (smiley_private.hospital_admin(hospital_id) AND created_by=nullif(current_setting('app.user_id',true),'')::bigint AND status='PENDING' AND EXISTS(SELECT 1 FROM public.roles r WHERE r.role_id=staff_invitations.role_id AND r.role_code<>'SUPER_ADMIN'));
CREATE POLICY invite_update ON public."staff_invitations" FOR UPDATE TO smiley_app USING (smiley_private.hospital_admin(hospital_id) OR (token_hash=nullif(current_setting('app.invitation_token_hash',true),'') AND status='PENDING' AND expires_at>now())) WITH CHECK (smiley_private.hospital_admin(hospital_id) OR (token_hash=nullif(current_setting('app.invitation_token_hash',true),'') AND id=nullif(current_setting('app.accepting_invitation_id',true),'') AND status='ACCEPTED' AND accepted_user_id=smiley_private.own_user_id() AND hospital_id=smiley_private.own_hospital_id()));

ALTER TABLE public."claim_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."claim_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY migration_cli ON public."claim_events" FOR ALL TO smiley_migrator USING (true) WITH CHECK (true);
CREATE POLICY scoped_read ON public."claim_events" FOR SELECT TO smiley_app USING (smiley_private.in_branch(hospital_id,branch_id));
CREATE POLICY scoped_insert ON public."claim_events" FOR INSERT TO smiley_app WITH CHECK (smiley_private.in_branch(hospital_id,branch_id,true) AND (smiley_private.hospital_admin(hospital_id) OR current_setting('app.permission',true) IN ('case:write','case:act','document:write')) AND actor_user_id=nullif(current_setting('app.user_id',true),'')::bigint);

ALTER TABLE public."document_revisions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."document_revisions" FORCE ROW LEVEL SECURITY;
CREATE POLICY migration_cli ON public."document_revisions" FOR ALL TO smiley_migrator USING (true) WITH CHECK (true);
CREATE POLICY scoped_read ON public."document_revisions" FOR SELECT TO smiley_app USING (smiley_private.in_branch(hospital_id,branch_id));
CREATE POLICY scoped_insert ON public."document_revisions" FOR INSERT TO smiley_app WITH CHECK (smiley_private.in_branch(hospital_id,branch_id,true) AND (smiley_private.hospital_admin(hospital_id) OR current_setting('app.permission',true)='document:write') AND uploaded_by=nullif(current_setting('app.user_id',true),'')::bigint);

ALTER TABLE public."document_evidence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."document_evidence" FORCE ROW LEVEL SECURITY;
CREATE POLICY migration_cli ON public."document_evidence" FOR ALL TO smiley_migrator USING (true) WITH CHECK (true);
CREATE POLICY scoped_read ON public."document_evidence" FOR SELECT TO smiley_app USING (smiley_private.in_branch(hospital_id,branch_id));
CREATE POLICY scoped_insert ON public."document_evidence" FOR INSERT TO smiley_app WITH CHECK (smiley_private.in_branch(hospital_id,branch_id,true) AND (smiley_private.hospital_admin(hospital_id) OR current_setting('app.permission',true)='document:write') AND recorded_by=nullif(current_setting('app.user_id',true),'')::bigint);

-- Auth adapter tables remain global identity storage; no public CRUD endpoints expose them.
