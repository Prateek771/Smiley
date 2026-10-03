CREATE TABLE public.ai_runs (
 id uuid PRIMARY KEY, hospital_id bigint NOT NULL, branch_id bigint NOT NULL, claim_id bigint NOT NULL,
 actor_user_id bigint NOT NULL, auth_owner_id text NOT NULL REFERENCES public.auth_user(id),
 kind text NOT NULL CHECK(kind IN ('EXTRACTION','PACK_CHECK','RESPONSE_DRAFT')),
 input_version integer NOT NULL CHECK(input_version>0), input_fingerprint text NOT NULL CHECK(input_fingerprint ~ '^[0-9a-f]{64}$'),
 request_fingerprint text NOT NULL CHECK(request_fingerprint ~ '^[0-9a-f]{64}$'), idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 8 AND 100),
 query_reference text, query_snapshot jsonb, synthetic boolean NOT NULL CHECK(synthetic), retry_of uuid,
 status text NOT NULL DEFAULT 'QUEUED' CHECK(status IN ('QUEUED','RUNNING','RETRYING','COMPLETE','FAILED','STALE','DENIED','REVIEW_REQUIRED')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3), reason text, result jsonb,
 worker_pid integer, worker_host text, queue_worker_id text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(hospital_id,branch_id,claim_id,id), UNIQUE(hospital_id,claim_id,idempotency_key),
 FOREIGN KEY(hospital_id,branch_id,claim_id) REFERENCES public.claims(hospital_id,branch_id,claim_id),
 FOREIGN KEY(hospital_id,actor_user_id) REFERENCES public.users(hospital_id,user_id),
 FOREIGN KEY(hospital_id,branch_id,claim_id,retry_of) REFERENCES public.ai_runs(hospital_id,branch_id,claim_id,id),
 CHECK((kind='RESPONSE_DRAFT' AND query_reference IS NOT NULL AND query_snapshot IS NOT NULL) OR (kind<>'RESPONSE_DRAFT' AND query_reference IS NULL AND query_snapshot IS NULL)),
 CHECK(result IS NULL OR jsonb_typeof(result)='object')
);
CREATE INDEX ix_ai_run_scope ON public.ai_runs(hospital_id,branch_id,claim_id,created_at);
CREATE INDEX ix_ai_run_actor ON public.ai_runs(hospital_id,actor_user_id);
CREATE INDEX ix_ai_run_auth ON public.ai_runs(auth_owner_id);
CREATE INDEX ix_ai_run_retry ON public.ai_runs(retry_of);
CREATE TABLE public.ai_run_sources (
 hospital_id bigint NOT NULL,branch_id bigint NOT NULL,claim_id bigint NOT NULL,run_id uuid NOT NULL,revision_id text NOT NULL,
 sha256 text NOT NULL CHECK(sha256 ~ '^[0-9a-f]{64}$'), document_type text NOT NULL,
 PRIMARY KEY(run_id,revision_id),
 FOREIGN KEY(hospital_id,branch_id,claim_id,run_id) REFERENCES public.ai_runs(hospital_id,branch_id,claim_id,id),
 FOREIGN KEY(hospital_id,branch_id,claim_id,revision_id) REFERENCES public.document_revisions(hospital_id,branch_id,claim_id,revision_id)
);
CREATE INDEX ix_ai_source_scope ON public.ai_run_sources(hospital_id,branch_id,claim_id);
CREATE INDEX ix_ai_source_revision ON public.ai_run_sources(hospital_id,branch_id,claim_id,revision_id);
CREATE TABLE public.ai_reviews (
 id uuid PRIMARY KEY,hospital_id bigint NOT NULL,branch_id bigint NOT NULL,claim_id bigint NOT NULL,run_id uuid NOT NULL,
 actor_user_id bigint NOT NULL,item_index integer NOT NULL CHECK(item_index>=-1),
 action text NOT NULL CHECK(action IN ('ACCEPT','CORRECT','REJECT')),value text,reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 2000),
 input_fingerprint text NOT NULL,request_fingerprint text NOT NULL,idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 8 AND 100),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(hospital_id,claim_id,idempotency_key),
 FOREIGN KEY(hospital_id,branch_id,claim_id,run_id) REFERENCES public.ai_runs(hospital_id,branch_id,claim_id,id),
 FOREIGN KEY(hospital_id,actor_user_id) REFERENCES public.users(hospital_id,user_id),
 CHECK(value IS NULL OR length(value)<=20000)
);
CREATE INDEX ix_ai_review_scope ON public.ai_reviews(hospital_id,branch_id,claim_id,run_id,created_at);
CREATE INDEX ix_ai_review_actor ON public.ai_reviews(hospital_id,actor_user_id);
CREATE TRIGGER ai_sources_immutable BEFORE UPDATE OR DELETE ON public.ai_run_sources FOR EACH ROW EXECUTE FUNCTION public.reject_history_mutation();
CREATE TRIGGER ai_reviews_immutable BEFORE UPDATE OR DELETE ON public.ai_reviews FOR EACH ROW EXECUTE FUNCTION public.reject_history_mutation();
ALTER TABLE public.ai_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE public.ai_run_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_run_sources FORCE ROW LEVEL SECURITY;
ALTER TABLE public.ai_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_reviews FORCE ROW LEVEL SECURITY;
CREATE POLICY migration_cli ON public.ai_runs FOR ALL TO smiley_migrator USING(true) WITH CHECK(true);
CREATE POLICY migration_cli ON public.ai_run_sources FOR ALL TO smiley_migrator USING(true) WITH CHECK(true);
CREATE POLICY migration_cli ON public.ai_reviews FOR ALL TO smiley_migrator USING(true) WITH CHECK(true);
CREATE POLICY scoped_read ON public.ai_runs FOR SELECT TO smiley_app USING(smiley_private.in_branch(hospital_id,branch_id));
CREATE POLICY scoped_read ON public.ai_run_sources FOR SELECT TO smiley_app USING(smiley_private.in_branch(hospital_id,branch_id));
CREATE POLICY scoped_read ON public.ai_reviews FOR SELECT TO smiley_app USING(smiley_private.in_branch(hospital_id,branch_id));
CREATE POLICY scoped_insert ON public.ai_runs FOR INSERT TO smiley_app WITH CHECK(smiley_private.in_branch(hospital_id,branch_id,true) AND current_setting('app.permission',true)='case:act' AND actor_user_id=smiley_private.own_user_id() AND auth_owner_id=current_setting('app.auth_user_id',true) AND status='QUEUED' AND attempts=0 AND result IS NULL AND reason IS NULL AND worker_pid IS NULL AND worker_host IS NULL AND queue_worker_id IS NULL);
CREATE POLICY scoped_insert ON public.ai_run_sources FOR INSERT TO smiley_app WITH CHECK(smiley_private.in_branch(hospital_id,branch_id,true) AND current_setting('app.permission',true)='case:act' AND EXISTS(SELECT 1 FROM public.ai_runs r WHERE r.id=run_id AND r.hospital_id=ai_run_sources.hospital_id AND r.branch_id=ai_run_sources.branch_id AND r.claim_id=ai_run_sources.claim_id AND r.actor_user_id=smiley_private.own_user_id() AND r.status='QUEUED'));
CREATE POLICY scoped_insert ON public.ai_reviews FOR INSERT TO smiley_app WITH CHECK(smiley_private.in_branch(hospital_id,branch_id,true) AND current_setting('app.permission',true)='case:act' AND actor_user_id=smiley_private.own_user_id() AND EXISTS(SELECT 1 FROM public.ai_runs r WHERE r.id=run_id AND r.hospital_id=ai_reviews.hospital_id AND r.branch_id=ai_reviews.branch_id AND r.claim_id=ai_reviews.claim_id AND r.status='COMPLETE'));
CREATE FUNCTION smiley_private.enqueue_ai_run(request_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE j public.ai_runs; BEGIN
 SELECT * INTO j FROM public.ai_runs WHERE id=request_id;
 IF j.id IS NULL OR j.actor_user_id<>smiley_private.own_user_id() OR j.auth_owner_id<>current_setting('app.auth_user_id',true) OR NOT smiley_private.in_branch(j.hospital_id,j.branch_id,true) OR current_setting('app.permission',true)<>'case:act' OR j.status<>'QUEUED' THEN RAISE EXCEPTION 'AI run is outside current staff scope' USING ERRCODE='42501'; END IF;
 PERFORM graphile_worker.add_job('ai-review',json_build_object('requestId',request_id),max_attempts:=3,job_key:=request_id::text,job_key_mode:='unsafe_dedupe');
END $$;
REVOKE ALL ON FUNCTION smiley_private.enqueue_ai_run(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION smiley_private.enqueue_ai_run(uuid) TO smiley_app;
