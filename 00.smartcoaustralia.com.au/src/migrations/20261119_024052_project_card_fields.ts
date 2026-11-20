import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "projects" ADD COLUMN "card_summary" varchar;
  ALTER TABLE "projects" ADD COLUMN "card_tag" varchar;
  ALTER TABLE "_projects_v" ADD COLUMN "version_card_summary" varchar;
  ALTER TABLE "_projects_v" ADD COLUMN "version_card_tag" varchar;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "projects" DROP COLUMN "card_summary";
  ALTER TABLE "projects" DROP COLUMN "card_tag";
  ALTER TABLE "_projects_v" DROP COLUMN "version_card_summary";
  ALTER TABLE "_projects_v" DROP COLUMN "version_card_tag";`)
}
