import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "home_page" ADD COLUMN "meta_title" varchar;
  ALTER TABLE "home_page" ADD COLUMN "meta_description" varchar;
  ALTER TABLE "_home_page_v" ADD COLUMN "version_meta_title" varchar;
  ALTER TABLE "_home_page_v" ADD COLUMN "version_meta_description" varchar;
  ALTER TABLE "capabilities_page" ADD COLUMN "meta_title" varchar;
  ALTER TABLE "capabilities_page" ADD COLUMN "meta_description" varchar;
  ALTER TABLE "_capabilities_page_v" ADD COLUMN "version_meta_title" varchar;
  ALTER TABLE "_capabilities_page_v" ADD COLUMN "version_meta_description" varchar;
  ALTER TABLE "process_page" ADD COLUMN "meta_title" varchar;
  ALTER TABLE "process_page" ADD COLUMN "meta_description" varchar;
  ALTER TABLE "_process_page_v" ADD COLUMN "version_meta_title" varchar;
  ALTER TABLE "_process_page_v" ADD COLUMN "version_meta_description" varchar;
  ALTER TABLE "quality_page" ADD COLUMN "meta_title" varchar;
  ALTER TABLE "quality_page" ADD COLUMN "meta_description" varchar;
  ALTER TABLE "_quality_page_v" ADD COLUMN "version_meta_title" varchar;
  ALTER TABLE "_quality_page_v" ADD COLUMN "version_meta_description" varchar;
  ALTER TABLE "projects_page" ADD COLUMN "meta_title" varchar;
  ALTER TABLE "projects_page" ADD COLUMN "meta_description" varchar;
  ALTER TABLE "_projects_page_v" ADD COLUMN "version_meta_title" varchar;
  ALTER TABLE "_projects_page_v" ADD COLUMN "version_meta_description" varchar;
  ALTER TABLE "products_page" ADD COLUMN "meta_title" varchar;
  ALTER TABLE "products_page" ADD COLUMN "meta_description" varchar;
  ALTER TABLE "_products_page_v" ADD COLUMN "version_meta_title" varchar;
  ALTER TABLE "_products_page_v" ADD COLUMN "version_meta_description" varchar;
  ALTER TABLE "team_page" ADD COLUMN "meta_title" varchar;
  ALTER TABLE "team_page" ADD COLUMN "meta_description" varchar;
  ALTER TABLE "_team_page_v" ADD COLUMN "version_meta_title" varchar;
  ALTER TABLE "_team_page_v" ADD COLUMN "version_meta_description" varchar;
  ALTER TABLE "quote_page" ADD COLUMN "meta_title" varchar;
  ALTER TABLE "quote_page" ADD COLUMN "meta_description" varchar;
  ALTER TABLE "_quote_page_v" ADD COLUMN "version_meta_title" varchar;
  ALTER TABLE "_quote_page_v" ADD COLUMN "version_meta_description" varchar;
  ALTER TABLE "contact_page" ADD COLUMN "meta_title" varchar;
  ALTER TABLE "contact_page" ADD COLUMN "meta_description" varchar;
  ALTER TABLE "_contact_page_v" ADD COLUMN "version_meta_title" varchar;
  ALTER TABLE "_contact_page_v" ADD COLUMN "version_meta_description" varchar;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "home_page" DROP COLUMN "meta_title";
  ALTER TABLE "home_page" DROP COLUMN "meta_description";
  ALTER TABLE "_home_page_v" DROP COLUMN "version_meta_title";
  ALTER TABLE "_home_page_v" DROP COLUMN "version_meta_description";
  ALTER TABLE "capabilities_page" DROP COLUMN "meta_title";
  ALTER TABLE "capabilities_page" DROP COLUMN "meta_description";
  ALTER TABLE "_capabilities_page_v" DROP COLUMN "version_meta_title";
  ALTER TABLE "_capabilities_page_v" DROP COLUMN "version_meta_description";
  ALTER TABLE "process_page" DROP COLUMN "meta_title";
  ALTER TABLE "process_page" DROP COLUMN "meta_description";
  ALTER TABLE "_process_page_v" DROP COLUMN "version_meta_title";
  ALTER TABLE "_process_page_v" DROP COLUMN "version_meta_description";
  ALTER TABLE "quality_page" DROP COLUMN "meta_title";
  ALTER TABLE "quality_page" DROP COLUMN "meta_description";
  ALTER TABLE "_quality_page_v" DROP COLUMN "version_meta_title";
  ALTER TABLE "_quality_page_v" DROP COLUMN "version_meta_description";
  ALTER TABLE "projects_page" DROP COLUMN "meta_title";
  ALTER TABLE "projects_page" DROP COLUMN "meta_description";
  ALTER TABLE "_projects_page_v" DROP COLUMN "version_meta_title";
  ALTER TABLE "_projects_page_v" DROP COLUMN "version_meta_description";
  ALTER TABLE "products_page" DROP COLUMN "meta_title";
  ALTER TABLE "products_page" DROP COLUMN "meta_description";
  ALTER TABLE "_products_page_v" DROP COLUMN "version_meta_title";
  ALTER TABLE "_products_page_v" DROP COLUMN "version_meta_description";
  ALTER TABLE "team_page" DROP COLUMN "meta_title";
  ALTER TABLE "team_page" DROP COLUMN "meta_description";
  ALTER TABLE "_team_page_v" DROP COLUMN "version_meta_title";
  ALTER TABLE "_team_page_v" DROP COLUMN "version_meta_description";
  ALTER TABLE "quote_page" DROP COLUMN "meta_title";
  ALTER TABLE "quote_page" DROP COLUMN "meta_description";
  ALTER TABLE "_quote_page_v" DROP COLUMN "version_meta_title";
  ALTER TABLE "_quote_page_v" DROP COLUMN "version_meta_description";
  ALTER TABLE "contact_page" DROP COLUMN "meta_title";
  ALTER TABLE "contact_page" DROP COLUMN "meta_description";
  ALTER TABLE "_contact_page_v" DROP COLUMN "version_meta_title";
  ALTER TABLE "_contact_page_v" DROP COLUMN "version_meta_description";`)
}
