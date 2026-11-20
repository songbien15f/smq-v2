import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE "header_top_strip_locations" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"label" varchar NOT NULL
  );
  
  CREATE TABLE "_header_v_version_top_strip_locations" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"label" varchar NOT NULL,
  	"_uuid" varchar
  );
  
  ALTER TABLE "header" ADD COLUMN "show_top_strip" boolean DEFAULT true;
  ALTER TABLE "_header_v" ADD COLUMN "version_show_top_strip" boolean DEFAULT true;
  ALTER TABLE "header_top_strip_locations" ADD CONSTRAINT "header_top_strip_locations_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."header"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_header_v_version_top_strip_locations" ADD CONSTRAINT "_header_v_version_top_strip_locations_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_header_v"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "header_top_strip_locations_order_idx" ON "header_top_strip_locations" USING btree ("_order");
  CREATE INDEX "header_top_strip_locations_parent_id_idx" ON "header_top_strip_locations" USING btree ("_parent_id");
  CREATE INDEX "_header_v_version_top_strip_locations_order_idx" ON "_header_v_version_top_strip_locations" USING btree ("_order");
  CREATE INDEX "_header_v_version_top_strip_locations_parent_id_idx" ON "_header_v_version_top_strip_locations" USING btree ("_parent_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP TABLE "header_top_strip_locations" CASCADE;
  DROP TABLE "_header_v_version_top_strip_locations" CASCADE;
  ALTER TABLE "header" DROP COLUMN "show_top_strip";
  ALTER TABLE "_header_v" DROP COLUMN "version_show_top_strip";`)
}
