import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE "home_page_office_split_offices" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"code" varchar NOT NULL,
  	"title" varchar NOT NULL,
  	"body" varchar NOT NULL
  );
  
  CREATE TABLE "_home_page_v_version_office_split_offices" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"code" varchar NOT NULL,
  	"title" varchar NOT NULL,
  	"body" varchar NOT NULL,
  	"_uuid" varchar
  );
  
  ALTER TABLE "home_page" ADD COLUMN "office_split_caption_lead" varchar;
  ALTER TABLE "home_page" ADD COLUMN "office_split_caption" varchar;
  ALTER TABLE "_home_page_v" ADD COLUMN "version_office_split_caption_lead" varchar;
  ALTER TABLE "_home_page_v" ADD COLUMN "version_office_split_caption" varchar;
  ALTER TABLE "home_page_office_split_offices" ADD CONSTRAINT "home_page_office_split_offices_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."home_page"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_home_page_v_version_office_split_offices" ADD CONSTRAINT "_home_page_v_version_office_split_offices_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_home_page_v"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "home_page_office_split_offices_order_idx" ON "home_page_office_split_offices" USING btree ("_order");
  CREATE INDEX "home_page_office_split_offices_parent_id_idx" ON "home_page_office_split_offices" USING btree ("_parent_id");
  CREATE INDEX "_home_page_v_version_office_split_offices_order_idx" ON "_home_page_v_version_office_split_offices" USING btree ("_order");
  CREATE INDEX "_home_page_v_version_office_split_offices_parent_id_idx" ON "_home_page_v_version_office_split_offices" USING btree ("_parent_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP TABLE "home_page_office_split_offices" CASCADE;
  DROP TABLE "_home_page_v_version_office_split_offices" CASCADE;
  ALTER TABLE "home_page" DROP COLUMN "office_split_caption_lead";
  ALTER TABLE "home_page" DROP COLUMN "office_split_caption";
  ALTER TABLE "_home_page_v" DROP COLUMN "version_office_split_caption_lead";
  ALTER TABLE "_home_page_v" DROP COLUMN "version_office_split_caption";`)
}
