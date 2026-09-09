"""Add student coding lab tables

Revision ID: 041_add_student_coding_lab
Revises: 040_toy_lm_publications
Create Date: 2026-06-17
"""

from alembic import op

revision = "041_add_student_coding_lab"
down_revision = "040_toy_lm_publications"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS coding_briefs (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            teacher_id UUID REFERENCES users(id) ON DELETE SET NULL,
            session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
            title VARCHAR(255) NOT NULL,
            description TEXT,
            constraints_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            rubric_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            allowed_templates_json JSONB NOT NULL DEFAULT '[]'::jsonb,
            publication_policy VARCHAR(32) NOT NULL DEFAULT 'teacher_review',
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_coding_briefs_tenant_id ON coding_briefs(tenant_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_coding_briefs_teacher_id ON coding_briefs(teacher_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_coding_briefs_session_id ON coding_briefs(session_id)")

    op.execute("""
        CREATE TABLE IF NOT EXISTS coding_projects (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
            brief_id UUID REFERENCES coding_briefs(id) ON DELETE SET NULL,
            owner_student_id UUID REFERENCES session_students(id) ON DELETE SET NULL,
            owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
            title VARCHAR(255) NOT NULL,
            slug VARCHAR(160) NOT NULL,
            template_key VARCHAR(64) NOT NULL DEFAULT 'vite-react',
            status VARCHAR(32) NOT NULL DEFAULT 'draft',
            current_version_id UUID,
            visibility VARCHAR(32) NOT NULL DEFAULT 'private',
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT uq_coding_projects_session_slug UNIQUE (session_id, slug)
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_coding_projects_tenant_id ON coding_projects(tenant_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_coding_projects_session_id ON coding_projects(session_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_coding_projects_brief_id ON coding_projects(brief_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_coding_projects_owner_student_id ON coding_projects(owner_student_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_coding_projects_owner_user_id ON coding_projects(owner_user_id)")

    op.execute("""
        CREATE TABLE IF NOT EXISTS coding_messages (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            project_id UUID NOT NULL REFERENCES coding_projects(id) ON DELETE CASCADE,
            actor_type VARCHAR(32) NOT NULL,
            actor_id UUID,
            agent_name VARCHAR(64),
            role VARCHAR(32) NOT NULL,
            content TEXT NOT NULL,
            metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_coding_messages_project_id ON coding_messages(project_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_coding_messages_actor_id ON coding_messages(actor_id)")

    op.execute("""
        CREATE TABLE IF NOT EXISTS coding_versions (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            project_id UUID NOT NULL REFERENCES coding_projects(id) ON DELETE CASCADE,
            parent_version_id UUID REFERENCES coding_versions(id) ON DELETE SET NULL,
            version_number INTEGER NOT NULL,
            source_manifest_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            artifact_manifest_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            prompt_message_id UUID REFERENCES coding_messages(id) ON DELETE SET NULL,
            build_status VARCHAR(32) NOT NULL DEFAULT 'pending',
            review_status VARCHAR(32) NOT NULL DEFAULT 'pending',
            created_by_actor_type VARCHAR(32) NOT NULL DEFAULT 'system',
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT uq_coding_versions_project_number UNIQUE (project_id, version_number)
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_coding_versions_project_id ON coding_versions(project_id)")

    op.execute("""
        CREATE TABLE IF NOT EXISTS coding_files (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            project_id UUID NOT NULL REFERENCES coding_projects(id) ON DELETE CASCADE,
            version_id UUID NOT NULL REFERENCES coding_versions(id) ON DELETE CASCADE,
            path VARCHAR(512) NOT NULL,
            mime_type VARCHAR(128),
            content_hash VARCHAR(128) NOT NULL,
            storage_key VARCHAR(1024) NOT NULL,
            size_bytes INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT uq_coding_files_version_path UNIQUE (version_id, path)
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_coding_files_project_id ON coding_files(project_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_coding_files_version_id ON coding_files(version_id)")

    op.execute("""
        CREATE TABLE IF NOT EXISTS coding_agent_runs (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            project_id UUID NOT NULL REFERENCES coding_projects(id) ON DELETE CASCADE,
            version_id UUID REFERENCES coding_versions(id) ON DELETE SET NULL,
            job_id VARCHAR(128),
            agent_name VARCHAR(64) NOT NULL,
            status VARCHAR(32) NOT NULL DEFAULT 'queued',
            input_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            output_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            logs_storage_key VARCHAR(1024),
            started_at TIMESTAMPTZ,
            completed_at TIMESTAMPTZ,
            error_message TEXT
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_coding_agent_runs_project_id ON coding_agent_runs(project_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_coding_agent_runs_version_id ON coding_agent_runs(version_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_coding_agent_runs_job_id ON coding_agent_runs(job_id)")

    op.execute("""
        CREATE TABLE IF NOT EXISTS coding_builds (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            project_id UUID NOT NULL REFERENCES coding_projects(id) ON DELETE CASCADE,
            version_id UUID NOT NULL REFERENCES coding_versions(id) ON DELETE CASCADE,
            status VARCHAR(32) NOT NULL DEFAULT 'queued',
            runner_job_id VARCHAR(128),
            template_key VARCHAR(64) NOT NULL,
            install_log_key VARCHAR(1024),
            build_log_key VARCHAR(1024),
            test_log_key VARCHAR(1024),
            artifact_root_key VARCHAR(1024),
            screenshot_keys_json JSONB NOT NULL DEFAULT '[]'::jsonb,
            console_errors_json JSONB NOT NULL DEFAULT '[]'::jsonb,
            started_at TIMESTAMPTZ,
            completed_at TIMESTAMPTZ,
            error_message TEXT
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_coding_builds_project_id ON coding_builds(project_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_coding_builds_version_id ON coding_builds(version_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_coding_builds_runner_job_id ON coding_builds(runner_job_id)")

    op.execute("""
        CREATE TABLE IF NOT EXISTS coding_reviews (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            project_id UUID NOT NULL REFERENCES coding_projects(id) ON DELETE CASCADE,
            version_id UUID NOT NULL REFERENCES coding_versions(id) ON DELETE CASCADE,
            review_type VARCHAR(32) NOT NULL,
            score_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            findings_json JSONB NOT NULL DEFAULT '[]'::jsonb,
            summary TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_coding_reviews_project_id ON coding_reviews(project_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_coding_reviews_version_id ON coding_reviews(version_id)")

    op.execute("""
        CREATE TABLE IF NOT EXISTS coding_publications (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            project_id UUID NOT NULL REFERENCES coding_projects(id) ON DELETE CASCADE,
            version_id UUID NOT NULL REFERENCES coding_versions(id) ON DELETE CASCADE,
            tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
            publication_slug VARCHAR(160) NOT NULL,
            url_path VARCHAR(512) NOT NULL,
            status VARCHAR(32) NOT NULL DEFAULT 'draft',
            chat_message_id UUID REFERENCES chat_messages(id) ON DELETE SET NULL,
            approved_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT uq_coding_publications_slug_version UNIQUE (publication_slug, version_id)
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_coding_publications_project_id ON coding_publications(project_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_coding_publications_version_id ON coding_publications(version_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_coding_publications_tenant_id ON coding_publications(tenant_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_coding_publications_session_id ON coding_publications(session_id)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS coding_publications")
    op.execute("DROP TABLE IF EXISTS coding_reviews")
    op.execute("DROP TABLE IF EXISTS coding_builds")
    op.execute("DROP TABLE IF EXISTS coding_agent_runs")
    op.execute("DROP TABLE IF EXISTS coding_files")
    op.execute("DROP TABLE IF EXISTS coding_versions")
    op.execute("DROP TABLE IF EXISTS coding_messages")
    op.execute("DROP TABLE IF EXISTS coding_projects")
    op.execute("DROP TABLE IF EXISTS coding_briefs")
