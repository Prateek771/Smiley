CREATE TABLE public.rule_revisions (
 id uuid PRIMARY KEY, hospital_id bigint NOT NULL REFERENCES public.hospitals(hospital_id), policy_id bigint NOT NULL REFERENCES public.insurance_policies(policy_id),
 name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120), rule jsonb NOT NULL CHECK(jsonb_typeof(rule)='object'), reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 2000),
 created_by bigint NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(hospital_id,id),
 FOREIGN KEY(hospital_id,created_by) REFERENCES public.users(hospital_id,user_id)
);
CREATE INDEX ix_rule_policy ON public.rule_revisions(hospital_id,policy_id);
CREATE INDEX ix_rule_actor ON public.rule_revisions(hospital_id,created_by);
CREATE TABLE public.rule_lifecycle_events (
 id uuid PRIMARY KEY, hospital_id bigint NOT NULL, rule_id uuid NOT NULL, version integer NOT NULL CHECK(version>0), status text NOT NULL CHECK(status IN ('DRAFT','APPROVED','RETIRED')),
 reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 2000), actor_id bigint NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(rule_id,version),
 FOREIGN KEY(hospital_id,rule_id) REFERENCES public.rule_revisions(hospital_id,id), FOREIGN KEY(hospital_id,actor_id) REFERENCES public.users(hospital_id,user_id)
);
CREATE INDEX ix_rule_lifecycle_scope ON public.rule_lifecycle_events(hospital_id,rule_id,version);
CREATE INDEX ix_rule_lifecycle_actor ON public.rule_lifecycle_events(hospital_id,actor_id);
CREATE TRIGGER rule_revisions_immutable BEFORE UPDATE OR DELETE ON public.rule_revisions FOR EACH ROW EXECUTE FUNCTION public.reject_history_mutation();
CREATE TRIGGER rule_lifecycle_immutable BEFORE UPDATE OR DELETE ON public.rule_lifecycle_events FOR EACH ROW EXECUTE FUNCTION public.reject_history_mutation();
ALTER TABLE public.rule_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rule_revisions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.rule_lifecycle_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rule_lifecycle_events FORCE ROW LEVEL SECURITY;
CREATE POLICY migration_cli ON public.rule_revisions FOR ALL TO smiley_migrator USING(true) WITH CHECK(true);
CREATE POLICY migration_cli ON public.rule_lifecycle_events FOR ALL TO smiley_migrator USING(true) WITH CHECK(true);
CREATE POLICY rule_read ON public.rule_revisions FOR SELECT TO smiley_app USING(smiley_private.in_hospital(hospital_id));
CREATE POLICY rule_read ON public.rule_lifecycle_events FOR SELECT TO smiley_app USING(smiley_private.in_hospital(hospital_id));
CREATE POLICY rule_append ON public.rule_revisions FOR INSERT TO smiley_app WITH CHECK(smiley_private.hospital_admin(hospital_id) AND created_by=smiley_private.own_user_id());
CREATE POLICY rule_append ON public.rule_lifecycle_events FOR INSERT TO smiley_app WITH CHECK(smiley_private.hospital_admin(hospital_id) AND actor_id=smiley_private.own_user_id());

CREATE FUNCTION smiley_private.check_rule_lifecycle() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE previous public.rule_lifecycle_events;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('admin:' || NEW.hospital_id::text,19));
 SELECT * INTO previous FROM public.rule_lifecycle_events WHERE rule_id=NEW.rule_id ORDER BY version DESC LIMIT 1;
 IF previous.id IS NULL THEN
  IF NEW.version<>1 OR NEW.status<>'DRAFT' THEN RAISE EXCEPTION 'A rule starts with a draft lifecycle event' USING ERRCODE='23514'; END IF;
 ELSE
  IF NEW.version<>previous.version+1 OR NOT ((previous.status='DRAFT' AND NEW.status='APPROVED') OR (previous.status='APPROVED' AND NEW.status='RETIRED')) THEN
   RAISE EXCEPTION 'Invalid rule lifecycle transition' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION smiley_private.check_rule_lifecycle() FROM PUBLIC;
CREATE TRIGGER rule_lifecycle_guard BEFORE INSERT ON public.rule_lifecycle_events FOR EACH ROW EXECUTE FUNCTION smiley_private.check_rule_lifecycle();

-- Platform registry scope never grants clinical access. Verify the identity, not a request flag.
CREATE FUNCTION smiley_private.platform_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.users u JOIN public.staff s ON s.staff_id=u.staff_id AND s.hospital_id=u.hospital_id
 JOIN public.hospitals h ON h.hospital_id=u.hospital_id JOIN public.user_roles ur ON ur.user_id=u.user_id AND ur.hospital_id=u.hospital_id JOIN public.roles r ON r.role_id=ur.role_id
 WHERE u.auth_user_id=nullif(current_setting('app.auth_user_id',true),'') AND u.status='ACTIVE' AND s.status='ACTIVE' AND h.status='ACTIVE' AND r.role_code='SUPER_ADMIN' AND r.status='ACTIVE')
$$;
REVOKE ALL ON FUNCTION smiley_private.platform_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION smiley_private.platform_admin() TO smiley_app;
CREATE POLICY platform_registry_read ON public.hospitals FOR SELECT TO smiley_app USING(smiley_private.platform_admin());
CREATE POLICY platform_registry_insert ON public.hospitals FOR INSERT TO smiley_app WITH CHECK(smiley_private.platform_admin());
CREATE POLICY platform_registry_update ON public.hospitals FOR UPDATE TO smiley_app USING(smiley_private.platform_admin()) WITH CHECK(smiley_private.platform_admin());
CREATE POLICY platform_registry_read ON public.branches FOR SELECT TO smiley_app USING(smiley_private.platform_admin());
CREATE POLICY platform_registry_insert ON public.branches FOR INSERT TO smiley_app WITH CHECK(smiley_private.platform_admin());
CREATE POLICY platform_registry_update ON public.branches FOR UPDATE TO smiley_app USING(smiley_private.platform_admin()) WITH CHECK(smiley_private.platform_admin());
CREATE POLICY platform_registry_audit ON public.audit_logs FOR INSERT TO smiley_app WITH CHECK(smiley_private.platform_admin() AND hospital_id=smiley_private.own_hospital_id() AND user_id=smiley_private.own_user_id() AND branch_id IS NULL AND module_name='platform-registry');
