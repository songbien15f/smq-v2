import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE "products_page" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"hero_eyebrow" varchar NOT NULL,
  	"hero_title" varchar NOT NULL,
  	"hero_lede" varchar NOT NULL,
  	"intro_eyebrow" varchar,
  	"intro_title" varchar NOT NULL,
  	"intro_body" varchar,
  	"partner_note_title" varchar,
  	"partner_note_body" varchar,
  	"updated_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone
  );
  
  CREATE TABLE "_products_page_v" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"version_hero_eyebrow" varchar NOT NULL,
  	"version_hero_title" varchar NOT NULL,
  	"version_hero_lede" varchar NOT NULL,
  	"version_intro_eyebrow" varchar,
  	"version_intro_title" varchar NOT NULL,
  	"version_intro_body" varchar,
  	"version_partner_note_title" varchar,
  	"version_partner_note_body" varchar,
  	"version_updated_at" timestamp(3) with time zone,
  	"version_created_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE INDEX "_products_page_v_created_at_idx" ON "_products_page_v" USING btree ("created_at");
  CREATE INDEX "_products_page_v_updated_at_idx" ON "_products_page_v" USING btree ("updated_at");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP TABLE "products_page" CASCADE;
  DROP TABLE "_products_page_v" CASCADE;`)
}
