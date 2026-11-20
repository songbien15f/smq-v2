import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE "privacy_page" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"last_updated" timestamp(3) with time zone NOT NULL,
  	"body" jsonb NOT NULL,
  	"meta_title" varchar,
  	"meta_description" varchar,
  	"updated_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone
  );
  
  CREATE TABLE "_privacy_page_v" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"version_last_updated" timestamp(3) with time zone NOT NULL,
  	"version_body" jsonb NOT NULL,
  	"version_meta_title" varchar,
  	"version_meta_description" varchar,
  	"version_updated_at" timestamp(3) with time zone,
  	"version_created_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE INDEX "_privacy_page_v_created_at_idx" ON "_privacy_page_v" USING btree ("created_at");
  CREATE INDEX "_privacy_page_v_updated_at_idx" ON "_privacy_page_v" USING btree ("updated_at");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP TABLE "privacy_page" CASCADE;
  DROP TABLE "_privacy_page_v" CASCADE;`)
}
